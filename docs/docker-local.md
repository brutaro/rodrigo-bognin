# Operação Docker local

## Componentes

- `db`: PostgreSQL 16 sem porta publicada no host.
- `roles`: cria ou rotaciona os papéis locais sem expor senhas.
- `migrate`: aplica migrações imutáveis com checksum e advisory lock.
- `importer`: usa um papel sem DDL para validar e importar as quatro fontes em uma transação.
- `file-init`: valida ou cria o sentinel no volume dedicado, sem fallback.
- `app`: Next.js em Node.js 22, usuário não-root, raiz somente leitura e todas as capabilities removidas.

Na primeira subida, a aplicação só fica saudável depois que as 59 linhas de projeto estão disponíveis. Após a carga, `docker compose up -d app` reinicia a aplicação sem reler as fontes. Os arquivos de origem são montados individualmente em modo `ro`.

## Pré-validação sem banco

```bash
npm run db:import -- --dry-run
```

Defina as variáveis `IMPORT_*` quando executar fora do contêiner. O comando não imprime linhas nem campos privados.

## Migração e importação repetíveis

```bash
docker compose run --rm migrate
docker compose run --rm importer
```

Uma migração aplicada não pode mudar de checksum. Uma fonte já importada retorna `already_imported`. Uma carga parcial exige intervenção explícita; não há substituição automática.

## Teste integrado

O teste integrado cria, corrompe e expurga arquivos. Ele **não pode** usar o banco ou o volume principal. Crie uma pilha descartável com nome único iniciado por `tria-vault-`:

```bash
export COMPOSE_PROJECT_NAME="tria-vault-validation-$(date +%Y%m%d%H%M%S)"
export TRIA_PORT=3201
export TRIA_INTEGRATION_ISOLATED=confirmed
docker compose up --build -d
docker compose --profile validation run --rm --no-deps integration
docker compose down
docker volume rm   "${COMPOSE_PROJECT_NAME}_postgres_data"   "${COMPOSE_PROJECT_NAME}_file_data"   "${COMPOSE_PROJECT_NAME}_next_cache"
unset COMPOSE_PROJECT_NAME TRIA_PORT TRIA_INTEGRATION_ISOLATED
```

O executável recusa a execução sem as duas confirmações de isolamento. A pilha principal nunca é limpa pelo teste. O comando não usa `docker compose down -v`.

## Estado e logs

```bash
docker compose ps
docker compose logs --no-color --tail=100 app db migrate importer
curl --fail http://127.0.0.1:3100/api/health
```

Os logs não devem conter linhas das fontes, documentos pessoais, descrições fiscais ou senhas.


## Secrets de autenticação e cofre

Crie os três arquivos uma única vez. Não os versione, não os copie para o banco e não os passe por URL:

```bash
umask 077
mkdir -p .secrets
openssl rand -base64 24 > .secrets/tria_login_code
openssl rand -base64 48 > .secrets/tria_session_key
node -e 'console.log(crypto.randomUUID())' > .secrets/file_store_uuid
chmod 600 .secrets/tria_login_code .secrets/tria_session_key .secrets/file_store_uuid
```

O primeiro arquivo contém o código permanente de Rodrigo. A rotação da chave de sessão encerra todas as sessões. A troca de `file_store_uuid` sem um novo volume faz a readiness falhar de propósito. Um volume vazio também é recusado quando o catálogo do banco já contém arquivos.

## Cofre de arquivos

O volume `file_data` é obrigatório e tem quota exata de 9.000.000.000 bytes, incluindo reservas. Verifique a saúde sem autenticação:

```bash
docker compose up -d app
curl --fail http://127.0.0.1:3100/api/health
```

Entre em `http://127.0.0.1:3100/entrar`. O painel do projeto permite enviar uma nova versão, baixar a versão exata e iniciar expurgo. O conteúdo enviado nunca é renderizado ou executado.

## Backup manual do cofre

Depois de entrar, use **Backup** na navegação. O download contém `manifest.json`, `catalog.json` e todos os objetos ativos. Verifique ou restaure somente em diretório isolado:

