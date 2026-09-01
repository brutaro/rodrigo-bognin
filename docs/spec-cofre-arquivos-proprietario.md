---
title: 'Cofre de arquivos com controle total do proprietário'
type: 'feature'
created: '2026-08-31'
status: 'complete'
review_loop_iteration: 1
baseline_commit: '5f7513cdea43b93bf75cf9f47219a2e2ca6d6765'
context:
  - 'PLANO_B_TRIA/docs/runtime-boundaries.md'
  - 'PLANO_B_TRIA/docs/docker-local.md'
---

<frozen-after-approval reason="intenção controlada pelo proprietário — não modificar sem renegociação humana">

## Intent

**Problema:** O Plano B não autentica Rodrigo e o botão de arquivo é inativo. O filesystem do contêiner é descartável e o backup atual não contém bytes de arquivos.

**Abordagem:** Criar cofre pessoal autenticado por código permanente, com volume obrigatório, versões, download, expurgo total e backup manual verificável. Validar localmente em Docker; não ativar Railway/R2/deploy.

## Boundaries & Constraints

**Always:** Um usuário/ator: Rodrigo. Código de login secreto, permanente e reutilizável; logout encerra só a sessão. Código e chave de sessão vêm de files secrets, nunca Git, banco, URL ou log. Proteger páginas, actions, exportações e arquivos; somente `/entrar`, assets e health mínimo são públicos. Cookie HttpOnly/SameSite=Strict; TLS/Secure é obrigatório fora do loopback. Volume dedicado com sentinel/UUID e quota exata de 9.000.000.000 bytes, incluindo reservas. Mount ausente, incorreto, cheio ou read-only derruba readiness e bloqueia arquivos, sem fallback. Upload só confirma após reserva, limite, SHA-256, `fsync`, rename atômico e commit. Cada versão tem objeto opaco próprio; nunca executar/consultar/renderizar conteúdo enviado. Rodrigo pode baixar e expurgar bytes, versões, vínculos e referências publicadas mediante código + `EXCLUIR`. Para não reter referência em cadeia imutável, o expurgo elimina a primeira publicação que contém o arquivo e todas as versões posteriores do projeto. Backup manual inclui todos os objetos ativos e catálogo canônico com hashes, versões e vínculos. Cópias já baixadas ficam fora do sistema.

**Ask First:** Ativar Railway/R2/deploy, custo externo, elevar 9 GB, apagar volume/banco real ou fazer migração destrutiva de dados existentes.

**Never:** Gravar no rootfs/`/tmp`, usar fallback silencioso, versionar bytes/segredos/dados reais, expor banco, alterar fontes, `_bmad`, `_bmad-output` ou `.agents`, executar arquivos, usar `docker compose down -v`.

## I/O & Edge-Case Matrix

| Cenário | Estado | Comportamento | Falha |
|---|---|---|---|
| Login | Código correto | Sessão de Rodrigo | Erro único, atraso e throttle |
| Upload | Volume íntegro e quota | Versão durável e hash conferido | Sem confirmação; staging/órfão reconciliado |
| Download | Sessão + versão ativa | Attachment original, `no-store` | Corrupção não envia byte parcial |
| Expurgo | Código + `EXCLUIR` | Remove tudo e publicações dependentes | Estado `purging` retomável |
| Backup | Clique autenticado | ZIP completo + manifesto verificado | Ausência/adulteração cancela bundle |
| Volume | Mount inválido | Readiness 503 | Nunca usa filesystem efêmero |

</frozen-after-approval>

## Code Map

