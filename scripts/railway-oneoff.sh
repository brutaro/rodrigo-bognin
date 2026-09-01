#!/bin/sh
set -eu
umask 077
mode="${1:-}"
secret_dir="$(mktemp -d /run/tria-oneoff.XXXXXX)"
trap 'rm -rf "$secret_dir"' EXIT INT TERM
config=/run/tria-secrets/database.json
[ -r "$config" ] || { echo "Configuração privada do banco ausente." >&2; exit 1; }
export PGHOST="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.host)' "$config")"
export PGPORT="$(node -e 'const c=require(process.argv[1]);process.stdout.write(String(c.port))' "$config")"
export PGDATABASE="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.database)' "$config")"

case "$mode" in
  import-data)
    printf '%s\n' "${TRIA_DB_IMPORTER_PASSWORD:?Secret do importador ausente.}" > "$secret_dir/password"
    chown -R 1001:1001 "$secret_dir"
    export PGUSER=tria_importer PGPASSWORD_FILE="$secret_dir/password"
    export IMPORT_ACTIVITIES=/data/files/bootstrap-data/bm_activities_normalized.complete.csv
    export IMPORT_NOTES=/data/files/bootstrap-data/NFS_PROCESSADA_FONTE_VERDADE.csv
    export IMPORT_RELATIONS=/data/files/bootstrap-data/CLASSIFICACAO_RELACAO_NFS_PROJETOS.csv
    export IMPORT_EVIDENCE=/data/files/bootstrap-data/project_deliverable_crosswalk.csv
    setpriv --reuid=1001 --regid=1001 --init-groups node scripts/import-real-data.mjs
    ;;
  import-evidence)
    printf '%s\n' "${TRIA_DB_MIGRATOR_PASSWORD:?Secret do migrador ausente.}" > "$secret_dir/password"
    chown -R 1001:1001 "$secret_dir"
    export PGUSER=tria_migrator PGPASSWORD_FILE="$secret_dir/password"
    setpriv --reuid=1001 --regid=1001 --init-groups node scripts/import-evidence-files.mjs --source-dir /data/files/evidence-import
    ;;
  validate)
    printf '%s\n' "${TRIA_DB_MIGRATOR_PASSWORD:?Secret do migrador ausente.}" > "$secret_dir/password"
    chown -R 1001:1001 "$secret_dir"
    export PGUSER=tria_migrator PGPASSWORD_FILE="$secret_dir/password"
    setpriv --reuid=1001 --regid=1001 --init-groups node scripts/validate-database.mjs
    marker=/data/files/.tria-bootstrap-complete
    printf '%s
' "${TRIA_INSTANCE_NAMESPACE:-tria-production}" > "$marker.tmp"
    chmod 600 "$marker.tmp"; chown 1001:1001 "$marker.tmp"; mv "$marker.tmp" "$marker"; sync "$marker"
    ;;
  *)
    echo "Uso: scripts/railway-oneoff.sh import-data|import-evidence|validate" >&2
    exit 2
    ;;
esac