```bash
node scripts/restore-file-backup.mjs --verify-only var/backups/tria-file-backup-AAAA-MM-DD.zip
node scripts/restore-file-backup.mjs --target var/restore-files var/backups/tria-file-backup-AAAA-MM-DD.zip
```

O restore cria `objects/`, `staging/` e `.tria-volume`, e preserva o UUID do bundle. O diretório pode ser montado somente com o mesmo `file_store_uuid`. Restaure o dump PostgreSQL no banco isolado antes de ligar esse volume; o catálogo JSON permite conferir versões, vínculos e ACLs contra o banco restaurado.

O restore exige destino ausente e recusa qualquer destino existente, entrada ZIP inesperada, catálogo adulterado, objeto ausente, ACL divergente ou SHA-256 inválido. Ele nunca substitui o banco ou o volume principal.

## Backup local

Crie o destino dentro de uma pasta ignorada e com permissão restrita:

```bash
mkdir -p var/backups
chmod 700 var/backups
docker compose exec -T db pg_dump -Fc -U tria_admin -d tria > var/backups/tria.dump
chmod 600 var/backups/tria.dump
```

Não versione nem envie esse arquivo.

## Teste de restauração

Restaure sempre em outro banco. Não substitua o banco principal durante um teste.

```bash
docker compose exec -T db createdb -U tria_admin -O tria_admin tria_restore_test
docker compose exec -T db pg_restore -U tria_admin -d tria_restore_test < var/backups/tria.dump
docker compose run --rm --no-deps -e PGDATABASE=tria_restore_test roles
docker compose exec -T db psql -U tria_admin -d tria_restore_test -c "select count(*) from project;"
docker compose exec -T db dropdb -U tria_admin tria_restore_test
```


O passo `roles` remove `CONNECT`/`TEMPORARY` de `PUBLIC` no banco novo e reaplica os grants nominais. Após restaurar, valide também ownership e acesso da aplicação. O restore deve preservar owner e ACL do dump. Não use `--no-owner` nem `--no-acl` neste procedimento.

```bash
docker compose exec -T db psql -U tria_admin -d tria_restore_test -c "select tableowner from pg_tables where tablename = 'project';"
docker compose run --rm --no-deps -e PGUSER=tria_app -e PGDATABASE=tria_restore_test roles sh -ceu 'export PGPASSWORD="$(cat /run/secrets/db_app_password)"; psql -Atc "select count(*) from project"'
```

## Rotação de senhas

Para `db_app_password`, `db_migrator_password` ou `db_importer_password`:

1. Substitua o arquivo necessário em `.secrets/` com permissão `0600`.
2. Execute `docker compose run --rm roles`.
3. Recrie o serviço que usa a credencial: `docker compose up -d --force-recreate app`.
4. Confirme `/api/health`.

A senha administrativa exige ordem diferente, pois autentica o próprio serviço de rotação:

```bash
umask 077
openssl rand -base64 36 > .secrets/db_admin_password.new
new_password="$(cat .secrets/db_admin_password.new)"
docker compose exec -T db psql -U tria_admin -d tria --set=new_password="$new_password" <<'SQL'
SELECT format('ALTER ROLE tria_admin PASSWORD %L', :'new_password')\gexec
SQL
unset new_password
mv .secrets/db_admin_password.new .secrets/db_admin_password
docker compose up -d --force-recreate db
```

Confirme a saúde do banco antes de recriar os demais serviços.

## Parada segura

```bash
docker compose stop
docker compose start
```

Ou use `docker compose down` para remover contêineres e rede, mas preservar volumes.

**Nunca use `docker compose down -v` sem autorização expressa.**

## Exclusões deliberadas

- Sem deploy.
- Sem Railway ou R2.
- Sem porta PostgreSQL no host.
- Sem senha em variável de ambiente ou arquivo versionado.
- Sem caminho bruto persistido no banco.
- Sem fuzzy match financeiro.
