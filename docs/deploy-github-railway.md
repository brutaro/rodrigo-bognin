# Publicação privada no GitHub e Railway Hobby

Este procedimento publica somente `PLANO_B_TRIA`. Ele nunca publica fontes, evidências, dumps, uploads ou secrets.

## 1. Gates locais e GitHub

Pare somente para login, 2FA ou confirmação interativa. Não apague recursos, volumes, backups ou dados legítimos sem confirmação.

```bash
npm ci
npm run release:scan
npm run origin:verify
npm run check
npm run railway:check
docker build --target tools -t tria-tools:preflight .
docker build --target runner -t tria:preflight .
git diff --check
git rev-parse --show-toplevel
```

A raiz deve terminar em `PLANO_B_TRIA`. Crie o repositório a partir desta raiz:

```bash
gh auth status || gh auth login
gh repo create brutaro/rodrigo-bognin --private --source=. --remote=origin
gh repo view brutaro/rodrigo-bognin --json nameWithOwner,visibility
```

Exija visibilidade `PRIVATE`. Repita `npm run release:scan` antes do primeiro push. Proteja `main` com o job `ci`. Desative o auto-deploy GitHub do Railway.

## 2. Infraestrutura Railway

Use somente Hobby. Não use Pro, R2 ou OCI. A região fixa do PostgreSQL, cofre e app é `us-east4-eqdc4a`. O PostgreSQL privado e o cofre de 5.000 MB usam volumes separados. O cofre monta em `/data/files`. Nunca exponha TCP público no PostgreSQL.

```bash
npx --yes @railway/cli@5.47.1 login
npx --yes @railway/cli@5.47.1 init
npx --yes @railway/cli@5.47.1 link
npx --yes @railway/cli@5.47.1 config plan --out /caminho-persistente/tria-plan.json
```

O workflow de infraestrutura gera somente o plan. Uma pessoa deve revisar e aplicar exatamente esse plan. Recuse qualquer delete, detach, redução ou troca de volume, mudança de região, banco público ou segunda réplica. Não aplique um plan destrutivo de forma automática.

## 3. Bootstrap fail-closed

Antes do primeiro deploy, defina `TRIA_BOOTSTRAP_MODE=enabled`. Não crie domínio e mantenha `TRIA_PUBLIC_HOSTS` vazio. Defina temporariamente:

- `TRIA_DATABASE_ADMIN_URL` privada do provedor;
- `TRIA_DB_ADMIN_PASSWORD` e `TRIA_DB_IMPORTER_PASSWORD`;
- `TRIA_DB_APP_PASSWORD` e `TRIA_DB_MIGRATOR_PASSWORD`;
- `TRIA_LOGIN_CODE`, `TRIA_SESSION_KEY` e `TRIA_FILE_STORE_UUID`;
- `TRIA_ROTATE_DB_ROLE_PASSWORDS=confirmed` somente quando uma rotação deliberada for necessária.

