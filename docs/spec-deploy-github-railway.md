---
title: 'Publicar o TRIA privado no GitHub e Railway Hobby'
type: 'feature'
created: '2026-09-01'
status: 'in-review'
baseline_commit: '8dde05a66cb0f4121096fdfab1844ec719f3787c'
review_loop_iteration: 0
context:
  - '{project-root}/PLANO_B_TRIA/docs/spec-cofre-arquivos-proprietario.md'
  - '{project-root}/PLANO_B_TRIA/docs/runtime-boundaries.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problema:** O TRIA funciona somente no Docker local e o cofre ainda não contém os 53 arquivos probatórios catalogados. Rodrigo precisa acessar uma instância privada e autossuficiente sem depender das pastas desta máquina.

**Abordagem:** Publicar somente `PLANO_B_TRIA` no repositório privado `brutaro/rodrigo-bognin`, adaptar o runtime para Railway Hobby e carregar uma única cópia verificada de cada evidência no cofre, mantendo seus 72 vínculos com projetos.

## Boundaries & Constraints

**Always:** usar Railway Hobby de US$ 5 com cobrança excedente aceita; manter PostgreSQL e cofre em volumes separados de até 5 GB; fixar a quota lógica em `4.000.000.000` bytes por nova migração; transferir 53 evidências únicas (`1.126.834.973` bytes) fora do GitHub; preservar hashes, 72 vínculos e acesso a cada evidência pelas páginas dos projetos; PostgreSQL privado; TLS, cookies seguros, sessão obrigatória e secrets em arquivos; GitHub privado; CI, health check, backup, restore isolado e rollback validados antes do corte.

**Ask First:** solicitar somente login, 2FA ou confirmação interativa do GitHub/Railway; interromper antes de apagar recursos externos, volumes, backups ou dados legítimos.

**Never:** contratar Railway Pro; ativar R2 ou OCI; versionar fontes reais, evidências, dumps, uploads ou secrets; publicar o repositório; enviar o diretório pai ao GitHub; alterar PBIX, planilhas, `_bmad`, `_bmad-output`, `.agents` ou entregáveis históricos; executar `docker compose down -v`; duplicar bytes para evidências ligadas a mais de um projeto.

## I/O & Edge-Case Matrix

| Cenário | Entrada / estado | Comportamento esperado | Tratamento de erro |
|---|---|---|---|
| Publicação | Repositório remoto privado e vazio | Push apenas do histórico de `PLANO_B_TRIA` | Bloquear se scanner encontrar secret ou dado real |
| Hobby | Volume de 5 GB | Health verde com quota lógica de 4 GB | Falhar fechado se espaço disponível não cobrir a quota restante |
| Evidências | Arquivo de carga com 53 hashes esperados | Uma versão física por evidência e acesso pelos 72 vínculos | Cancelar sem carga parcial diante de falta, excesso ou hash divergente |
| Deploy | Migração ou inicialização falha | Novo deployment não recebe tráfego | Preservar deployment anterior e registrar logs |
| Proxy | Host/protocolo encaminhado adulterado | Apenas HTTPS reconhecido pelo proxy confiável é aceito | Rejeitar origem incompleta ou insegura |

</frozen-after-approval>

## Code Map

- `PLANO_B_TRIA/Dockerfile` e `compose.yaml` — runtime Linux validado; Railway exige preparação de volume root-owned, secrets e `PORT`.
- `PLANO_B_TRIA/db/migrations/015_owner_file_vault.sql` — contrato histórico de 9 GB, imutável; a correção será aditiva.
- `PLANO_B_TRIA/src/lib/file-repository.ts` e `file-store.ts` — reserva, quota, SHA-256, fsync, locks e objetos opacos.
- `PLANO_B_TRIA/src/lib/project-repository.ts` — lê os 72 vínculos de `project_evidence` que receberão downloads autenticados.
- `PLANO_B_TRIA/scripts/migrate.mjs`, `init-file-store.mjs` e `restore-file-backup.mjs` — pontos de reuso para bootstrap, migração e recuperação.
- `PLANO_B_TRIA/src/lib/request-boundary.ts` e `src/app/api/health/route.ts` — confiança de proxy e readiness fail-closed.
- `PLANO_B_TRIA/docs/copied-reference-manifest.json` — evidência somente leitura para validar os arquivos de carga; nunca compor a imagem.

