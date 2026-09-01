#!/bin/sh
set -eu
run_node() {
  if [ "$(id -u)" = 0 ]; then exec setpriv --reuid=1001 --regid=1001 --init-groups "$@"; fi
  if [ "$(id -u)" = 1001 ] && [ "$(id -g)" = 1001 ]; then exec "$@"; fi
  echo "UID/GID de runtime inválido." >&2; exit 1
}
if [ "${TRIA_RUNTIME:-local}" != "railway" ]; then run_node node server.js; fi
[ "$(id -u)" = 0 ] || { echo "Bootstrap Railway exige UID 0 antes da queda de privilégio." >&2; exit 1; }
case "${TRIA_BOOTSTRAP_MODE:-disabled}" in enabled|disabled) ;; *) echo "TRIA_BOOTSTRAP_MODE inválido." >&2; exit 1;; esac
if [ "${TRIA_BOOTSTRAP_MODE:-disabled}" = enabled ] && [ -n "${TRIA_PUBLIC_HOSTS:-}" ]; then echo "Bootstrap recusado com host público configurado." >&2; exit 1; fi
if [ "${TRIA_BOOTSTRAP_MODE:-disabled}" = enabled ] && [ -e /data/files/.tria-bootstrap-complete ]; then echo "Bootstrap já concluído; reativação recusada." >&2; exit 1; fi

umask 077
secret_dir=/run/tria-secrets
rm -rf "$secret_dir"; mkdir -p "$secret_dir"; chmod 700 "$secret_dir"
write_secret() { variable="$1"; target="$2"; value="$(printenv "$variable" || true)"; [ -n "$value" ] || { echo "Secret obrigatório ausente: $variable" >&2; exit 1; }; printf '%s\n' "$value" > "$target"; chmod 600 "$target"; }
write_secret TRIA_DB_APP_PASSWORD "$secret_dir/db-app-password"
write_secret TRIA_DB_MIGRATOR_PASSWORD "$secret_dir/db-migrator-password"
write_secret TRIA_LOGIN_CODE "$secret_dir/tria-login-code"
write_secret TRIA_SESSION_KEY "$secret_dir/tria-session-key"
write_secret TRIA_FILE_STORE_UUID "$secret_dir/file-store-uuid"

if [ -n "${TRIA_DATABASE_ADMIN_URL:-}" ]; then
  write_secret TRIA_DATABASE_ADMIN_URL "$secret_dir/database-admin-url"
  write_secret TRIA_DB_ADMIN_PASSWORD "$secret_dir/db-admin-password"
  write_secret TRIA_DB_IMPORTER_PASSWORD "$secret_dir/db-importer-password"
  export TRIA_DATABASE_ADMIN_URL_FILE="$secret_dir/database-admin-url"
  export TRIA_DB_ADMIN_PASSWORD_FILE="$secret_dir/db-admin-password"
  export TRIA_DB_APP_PASSWORD_FILE="$secret_dir/db-app-password"
  export TRIA_DB_MIGRATOR_PASSWORD_FILE="$secret_dir/db-migrator-password"
  export TRIA_DB_IMPORTER_PASSWORD_FILE="$secret_dir/db-importer-password"
  export TRIA_DATABASE_CONFIG_OUTPUT="$secret_dir/database.json"
  node scripts/bootstrap-railway-db.mjs
  export PGHOST="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.host)' "$secret_dir/database.json")"
  export PGPORT="$(node -e 'const c=require(process.argv[1]);process.stdout.write(String(c.port))' "$secret_dir/database.json")"
  export PGDATABASE="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.database)' "$secret_dir/database.json")"
else
  [ -n "${PGHOST:-}" ] && [ -n "${PGDATABASE:-}" ] || { echo "Configuração privada PostgreSQL ausente." >&2; exit 1; }
  printf '%s\n' "$(node -e 'console.log(JSON.stringify({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE}))')" > "$secret_dir/database.json"
  chmod 600 "$secret_dir/database.json"
fi

export PGPORT="${PGPORT:-5432}" PGUSER=tria_migrator PGPASSWORD_FILE="$secret_dir/db-migrator-password"
export TRIA_INSTANCE_NAMESPACE="${TRIA_INSTANCE_NAMESPACE:-tria-production}"
node scripts/migrate.mjs
mkdir -p /data/files; chown 1001:1001 /data/files; chmod 700 /data/files
export PGUSER=tria_app PGPASSWORD_FILE="$secret_dir/db-app-password"
export TRIA_LOGIN_CODE_FILE="$secret_dir/tria-login-code" TRIA_SESSION_KEY_FILE="$secret_dir/tria-session-key"
export TRIA_FILE_STORE_UUID_FILE="$secret_dir/file-store-uuid" TRIA_FILE_STORE_PATH=/data/files
chown 1001:1001 "$secret_dir" "$secret_dir/db-app-password" "$secret_dir/tria-login-code" "$secret_dir/tria-session-key" "$secret_dir/file-store-uuid" "$secret_dir/database.json"
setpriv --reuid=1001 --regid=1001 --init-groups node scripts/init-file-store.mjs
rm -f "$secret_dir/database-admin-url" "$secret_dir/db-admin-password" "$secret_dir/db-migrator-password" "$secret_dir/db-importer-password"
unset TRIA_DATABASE_ADMIN_URL TRIA_DB_ADMIN_PASSWORD TRIA_DB_MIGRATOR_PASSWORD TRIA_DB_IMPORTER_PASSWORD TRIA_ROTATE_DB_ROLE_PASSWORDS
unset TRIA_DATABASE_ADMIN_URL_FILE TRIA_DB_ADMIN_PASSWORD_FILE TRIA_DB_MIGRATOR_PASSWORD_FILE TRIA_DB_IMPORTER_PASSWORD_FILE
if [ "${TRIA_BOOTSTRAP_MODE:-disabled}" = enabled ]; then run_node node scripts/bootstrap-health-server.mjs; fi
run_node node server.js