- `compose.yaml`, `Dockerfile`, `.env.example` — secrets, volume/init e readiness sem nova imagem.
- `db/migrations/015_*.sql` a `022_*.sql` — quota, documentos/versões, purge, trilha, sessões revogáveis e grants mínimos.
- `src/lib/auth.ts`, `src/proxy.ts`, `src/app/entrar/*` — código permanente, sessão, throttle e login/logout.
- `src/lib/file-store.ts`, `src/lib/file-repository.ts` — streaming, atomicidade, quota, download, reconciliação e purge.
- `src/app/api/projects/[id]/files/*`, `src/app/api/files/*`, `src/components/project-files.tsx` — APIs/UI autenticadas.
- `src/lib/workspace.ts`, `src/lib/demo-publication-export.ts` — snapshot/renderer v3; v1/v2 congelados.
- `src/app/api/backups/files/route.ts`, `scripts/restore-file-backup.mjs` — ZIP/catálogo e restore isolado.
- `src/app/api/health/route.ts`, `scripts/{validate-database,integration-smoke}.mjs` — invariantes e E2E.

## Tasks & Acceptance

**Execution:**
- [x] Banco/auth — schema, secrets, cookie, throttle, guards e privilégios fail-closed.
- [x] Storage — upload streaming, versões, download, quota, reconciliação e purge retomável.
- [x] UI/publicação/backup — ativar arquivos, inclusão, confirmação, renderer v3, logout e ZIP manual.
- [x] Docker/testes/docs — volume obrigatório, restore, restart/recreate, segurança e scans de proteção.

**Acceptance Criteria:**
- Given app recriado com mesmo DB/volume, when Rodrigo entra, then arquivos e hashes permanecem válidos.
- Given volume ausente/efêmero, when app inicia, then readiness falha e upload/backup recusam.
- Given backup, when restaurado isoladamente, then catálogo, bytes, ACL e SHA-256 coincidem.
- Given arquivo publicado, when Rodrigo confirma purge, then não resta byte, versão, vínculo ou publicação dependente no sistema ativo.
- Given anônimo, when acessa dados/mutação/export/arquivo, then recebe redirect/401 sem conteúdo privado.

## Spec Change Log

- 2026-08-31 — Implementação concluída localmente: auth, cofre versionado, publicação v3, expurgo, backup/restore e validação Docker.
- 2026-09-01 — Gate adversarial aprovado após corrigir ciclo de vida de streams, ACL integral, revogação de sessão e isolamento destrutivo.

## Design Notes

Versões usam `objects/<UUID>` sem dedupe; SHA-256 é somente integridade. Backup é ZIP streaming sob demanda, sem cron/provedor, com manifesto `tria-file-backup-v1`; restore é CLI e nunca substitui DB/volume principal em teste. Escritas usam reservas transacionais e staging no mesmo filesystem. Falha após rename deixa órfão invisível que o reconciliador remove; purge só conclui após `unlink`+`fsync`+commit.

## Verification

**Commands:**
- `npm run check` e `docker compose run --rm --no-deps migrate npm run check` — testes/lint/build.
- Em projeto Compose descartável `tria-vault-*`, com `TRIA_INTEGRATION_ISOLATED=confirmed`: `docker compose --profile validation run --rm --no-deps integration` — auth, storage, publicação v3, grants e HTTP reais.
- `npm run db:validate` — migrações, quota e catálogo.
- `node scripts/restore-file-backup.mjs --verify-only <bundle>` — manifesto/bytes.
- Recriar app, restaurar em DB/volume temporários, testar download/purge e confirmar somente imagens finais.


**Resultados executados:** 83 testes em dez arquivos, lint, TypeScript e build passaram; migrações e privilégios passaram com `migrations: 22`. O smoke em uma pilha `tria-vault-*` criada do zero passou autenticação, throttle, revogação de sessão, três versões, publicação v3 real, prévia obsoleta, cadeia V1→V2, download por snapshot, corrupção, volume inválido, quota, backup/restore e expurgo retomável/final. Restart conjunto e recreate do app preservaram a sessão no PostgreSQL, os bytes e o SHA-256. O restore recusou destino existente sem removê-lo. O dump final foi restaurado e `tria_app` permaneceu sem DDL. A pilha principal recusou o teste destrutivo e ficou limpa.
