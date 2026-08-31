#!/bin/sh
set -eu

app_password="$(cat /run/secrets/db_app_password)"
migrator_password="$(cat /run/secrets/db_migrator_password)"
importer_password="$(cat /run/secrets/db_importer_password)"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   --set=app_password="$app_password"   --set=migrator_password="$migrator_password" --set=importer_password="$importer_password" <<'SQL'
SELECT format('CREATE ROLE tria_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tria_app')\gexec
SELECT format('CREATE ROLE tria_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tria_migrator')\gexec
SELECT format('CREATE ROLE tria_importer LOGIN PASSWORD %L', :'importer_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tria_importer')\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tria_migrator;
GRANT CONNECT ON DATABASE tria TO tria_app, tria_migrator, tria_importer;
SQL
