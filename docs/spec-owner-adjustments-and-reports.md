---
title: 'Ajustes auditáveis e relatórios gerenciais em PDF'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: '5565f49bcbabad63e2eb24ebbe4ca59d5edc3f88'
review_loop_iteration: 0
context:
  - 'PLANO_B_TRIA/docs/runtime-boundaries.md'
  - 'PLANO_B_TRIA/docs/spec-cofre-arquivos-proprietario.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Rodrigo não consegue corrigir horas e valor medido das atividades nem os campos operacionais das NFS-e. Também não há relatório gerencial em PDF por projeto ou global.

**Approach:** Manter valores importados imutáveis e aplicar revisões auditáveis como valores efetivos. Oferecer editores claros e gerar PDFs privados a partir de uma leitura PostgreSQL consistente, com poucos gráficos úteis.

## Boundaries & Constraints

**Always:** Rodrigo é o único editor; todo ajuste exige motivo e registra antes/depois, revisão, horário e ator; tentativas são idempotentes e usam revisão esperada; valores efetivos alimentam telas, novas publicações, exportações e relatórios; publicações anteriores permanecem imutáveis; horas, medição, NFS-e, relação e pagamento são universos distintos; PDFs são autenticados, privados, sem cache, íntegros e com texto selecionável.

**Ask First:** ativar deploy/Railway/R2; alterar fontes, BMAD, publicações anteriores ou dados reais; criar dashboard autônomo; executar teste destrutivo fora de Docker descartável.

**Never:** atualizar `bm_activity`, `fiscal_note` ou `financial_relation`; somar medição com faturamento ou pagamento; equiparar projeto declarado e auditado; usar GET para editar; depender só da interface para autorizar; renderizar uploads; gravar PDF no rootfs; expor segredo, PII, caminho, objeto ou erro SQL.

## I/O & Edge-Case Matrix

| Cenário | Entrada / estado | Comportamento | Erro |
|---|---|---|---|
| Atividade | Horas/medição válidas, motivo e revisão atual | Nova revisão; fonte intacta; totais e prévia atualizados | Inválido não grava; revisão antiga conflita |
| NFS-e | Todos os campos da linha e relação composta | Revisão atômica; projetos afetados invalidados | FK/combinação inválida não grava; duplicidade exige confirmação |
| Restaurar | Registro ajustado | Nova revisão repõe importado e preserva histórico | Repetição não duplica |
| Publicar | Prévia efetiva | Snapshot v4 congela valor e proveniência | Ajuste concorrente obsoleta a prévia |
| PDF | Sessão válida e banco disponível | PDF A4 por projeto/global, paginado e verificável | 401 anônimo; 404 projeto; 503 banco |

</frozen-after-approval>

## Code Map

- `db/migrations/001_initial.sql` — fontes e snapshots canônicos; somente leitura.
- `db/migrations/023_owner_adjustment_revisions.sql` — revisões append-only, visões efetivas, funções e ACL.
- `src/lib/project-repository.ts` e `source-adjustment-repository.ts` — valores efetivos, histórico e gravação controlada.
- `src/app/projetos/[id]/*` e `src/components/editable-activity-table.tsx` — edição de horas/medição.
- `src/app/notas-fiscais/*` e `src/components/editable-fiscal-notes.tsx` — edição integral das linhas fiscais.
- `src/lib/workspace.ts`, `demo-workspace.ts`, `demo-publication-export.ts` — snapshot/exportação v4; v1–v3 congelados.
- `src/lib/reports/*` e `src/app/api/reports/*` — modelo, consultas, gráficos, PDF e downloads.
- `scripts/validate-database.mjs` e `scripts/integration-smoke.mjs` — ACL, concorrência, publicação, PDF e Docker.

## Tasks & Acceptance

**Execution:**
- [x] Criar a migração 023 com versões completas append-only, origem versus efetivo, restauração, funções `SECURITY DEFINER`, invalidação determinística e privilégio mínimo.
- [x] Adaptar tipos, consultas e actions para validação, motivo obrigatório, idempotência, histórico e conflito por linha.
- [x] Criar editores acessíveis: tabelas no desktop, cartões sem rolagem horizontal no celular, original/efetivo, estado de salvamento e retorno de foco.
- [x] Editar atividade somente em horas e medição; aceitar horas acima de 24, ausência explícita, zero e medição BRL assinada sem recalcular um campo pelo outro.
- [x] Editar NFS-e, emissão, valor, categoria, projeto declarado e relação. Relação inclui candidato, força, estado, elegibilidade e valor relacionado, sem copiar automaticamente o declarado.
- [x] Publicar valores efetivos em v4 com proveniência e manter v1–v3 inalterados.
- [x] Gerar PDF com `@react-pdf/renderer` e fontes locais. Projeto: resumo, horas por BM, atividades, finanças separadas, evidências e histórico. Global: cobertura, status, tendência, portfólio e universos financeiros separados. Toda visualização terá tabela equivalente; não haverá dashboard autônomo.
- [x] Testar domínio, semântica do PDF, autenticação, ACL, duas gravações concorrentes, restauração, prévia obsoleta e Docker isolado.

