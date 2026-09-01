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

## Design Notes

A interface distinguirá “Auditoria importada” de “Ajustado por Rodrigo”. Gráficos ficam apenas nos PDFs: horas por BM no projeto; status e tendência temporal no global.

## Verification

**Commands:**
- `npm run check` e `npm audit --omit=dev --audit-level=high` — qualidade e dependências aprovadas.
- `docker compose run --rm --no-deps migrate npm run db:validate` — migrações, ACL e invariantes válidos.
- Integração com `COMPOSE_PROJECT_NAME=tria-adjustments-*` e `TRIA_INTEGRATION_ISOLATED=confirmed` — fluxo real isolado aprovado.
- `git diff --check` — diff válido; fontes e BMAD intactos.


**Resultados executados:** 95 testes em doze arquivos, lint, TypeScript e build passaram no host e no contêiner de ferramentas. A migração 023 foi aplicada do zero em PostgreSQL 16 isolado. `db:validate` aprovou 59 projetos, 3.364 atividades, 142 NFS-e, ACL, funções e visões efetivas. O smoke `tria-adjustments-*` aprovou idempotência, concorrência, restauração, atomicidade fiscal, confirmação de duplicidade, publicação V4, PDFs autenticados, cofre e falhas fechadas. PDFs de projeto e global foram gerados no contêiner standalone, tinham duas páginas, texto extraível e SHA-256 coincidente com o cabeçalho. Banco indisponível retornou 503. `npm audit --omit=dev --audit-level=high` encontrou zero vulnerabilidades.

## Suggested Review Order

**Modelo auditável e consistência**

- Comece pelo contrato append-only, visões efetivas, locks, restauração e ACL.
  [`023_owner_adjustment_revisions.sql:2`](../db/migrations/023_owner_adjustment_revisions.sql#L2)

- O repositório serializa tentativas e converte conflitos sem expor o banco.
  [`source-adjustment-repository.ts:37`](../src/lib/source-adjustment-repository.ts#L37)

- Todas as leituras de projeto passam a distinguir fonte e valor efetivo.
  [`project-repository.ts:108`](../src/lib/project-repository.ts#L108)

**Publicação imutável V4**

- A publicação lê a composição efetiva sob o mesmo lock do projeto.
  [`workspace.ts:142`](../src/lib/workspace.ts#L142)

- O builder V4 congela conteúdo e proveniência sem tocar V1–V3.
  [`demo-workspace.ts:548`](../src/lib/demo-workspace.ts#L548)

- O exportador V4 usa allowlist, sanitização e universos financeiros separados.
  [`demo-publication-export-v4.ts:25`](../src/lib/demo-publication-export-v4.ts#L25)

**Edição do proprietário**

- A tabela de atividades combina desktop, cartões móveis e retorno de foco.
  [`editable-activity-table.tsx:60`](../src/components/editable-activity-table.tsx#L60)

- O editor fiscal mantém declarado e candidato distintos numa revisão atômica.
  [`editable-fiscal-notes.tsx:56`](../src/components/editable-fiscal-notes.tsx#L56)

- As actions de atividade validam origem, revisão, motivo e valores assinados.
  [`actions.ts:87`](../src/app/projetos/[id]/actions.ts#L87)

- As actions fiscais falham fechadas e devolvem conflitos comparáveis.
  [`notas-fiscais/actions.ts:18`](../src/app/notas-fiscais/actions.ts#L18)

**Relatórios privados**

- O modelo nasce de uma leitura PostgreSQL repeatable-read e não mistura universos.
  [`reports/repository.ts:30`](../src/lib/reports/repository.ts#L30)

- Os documentos A4 unem gráficos vetoriais, tabelas equivalentes e histórico.
  [`documents.tsx:38`](../src/lib/reports/documents.tsx#L38)

- A rota autentica, bloqueia cache e publica hashes de bytes e modelo.
  [`route.ts:9`](../src/app/api/reports/projects/[id]/route.ts#L9)

**Verificação e limites**

- O smoke isolado cobre concorrência, idempotência, V4, PDFs e cofre.
  [`integration-smoke.mjs:83`](../scripts/integration-smoke.mjs#L83)

- A validação confirma migração, visões seguras, funções e privilégio mínimo.
  [`validate-database.mjs:6`](../scripts/validate-database.mjs#L6)

- O teste extrai texto e força paginação de linhas longas no PDF.
  [`report-document.test.tsx:30`](../src/lib/reports/report-document.test.tsx#L30)

