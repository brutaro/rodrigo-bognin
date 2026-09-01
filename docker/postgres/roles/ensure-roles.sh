#!/bin/sh
set -eu
export PGPASSWORD="$(cat /run/secrets/db_admin_password)"
app_password="$(cat /run/secrets/db_app_password)"
migrator_password="$(cat /run/secrets/db_migrator_password)"
importer_password="$(cat /run/secrets/db_importer_password)"
psql --host "$PGHOST" --username "$PGUSER" --dbname "$PGDATABASE" --set=ON_ERROR_STOP=1 \
  --set=app_password="$app_password" --set=migrator_password="$migrator_password" --set=importer_password="$importer_password" <<'SQL'
SELECT format('CREATE ROLE tria_app LOGIN PASSWORD %L', :'app_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tria_app')\gexec
SELECT format('CREATE ROLE tria_migrator LOGIN PASSWORD %L', :'migrator_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tria_migrator')\gexec
SELECT format('CREATE ROLE tria_importer LOGIN PASSWORD %L', :'importer_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tria_importer')\gexec
SELECT format('ALTER ROLE tria_app LOGIN PASSWORD %L', :'app_password')\gexec
SELECT format('ALTER ROLE tria_migrator LOGIN PASSWORD %L', :'migrator_password')\gexec
SELECT format('ALTER ROLE tria_importer LOGIN PASSWORD %L', :'importer_password')\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tria_migrator;
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database())\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO tria_app, tria_migrator, tria_importer', current_database())\gexec
SQL