## Tasks & Acceptance

**Execution:**
- [x] `db/migrations/025_hobby_file_quota.sql`, quota e restore — migrar 9 GB para 4 GB sem alterar migrações aplicadas.
- [x] Migração/repositório/componentes de evidência — vincular cada ativo catalogado a uma versão armazenada única e expor download autenticado em todos os projetos relacionados.
- [x] Script de importação — validar conjunto, tamanho e hashes antes de gravar atomicamente os 53 objetos.
- [x] `Dockerfile` e entrypoint Railway — preparar volume/secrets como root e executar app como UID 1001, sem credencial DDL no processo web.
- [x] `.railway/railway.ts` e GitHub Actions — declarar app, PostgreSQL, volumes, CI, plan/apply e deploy após CI.
- [x] Runbook — documentar login, secrets, carga inicial, backup, rollback, custos e operação CLI.
- [ ] GitHub/Railway — criar remoto, aplicar infraestrutura, migrar dados, carregar evidências e executar corte controlado.

**Acceptance Criteria:**
- Given o pacote local aprovado, when a carga termina, then há 53 objetos, `1.126.834.973` bytes usados e 72 vínculos navegáveis sem duplicação física.
- Given o plano Hobby, when o Railway inicia, then banco, volume, UUID, quota de 4 GB e 59 projetos deixam `/api/health` em 200.
- Given um push em `main`, when CI falha, then Railway não publica; quando passa, publica a imagem correspondente ao commit.
- Given uma release defeituosa, when rollback é acionado, then banco e cofre permanecem íntegros e a versão anterior volta a atender.
- Given a conclusão, when os manifests protegidos são recalculados, then fontes, BMAD, PBIX e planilhas permanecem byte a byte inalterados.

## Spec Change Log

- 2026-09-01 — Runtime Railway, quota Hobby, catálogo canônico de evidências, carga atômica, IaC, CI/deploy e runbook implementados localmente. A criação/aplicação externa permanece pendente de login e confirmação interativa.

## Design Notes

A evidência compartilhada não será copiada por projeto. O ativo canônico terá uma versão física no cofre e será resolvido pelos vínculos existentes em `project_evidence`. GitHub transporta somente código; a carga documental usa canal autenticado do Railway e arquivo temporário removido após validação.

## Verification

**Commands:**
- `npm run check` — testes, lint e build verdes.
- `npm run test:integration` — auth, cofre, quota, evidências, relatórios, backup, corrupção e expurgo verdes em Compose isolado.
- `npm run db:validate` — 27 migrações, contagens, hashes e ACL aprovados.
- `railway config plan` — nenhuma alteração destrutiva inesperada.
- Smoke autenticado — login, projetos, evidências, ajustes, V4, PDFs, backup e logout funcionam por HTTPS.

**Resultados locais:** `npm run check` passou com 120 testes, lint, TypeScript e build. O build do runner passou. A integração sintética crash/resume, health 200→503→200, downloads vinculados, auditoria e UID/GID 1001 passou. Em Compose isolado, 27 migrações, 59 projetos, 53 objetos únicos, `1.126.834.973` bytes, 72 vínculos, health 200, backup/restore, quota, corrupção, expurgo, relatórios e publicação V4 passaram. `npm run release:scan` e `npm run origin:verify` passaram. O typecheck da IaC passou. `railway config plan`, aplicação externa, push privado e smoke HTTPS aguardam autenticação/2FA e confirmação humana.
