import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
describe('G-03/G-12/G-15 fronteiras da preparação',()=>{
  it('UI e Actions só importam public.ts do source-ledger',()=>{
    for(const file of ['src/app/fontes/base-consolidada/actions.ts','src/components/consolidated-source-preparation.tsx','src/components/consolidated-source-flow.tsx']) {
      const text=readFileSync(file,'utf8');
      for(const imported of text.matchAll(/from\s+["'](@\/modules\/source-ledger[^"']*)["']/g)) expect(imported[1]).toBe('@/modules/source-ledger/public');
    }
    for(const route of ['inspect','prepare','confirm']) expect(existsSync(`src/app/api/sources/consolidated/${route}`)).toBe(false);
  });
  it('preserva o dispatch legado sem executar dados reais',()=>{
    const clean={...process.env,APP_BASE_URL:'',DB_APP_PASSWORD_FILE:'',DB_ADMIN_PASSWORD_FILE:''};
    const isolated=execFileSync(process.execPath,['scripts/test-integration.mjs','--print-command'],{env:clean,encoding:'utf8'}).trim();
    expect(isolated).toMatch(/^TRIA_INTEGRATION_NAMESPACE=tria-adjustments-local-[a-z0-9_-]+ bash scripts\/story-3-3-isolated-integration\.sh$/);
    const legacy=execFileSync(process.execPath,['scripts/test-integration.mjs','--print-command'],{env:{...clean,APP_BASE_URL:'http://web:3000',DB_APP_PASSWORD_FILE:'/synthetic/app',DB_ADMIN_PASSWORD_FILE:'/synthetic/admin',TRIA_INTEGRATION_ISOLATED:'confirmed',TRIA_INTEGRATION_NAMESPACE:'tria-adjustments-dispatch-test'},encoding:'utf8'}).trim();
    expect(legacy).toMatch(/^node scripts\/integration-smoke\.mjs && TRIA_INTEGRATION_NAMESPACE=tria-adjustments-local-[a-z0-9_-]+ bash scripts\/story-3-3-isolated-integration\.sh$/);
  });
  it('exige os dois marcadores únicos antes de gerar o harness 3.3',()=>{
    const harness=readFileSync('scripts/story-3-3-isolated-integration.sh','utf8');
    const baseline=readFileSync('scripts/story-3-2-isolated-integration.sh','utf8');
    expect([...baseline.matchAll(/^root=/gm)]).toHaveLength(1);
    expect([...baseline.matchAll(/^echo "Suíte dedicada PostgreSQL concluída/gm)]).toHaveLength(1);
    expect([...baseline.matchAll(/^echo "Story 3\.2:/gm)]).toHaveLength(1);
    expect(harness).toContain('marker_counts=');
    expect(harness).toContain('root_marker_count');
    expect(harness).toContain('postgres_marker_count');
    expect(harness).toContain('story32_marker_count');
    expect(harness).toContain('verify-story-3-3-baseline.mjs');
    expect(readFileSync('scripts/verify-story-3-3-baseline.mjs','utf8')).toContain('story-3-3-baseline.json');
    expect(harness).toContain('TRIA_INSTANCE_NAMESPACE=$namespace');
    expect(() => execFileSync('bash',['-n','scripts/story-3-3-isolated-integration.sh'],{encoding:'utf8'})).not.toThrow();
  });
  it('rejeita seed 3.3 fora de namespace e banco descartáveis',()=>{
    const seed=readFileSync('scripts/seed-story-3-3-reconciliation.mjs','utf8');
    expect(seed).toContain('runtime_instance_marker');
    expect(seed).toContain('TRIA_INSTANCE_NAMESPACE');
    expect(seed).toContain('database !== "tria"');
    expect(seed).toContain('host !== "db"');
    expect(() => execFileSync(process.execPath,['scripts/seed-story-3-3-reconciliation.mjs'],{env:{...process.env,TRIA_INTEGRATION_ISOLATED:'confirmed',TRIA_INTEGRATION_NAMESPACE:'tria-production',TRIA_INSTANCE_NAMESPACE:'tria-production',TRIA_RUNTIME:'',PGHOST:'db',PGDATABASE:'tria'},encoding:'utf8',stdio:'pipe'})).toThrow(/namespace tria-adjustments/);
  });
  it('faz o CI executar as integrações funcionais em ambientes isolados',()=>{
    const packageJson=JSON.parse(readFileSync('package.json','utf8')) as { scripts?: Record<string,string> };
    expect(packageJson.scripts?.['test:ci-integration']).toBe('bash scripts/story-3-3-ci-integration.sh');
    expect(readFileSync('.github/workflows/ci-deploy.yml','utf8')).toContain('npm run test:ci-integration');
    const composed=readFileSync('scripts/story-3-3-ci-integration.sh','utf8');
    expect(composed).toContain('bash scripts/ci-isolated-integration.sh');
    expect(composed).toContain('bash scripts/source-ledger-ci-integration.sh');
    const current=readFileSync('scripts/source-ledger-ci-integration.sh','utf8');
    expect(current).toContain('tests/integration/story-3-2-postgres.integration.test.ts');
    expect(current).toContain('tests/integration/story-3-3-postgres.integration.test.ts');
    expect(current).not.toContain('verify-story-3-3-baseline.mjs');
    expect(readFileSync('scripts/ci-isolated-integration.sh','utf8')).not.toContain('story-3-3-isolated-integration.sh');
  });
  it('mantém os IDs dos gates 3.3 e as provas browser de duração/ausência',()=>{
    const harness=readFileSync('scripts/story-3-3-isolated-integration.sh','utf8');
    const browser=readFileSync('scripts/story-3-3-browser.mjs','utf8');
    const registry=readFileSync('src/modules/source-ledger/domain/import-registry.ts','utf8');
    expect(harness).toContain('G33-01 PASS');
    expect(browser).toContain('G33-14 browser PASS');
    expect(browser).toContain('Ausências: página 2 de');
    expect(browser).toContain('duracao: 02:03');
    expect(registry).toContain('id: "duracao"');
  });
  it('mantém os limites SQL de decisão, presença de campos e custo linear do grafo',()=>{
    const sql=readFileSync('db/migrations/030_source_reconciliation.sql','utf8');
    expect(sql).toContain("GROUP BY d->>'id' HAVING count(*) <> 1");
    expect(sql).toContain("source_reconciliation_canonical_matching_fields");
    expect(sql).toContain("'originalPresent'");
    expect(sql).toContain("'proposedPresent'");
    expect(sql).toContain("nullif(line->'observation'->'decimalSources', '{}'::jsonb)");
    expect(sql).toContain("nullif(line->'observation'->'durationSources', '{}'::jsonb)");
    expect(sql).toContain('valid_preview_keys');
    expect(sql).toContain('SELECT DISTINCT preview_key.matching_key');
    expect(sql).toContain('manifest_delta jsonb NOT NULL');
    expect(sql).toContain('source_reconciliation_materialize_manifest');
    expect(sql).toContain('next_source_reconciliation_recovery_attempt');
    expect(sql).toContain("decision := jsonb_set(decision, '{decidedAt}'");
    expect(sql).not.toContain('extract(epoch FROM ((decision->>\'decidedAt\')::timestamptz - server_created_at))');
    expect(sql).toContain('decision revision parent is not the current leaf');
    expect(sql).toContain('IF p_operation = \'reconcile\' THEN\n      PERFORM pg_advisory_xact_lock(hashtextextended(\'source-reconciliation:match:');
    expect(sql).not.toContain('FROM jsonb_array_elements(rec->\'lines\') other');
  });
});