**Acceptance Criteria:**
- Given uma fonte importada, when Rodrigo ajusta ou restaura, then a fonte não muda e todas as versões ficam comprovadas.
- Given duas alterações na mesma revisão, when concorrem, then só uma vence e a outra mostra comparação, sem perda silenciosa.
- Given publicação antiga e correção posterior, when consultadas, then a antiga mantém bytes e a próxima usa v4 efetivo.
- Given PDF por projeto ou global, when Rodrigo baixa, then ele é legível, paginado, íntegro e não mistura universos financeiros.
- Given sessão inválida, SQL indevido ou banco indisponível, when há edição ou relatório, then o sistema falha fechado sem vazamento.

## Spec Change Log

- 2026-09-01 — Implementação concluída para revisão: ajustes append-only de atividades e NFS-e, publicação efetiva V4, editores responsivos e relatórios PDF privados por projeto e global.
- 2026-09-01 — Revisão adversarial corrigiu retry simultâneo, comparação de conflito fiscal, estados restaurados, sanitização/allowlist V4, paginação longa e verificação semântica dos PDFs.

- 2026-09-01 — Inspeção visual real eliminou sobreposição, meses futuros, títulos órfãos e JSON técnico dos PDFs.

## Design Notes

A interface distinguirá “Auditoria importada” de “Ajustado por Rodrigo”. Gráficos ficam apenas nos PDFs: horas por BM no projeto; status e tendência temporal no global.

## Verification

**Commands:**
- `npm run check` e `npm audit --omit=dev --audit-level=high` — qualidade e dependências aprovadas.
- `docker compose run --rm --no-deps migrate npm run db:validate` — migrações, ACL e invariantes válidos.
- Integração com `COMPOSE_PROJECT_NAME=tria-adjustments-*` e `TRIA_INTEGRATION_ISOLATED=confirmed` — fluxo real isolado aprovado.
- `git diff --check` — diff válido; fontes e BMAD intactos.


**Resultados executados:** 108 testes em 14 arquivos, lint, TypeScript e build passaram no host. As migrações 001–024 foram aplicadas do zero e em upgrade sobre 001–023 no PostgreSQL 16. `db:validate` aprovou 59 projetos, 3.364 atividades, 142 NFS-e, 72 vínculos, ACL, funções, visões efetivas e marcadores de isolamento. O smoke Docker independente aprovou autenticação, cofre, precisão, idempotência concorrente, conflito, restauração, domínio fiscal, action real, publicação V4, PDFs, backup, corrupção e expurgo. Os PDFs autenticados foram renderizados e inspecionados página a página: projeto e global sem sobreposição, título órfão, JSON técnico ou universos financeiros misturados. `npm audit --omit=dev --audit-level=high` encontrou zero vulnerabilidades; `git diff --check` passou.

## Suggested Review Order

**Modelo auditável e consistência**

- Comece pelo contrato append-only, valores efetivos e restauração da fonte.
  [`023_owner_adjustment_revisions.sql:2`](../db/migrations/023_owner_adjustment_revisions.sql#L2)

- O endurecimento garante precisão, idempotência concorrente, domínio fiscal e isolamento.
  [`024_owner_adjustment_hardening.sql:69`](../db/migrations/024_owner_adjustment_hardening.sql#L69)

- O repositório converte conflitos sem conceder DML direto à aplicação.
  [`source-adjustment-repository.ts:37`](../src/lib/source-adjustment-repository.ts#L37)

- As consultas distinguem origem, efetivo e cadeia completa de revisões.
  [`project-repository.ts:114`](../src/lib/project-repository.ts#L114)

**Edição do proprietário**

- A atividade preserva segundos e precisão decimal em desktop e celular.
  [`editable-activity-table.tsx:49`](../src/components/editable-activity-table.tsx#L49)

- A NFS-e mantém declaração e relação auditada como fatos distintos.
  [`editable-fiscal-notes.tsx:37`](../src/components/editable-fiscal-notes.tsx#L37)

**Publicação imutável V4**

- A publicação lê a composição efetiva sob o lock do projeto.
  [`workspace.ts:142`](../src/lib/workspace.ts#L142)

- O exportador V4 redige caminhos e preserva os renderizadores anteriores.
  [`demo-publication-export-v4.ts:27`](../src/lib/demo-publication-export-v4.ts#L27)

**Relatórios privados**

- A consulta repeatable-read separa universos e preenche apenas lacunas temporais reais.
  [`repository.ts:156`](../src/lib/reports/repository.ts#L156)

- O documento A4 controla chunks, cabeçalhos, gráficos e histórico legível.
  [`documents.tsx:83`](../src/lib/reports/documents.tsx#L83)

- Limites explícitos protegem memória, consulta, célula e tamanho final.
  [`limits.ts:2`](../src/lib/reports/limits.ts#L2)

**Verificação e limites**

- O smoke comprova concorrência real, action fiscal, V4, PDFs e cofre.
  [`integration-smoke.mjs:117`](../scripts/integration-smoke.mjs#L117)

- A validação confirma 24 migrações, ACL e invariantes operacionais.
  [`validate-database.mjs:74`](../scripts/validate-database.mjs#L74)

- O teste semântico impede regressões de paginação e linguagem técnica.
  [`report-document.test.tsx:44`](../src/lib/reports/report-document.test.tsx#L44)
