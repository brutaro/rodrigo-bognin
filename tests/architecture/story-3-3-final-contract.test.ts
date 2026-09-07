import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/030_source_reconciliation.sql", "utf8");
const component = readFileSync("src/components/consolidated-source-reconciliation.tsx", "utf8");
const postgresRepository = readFileSync("src/modules/source-ledger/adapters/postgres-reconciliation-repository.ts", "utf8");
const stableSearch = readFileSync("src/modules/source-ledger/application/stable-record-search.ts", "utf8");
const postgresIntegration = readFileSync("tests/integration/story-3-3-postgres.integration.test.ts", "utf8");

function definition(start: string, end: string) {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Definição ausente: ${start}`);
  return migration.slice(from, to);
}

describe("contratos finais da Story 3.3", () => {
  it("faz uma única descida AVL, preserva snapshots verificados e publica o diagnóstico real", () => {
    const inner = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_absence_rows(p_reconciliation_id uuid,p_after_stable_record_id uuid,p_limit integer)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_absence_page(p_reconciliation_id uuid,p_after_stable_record_id uuid,p_limit integer)",
    );
    const anchor = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_verify_absence_anchor(p_reconciliation_id uuid)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_absence_rows(p_reconciliation_id uuid)",
    );
    const outer = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_absence_page(p_reconciliation_id uuid,p_after_stable_record_id uuid,p_limit integer)",
      "CREATE TABLE src_effective_snapshot",
    );
    expect(inner.match(/cursor:=rec\.absence_root_id/g)).toHaveLength(1);
    expect(inner).toContain("source_reconciliation_avl_load_verified_node(lineage,cursor)");
    expect(inner).toContain("stack_keys:=array_append");
    expect(inner).toContain("stack_items:=array_append");
    expect(inner).toContain("stack_rights:=array_append");
    expect(inner).toContain("IF emitted>=p_limit THEN EXIT;END IF;");
    expect(inner).toContain("is_diagnostic:=true");
    expect(inner).toContain("logical_node_visits integer,authenticated_node_row_reads integer,tree_height integer");
    expect(inner).toContain("loader_reads:=1+(n.left_id IS NOT NULL)::integer+(n.right_id IS NOT NULL)::integer");
    expect(inner).not.toMatch(/OFFSET|src_reconciliation_absence_(?:head|span|key)/i);
    expect(anchor.match(/source_reconciliation_avl_load_verified_node/g)).toHaveLength(1);
    expect(anchor).toMatch(/n:=source_reconciliation_avl_load_verified_node/);
    expect(anchor).not.toMatch(/SELECT\s+\*\s+INTO\s+n\s+FROM\s+public\.src_reconciliation_absence_node/i);
    expect(outer).toContain("logical_node_visits integer,authenticated_node_row_reads integer,tree_height integer");
    expect(outer).toContain("max(traversal.authenticated_node_row_reads)");
    expect(outer).toContain("WITH traversal AS MATERIALIZED");
    expect(outer).toContain("WHERE NOT traversal.is_diagnostic");
    expect(postgresIntegration).not.toContain("FROM source_reconciliation_absence_rows(${sparseHistoricalId}");
    expect(postgresIntegration).toContain("SELECT * FROM source_reconciliation_absence_page(${sparseHistoricalId}");
  });

  it("centraliza a precedência efetiva em um resolver privado e indexado", () => {
    const resolver = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_effective_record(p_record_id uuid)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_stable_record_page(",
    );
    const metrics = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_metrics(p_lines jsonb)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_metric_accumulator(p_lines jsonb)",
    );
    const accumulator = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_metric_accumulator(p_lines jsonb)",
      "CREATE OR REPLACE FUNCTION write_source_reconciliation(p_operation text, p_graph jsonb)",
    );
    const writer = definition(
      "CREATE OR REPLACE FUNCTION write_source_reconciliation(p_operation text, p_graph jsonb)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_field_diffs",
    );
    const fieldDiffs = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_field_diffs",
      "CREATE OR REPLACE FUNCTION source_reconciliation_chain_hash",
    );
    const atomicDecision = definition(
      "CREATE OR REPLACE FUNCTION write_source_reconciliation_decision(",
      "CREATE OR REPLACE FUNCTION source_reconciliation_verify_lineage",
    );
    const apply = definition(
      "CREATE OR REPLACE FUNCTION apply_source_reconciliation(",
      "CREATE OR REPLACE FUNCTION read_source_reconciliation",
    );
    expect(migration.match(/CREATE OR REPLACE FUNCTION source_reconciliation_effective_record/g)).toHaveLength(1);
    expect(resolver).toContain("stable_exists boolean");
    expect(resolver).toContain("projection_exists boolean");
    expect(resolver).toContain("IF has_projection AND projection_row.decision_event_id IS NOT NULL THEN");
    expect(resolver).toContain("IF has_projection AND projection_row.adjustment_event_id IS NOT NULL THEN");
    expect(resolver).toContain("IF has_projection AND projection_row.source_observation_id IS NOT NULL THEN");
    expect(resolver).toContain("ORDER BY event.occurred_at DESC,event.id DESC LIMIT 1");
    expect(resolver.indexOf("IF decision_found THEN")).toBeGreaterThan(resolver.indexOf("IF has_projection AND projection_row.source_observation_id IS NOT NULL THEN"));
    expect(resolver).toContain("effective_payload:=decision_payload; decimal_sources:=decision_decimal; duration_sources:=decision_duration");
    expect(resolver).toContain("effective_payload:='{}'::jsonb; decimal_sources:=NULL; duration_sources:=NULL; effective_layer:='source'");
    expect(migration).toContain("CREATE INDEX src_effective_record_event_source_lookup_idx");
    expect(migration).toContain("(record_id, observation_id, occurred_at DESC, id DESC)");
    expect(migration).toContain("INCLUDE (payload, decimal_sources, duration_sources)");
    expect(migration).toContain("WHERE layer = 'source' AND event_type IN ('record.inserted', 'observation.accepted')");
    for (const consumer of [metrics, accumulator, writer, fieldDiffs, atomicDecision, apply])
      expect(consumer).toContain("source_reconciliation_effective_record(");
    for (const consumer of [metrics, accumulator, writer, fieldDiffs, atomicDecision])
      expect(consumer).not.toMatch(/\bp\.(?:payload|decimal_sources|duration_sources)\b/);
    expect(apply).toContain("preserved_payload,preserved_decimal_sources,preserved_duration_sources");
    expect(apply).toContain("'payload',effective.effective_payload,'decimal_sources',effective.decimal_sources");
    expect(migration).toContain("'source_reconciliation_effective_record(uuid)'");
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION source_reconciliation_effective_record/i);
    expect(postgresRepository).toContain("const effectiveEvent = decisionEvent ?? adjustmentEvent ?? sourceEvent");
    expect(postgresRepository).toContain("if (row.source_observation_id && !sourceEvent) throw new ReconciliationIntegrityFailure()");
  });

  it("mantém o loader AVL privado na allowlist negativa exata", () => {
    const signature = "source_reconciliation_avl_load_verified_node(uuid,uuid)";
    expect(migration.match(new RegExp(signature.replace(/[()]/g, "\\$&"), "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION source_reconciliation_avl_load_verified_node/i);
  });

  it("mantém validators JSON privados e valida staging por trigger definer guardado", () => {
    const staging = definition(
      "ALTER TABLE src_import_staging_row",
      "-- Story 3.3 extends the synthetic registry",
    );
    expect(staging).not.toMatch(/ADD CONSTRAINT[\s\S]*CHECK \(source_reconciliation_(?:has_reserved_key|valid_decimal_sources|valid_duration_sources)/);
    expect(staging.indexOf("DO $validate_existing_story33_staging$")).toBeLessThan(staging.indexOf("CREATE TRIGGER src_import_staging_row_story33_validate"));
    expect(staging).toContain("source_reconciliation_validate_staging_row_json()");
    expect(staging).toContain("SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp");
    for (const guard of ["TG_NAME", "TG_RELID", "TG_OP", "TG_WHEN", "TG_LEVEL", "TG_NARGS", "pg_trigger_depth()"])
      expect(staging).toContain(guard);
    for (const constraint of ["src_import_staging_row_duration_sources_shape", "src_import_staging_row_matching_attributes_shape", "src_import_staging_row_decimal_sources_canonical", "src_import_staging_row_payload_reserved_keys"])
      expect(staging.match(new RegExp(constraint, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(staging.match(/ERRCODE = '23514'/g)).toHaveLength(8);
    const grants = migration.match(/GRANT EXECUTE ON FUNCTION[^;]+TO tria_app;/g)?.join("\n") ?? "";
    expect(grants).not.toMatch(/source_reconciliation_(?:has_reserved_key|valid_decimal_sources|valid_duration_sources)/);
    const appAllowlist = migration.slice(migration.indexOf("app_execute constant text[]"), migration.indexOf("BEGIN", migration.indexOf("app_execute constant text[]")));
    expect(appAllowlist.match(/'[^']+\([^']*\)'/g)).toHaveLength(8);
    expect(appAllowlist).not.toMatch(/has_reserved_key|valid_decimal_sources|valid_duration_sources/);
  });

  it("resolve replay exato sob lock antes de colisão/freshness da revisão", () => {
    const save = postgresRepository.slice(
      postgresRepository.indexOf("private async saveReconciliationWith"),
      postgresRepository.indexOf("async saveReconciliation(value"),
    );
    const requestLookup=save.indexOf("FROM src_reconciliation_request q");
    const directCollision=save.indexOf("SELECT id::text FROM src_reconciliation WHERE idempotency_key");
    expect(requestLookup).toBeGreaterThanOrEqual(0);
    expect(requestLookup).toBeLessThan(directCollision);
    expect(save).toContain("JOIN src_reconciliation root ON root.id=q.root_reconciliation_id");
    expect(save).toContain("q.root_request_hash::text request_root_hash");
    expect(save).toContain("root.root_request_hash::text stored_root_hash");
    expect(save).toContain("root.rootRequestHash!==requestByKey.stored_root_hash");
    expect(save).toContain("value.reconciliation.rootRequestHash!==requestByKey.stored_root_hash");
    const exactBranch=save.slice(save.indexOf("if (requestByKey)"),directCollision);
    expect(exactBranch).not.toContain("value.fingerprint");
    expect(exactBranch).toContain("this.oneLeaf(requestByKey.root_id, tx)");
    expect(postgresIntegration).toContain("await saveEntered");
    expect(postgresIntegration).toContain("await admin`UPDATE src_projection_version SET version=version+1 WHERE singleton`");
    expect(postgresIntegration).toContain("expect(a.reused).toBe(true)");
    expect(postgresIntegration).toContain("await aPromise.catch(()=>undefined)");
  });

  it("define uma única semântica canônica de busca antes da paginação", () => {
    const searchMethod = postgresRepository.slice(
      postgresRepository.indexOf("async searchStableRecords"),
      postgresRepository.indexOf("async listAbsences"),
    );
    const pager = definition(
      "CREATE OR REPLACE FUNCTION source_reconciliation_stable_record_page(",
      "CREATE TRIGGER src_reconciliation_request_immutable",
    );
    const rootWriter = definition(
      "CREATE OR REPLACE FUNCTION write_source_reconciliation(p_operation text, p_graph jsonb)",
      "CREATE OR REPLACE FUNCTION source_reconciliation_field_diffs",
    );
    const application = definition(
      "CREATE OR REPLACE FUNCTION apply_source_reconciliation(",
      "CREATE OR REPLACE FUNCTION read_source_reconciliation",
    );
    expect(pager).toMatch(/BEGIN\s+IF session_user<>'tria_app'/);
    expect(pager).toContain("p_limit IS NULL OR p_limit<1 OR p_limit>101");
    expect(pager).toContain("p_query IS NULL OR p_query<>lower(btrim(p_query))");
    expect(pager).toContain("WITH resolved AS MATERIALIZED");
    expect(pager).toContain("CROSS JOIN LATERAL public.source_reconciliation_effective_record(record.id)");
    expect(pager.indexOf("WITH resolved AS MATERIALIZED")).toBeLessThan(pager.indexOf("matching AS MATERIALIZED"));
    expect(pager.indexOf("matching AS MATERIALIZED")).toBeLessThan(pager.indexOf("SELECT count(*)::text AS total FROM matching"));
    expect(pager.indexOf("SELECT count(*)::text AS total FROM matching")).toBeLessThan(pager.indexOf("candidate.id>p_after_id"));
    expect(pager).toContain("lower(attribute.key) NOT IN ('curso','trilha')");
    expect(pager).toContain("ARRAY['codigo','referencia','data','valor','duracao']::text[]");
    expect(pager).toContain("ESCAPE chr(92)");
    expect(pager).not.toContain("OFFSET");
    expect(searchMethod).toContain("FROM source_reconciliation_stable_record_page(");
    expect(searchMethod).not.toContain("WITH matching AS NOT MATERIALIZED");
    expect(searchMethod).not.toContain("FROM src_effective_record_projection");
    expect(searchMethod).not.toContain("this.stableRecords");
    expect(searchMethod).not.toContain("matching_attributes::text ILIKE");
    expect(searchMethod).not.toMatch(/payload->>'(?:codigo|referencia|data|valor|duracao)'\s+ILIKE/);
    expect(stableSearch).toContain("IGNORED_RECONCILIATION_FIELDS");
    expect(stableSearch).toContain("stableRecordSearchAttributes(record.matchingAttributes)");
    expect(searchMethod).toContain("matchingAttributes: stableRecordSearchAttributes(");
    expect(rootWriter).not.toContain("source_reconciliation_stable_record_page(");
    expect(application).not.toContain("source_reconciliation_stable_record_page(");
  });

  it("mantém os tickets de busca no componente e exige Buscar explícito", () => {
    expect(component).toContain("const targetRequests = useRef(new Map");
    expect(component).toContain("targetRequests.current.delete(requestKey)");
    expect(component).not.toContain("const targetRequestSequences = new Map");
    expect(component).not.toContain("onFocus={() =>");
    const input = component.slice(component.indexOf("<input id={`stable-search-"), component.indexOf("<select id={`stable-target-"));
    expect(input).toContain('? "Buscando…" : "Buscar"');
    expect(input).not.toContain("searchTargets(reconciliation.id, line.observation.id, query, 0)");
    expect(component).toContain('aria-label={`Decisão auditada para ${line.observation.locator}`}');
    expect(component).toContain("line.decision.stableRecordId");
  });
});