O bootstrap cria papéis ausentes sem trocar senhas de papéis existentes. A rotação exige o marcador exato. Todos os papéis ficam `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

Nesse modo, somente `/api/health` responde 200. Todas as outras rotas respondem 503. O processo roda como UID/GID 1001 depois de migrar e inicializar o cofre. Não habilite domínio público no bootstrap.

## 4. Carga canônica

Transfira fora do Git os quatro CSV sanitizados para `/bootstrap-data`. Transfira um diretório com somente as 53 evidências para `/evidence-import`. `docs/copied-reference-manifest.json` prova somente seis cópias UX. Ele não é o catálogo de evidências.

```bash
npx --yes @railway/cli@5.47.1 volume files --volume tria-file-vault upload /origem/bootstrap-data /bootstrap-data
npx --yes @railway/cli@5.47.1 volume files --volume tria-file-vault upload /origem/evidence-import /evidence-import
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh import-data
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh import-evidence
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh validate
```

A carga valida 53 hashes, 72 vínculos e `1.126.834.973` bytes. O journal persistente, as reservas sem expiração, `fsync` e renames atômicos permitem retomar uma queda sem liberar accounting antes da limpeza física.

Depois de `validate`, confirme o marcador `/data/files/.tria-bootstrap-complete`. Com autorização explícita, apague somente os diretórios temporários remotos. Nunca use `docker compose down -v`.

## 5. Saída do bootstrap e corte

1. Defina `TRIA_BOOTSTRAP_MODE=disabled`.
2. Remova `TRIA_DATABASE_ADMIN_URL`, `TRIA_DB_ADMIN_PASSWORD`, `TRIA_DB_IMPORTER_PASSWORD` e `TRIA_ROTATE_DB_ROLE_PASSWORDS` do serviço.
3. Confirme que produção mantém somente credenciais app/migrator e os secrets de login, sessão e UUID.
4. Faça novo deploy do SHA aprovado em CI.
5. Confirme que o deployment novo está `SUCCESS` e que `meta.commitHash` é o SHA esperado.
6. Confirme health completo com `status=ok` e `release` igual ao SHA.
7. Só então crie o domínio e defina `TRIA_PUBLIC_HOSTS=host.exato` sem esquema. Defina `TRIA_PUBLIC_URL=https://host.exato` somente no GitHub Environment.

Aborte se bootstrap e host público coexistirem, se credenciais admin/importer restarem, ou se o SHA divergir.

O health completo exige 59 projetos, 53 objetos, 72 vínculos resolvíveis, UUID correto, quota lógica de `4.000.000.000` bytes, catálogo consistente e espaço físico.

## 6. Smoke HTTPS

- Entre com o código permanente.
- Baixe uma evidência compartilhada a partir de cada projeto ligado.
- Confirme 404 para projeto sem vínculo e para o endpoint genérico de uma evidência.
- Confirme ajustes, prévia, publicação V4 e os dois PDFs.
- Confirme `Secure`, `HttpOnly` e `SameSite=Strict`.
- Recuse HTTP, host fora da allowlist e qualquer conjunto ausente ou incompleto de forwarded headers.

## 7. Backup coordenado

Use um destino persistente fora de `/tmp` e de tmpfs.

1. Defina `TRIA_MAINTENANCE_MODE=enabled` e faça deploy. Confirme health `maintenance` e 503 nas rotas de escrita.
2. Confirme que não há import, one-off ou outro escritor ativo. Se necessário, escale o app a zero depois de obter o ZIP autenticado.
3. Faça streaming do ZIP autenticado para o destino persistente: `curl --fail --output /destino-persistente/cofre.zip https://HOST/api/backups/files`.
4. Faça streaming de `pg_dump -Fc` pelo canal privado Railway para `/destino-persistente/banco.dump`.
5. Grave SHA-256, tamanhos, deployment ID e Git SHA para os dois arquivos.
6. Defina maintenance como `disabled`, volte a uma réplica e confirme health e login.

Verifique e restaure somente em banco e volume novos, sem domínio:

```bash
node scripts/restore-file-backup.mjs --verify-only /destino-persistente/cofre.zip
node scripts/restore-file-backup.mjs --target /volume-isolado /destino-persistente/cofre.zip
```

Um backup v1 histórico pode declarar quota de 9 GB somente quando `used_bytes <= 4.000.000.000`. O restore normaliza a quota para 4 GB. Uso acima de 4 GB é recusado. Não apague o ambiente isolado sem confirmação.

## 8. Rollback

Migrações e volumes nunca são revertidos. Antes de existir uma release Railway pós-import verde, o único retorno seguro é a pilha Compose local inalterada. Não volte ao baseline `8dde05a` depois das migrações.

A primeira release com imports completos, bootstrap desligado, secrets admin/importer removidos e smoke verde é a âncora de rollback. Registre deployment ID e Git SHA. Depois, rollback troca somente o deployment do app. Ele nunca troca, reduz, destaca ou apaga o PostgreSQL ou o cofre.

## 9. Operação

Mantenha uma réplica, `overlapSeconds: 0`, alertas de custo Hobby, plan antes de apply, CI antes de deploy e restores isolados periódicos.
