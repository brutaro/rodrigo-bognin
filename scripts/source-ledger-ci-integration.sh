#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-adjustments-$(date +%s)-${RANDOM}}"
[[ "$namespace" =~ ^tria-adjustments-[a-z0-9_-]+$ ]] || { echo "G-02 FAIL: namespace da Story 3.2 recusado." >&2; exit 2; }

for suffix in postgres_data file_data next_cache; do
  if docker volume inspect "${namespace}_${suffix}" >/dev/null 2>&1; then
    echo "Namespace já utilizado; recusando reutilizar um volume existente: ${namespace}_${suffix}" >&2
    exit 2
  fi
done

if docker container inspect "${namespace}-story32-web" >/dev/null 2>&1 || docker network inspect "${namespace}_default" >/dev/null 2>&1; then
  echo "Namespace já utilizado; nenhum recurso existente será removido." >&2
  exit 2
fi

temp="$(mktemp -d -t tria-story-3-2.XXXXXX)"
secrets="$temp/secrets"
mkdir -m 700 "$secrets"
printf '%s\n' 'story32-admin-disposable-01' > "$secrets/admin"
printf '%s\n' 'story32-app-disposable-02' > "$secrets/app"
printf '%s\n' 'story32-migrator-disposable-03' > "$secrets/migrator"
printf '%s\n' 'story32-importer-disposable-04' > "$secrets/importer"
printf '%s\n' '33333333-3333-4333-8333-333333333333' > "$secrets/uuid"
chmod 444 "$secrets"/*
# Apenas fixtures descartáveis, em diretório temporário privado 0700.
# PostgreSQL e Node usam UIDs diferentes nos bind mounts Linux.
secrets_yaml="$temp/secrets.yaml"
cat > "$secrets_yaml" <<YAML
secrets:
  db_admin_password: { file: "$secrets/admin" }
  db_app_password: { file: "$secrets/app" }
  db_migrator_password: { file: "$secrets/migrator" }
  db_importer_password: { file: "$secrets/importer" }
  file_store_uuid: { file: "$secrets/uuid" }
services:
  migrate: { image: "tria-tools:${namespace}" }
  file-init: { image: "tria-tools:${namespace}" }
YAML

compose=(docker compose -p "$namespace" -f "$root/compose.yaml" -f "$secrets_yaml")
tools_image="tria-tools:${namespace}"
network="${namespace}_default"
file_volume="${namespace}_file_data"
status=0
web_container="${namespace}-story32-web"
evidence="$temp/logs"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 ]]; then
    echo "Story 3.2 isolada falhou; diagnóstico dos serviços:" >&2
    "${compose[@]}" ps -a >&2 || true
    "${compose[@]}" logs --no-color db roles migrate file-init >&2 || true
  fi
  docker logs "$web_container" > "$evidence/web.log" 2>&1 || true
  docker rm -f "$web_container" >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  for suffix in postgres_data file_data next_cache; do
    volume="${namespace}_${suffix}"
    label="$(docker volume inspect -f '{{ index .Labels \"com.docker.compose.project\" }}' "$volume" 2>/dev/null || true)"
    [[ "$label" == "$namespace" ]] && docker volume rm "$volume" >/dev/null 2>&1 || true
  done
  network_label="$(docker network inspect -f '{{ index .Labels \"com.docker.compose.project\" }}' "$network" 2>/dev/null || true)"
  [[ "$network_label" == "$namespace" ]] && docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "tria-tools:${namespace}" >/dev/null 2>&1 || true
  rm -rf "$temp"
  exit "$status"
}
mkdir -p "$evidence"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose[@]}" up -d --build db roles migrate file-init
docker image inspect "$tools_image" >/dev/null

run_tool() {
  local role="$1"
  shift
  docker run --rm --user 1001:1001 --network "$network" \
    --mount "type=bind,src=$secrets,dst=/run/tria-secrets,readonly" \
    --mount "type=volume,src=$file_volume,dst=/data/files" \
    -e "PGHOST=db" -e "PGPORT=5432" -e "PGDATABASE=tria" -e "PGUSER=tria_${role}" \
    -e "PGPASSWORD_FILE=/run/tria-secrets/$role" \
    -e "TRIA_FILE_STORE_PATH=/data/files" \
    -e "TRIA_FILE_STORE_UUID_FILE=/run/tria-secrets/uuid" \
    -e "TRIA_INTEGRATION_ISOLATED=confirmed" \
    -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
    -e "TRIA_INSTANCE_NAMESPACE=$namespace" \
    -e "DB_APP_PASSWORD_FILE=/run/tria-secrets/app" \
    "$tools_image" "$@"
}

run_tool admin node scripts/configure-synthetic-import-bridge.mjs
run_tool app node scripts/seed-synthetic-import-source.mjs primary
run_tool app node scripts/seed-synthetic-import-source.mjs copy
run_tool app node scripts/seed-synthetic-import-source.mjs unattested
run_tool app node scripts/seed-synthetic-import-source.mjs rejected
run_tool importer node scripts/seed-synthetic-import-attestation.mjs 42000000-0000-4000-8000-000000000001
run_tool importer node scripts/seed-synthetic-import-attestation.mjs 42000000-0000-4000-8000-000000000002
run_tool importer node scripts/seed-synthetic-import-attestation.mjs 42000000-0000-4000-8000-000000000004
echo "Fixtures: quatro source_file/file_version sintéticos e três atestações seed-only persistidas"

docker run --rm --user 1001:1001 --network "$network" \
  --mount "type=bind,src=$secrets,dst=/run/tria-secrets,readonly" \
  --mount "type=volume,src=$file_volume,dst=/data/files" \
  -e "PGHOST=db" -e "PGPORT=5432" -e "PGDATABASE=tria" -e "PGUSER=tria_app" \
  -e "PGPASSWORD_FILE=/run/tria-secrets/app" \
  -e "TRIA_APP_PASSWORD_FILE=/run/tria-secrets/app" \
  -e "TRIA_ADMIN_PASSWORD_FILE=/run/tria-secrets/admin" \
  -e "TRIA_FILE_STORE_PATH=/data/files" -e "TRIA_FILE_STORE_UUID_FILE=/run/tria-secrets/uuid" \
  -e "TRIA_CONSOLIDATED_SOURCE_UPLOAD=synthetic-fixtures-only" \
  -e "TRIA_INTEGRATION_ISOLATED=confirmed" -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  -e "TRIA_INSTANCE_NAMESPACE=$namespace" -e "DB_APP_PASSWORD_FILE=/run/tria-secrets/app" \
  "$tools_image" node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
    tests/integration/story-3-2-postgres.integration.test.ts

echo "Suíte dedicada PostgreSQL concluída; cobertura individual registrada pelos testes."

run_tool admin sh -lc '
  export TRIA_ADMIN_PASSWORD="$(cat /run/tria-secrets/admin)"
  export TRIA_APP_PASSWORD="$(cat /run/tria-secrets/app)"
  export TRIA_IMPORTER_PASSWORD="$(cat /run/tria-secrets/importer)"
  export TRIA_STORY33_POSTGRES=confirmed
  exec node_modules/.bin/vitest run --config vitest.story-3-2.config.ts tests/integration/story-3-3-postgres.integration.test.ts
'
echo "Preparação e reconciliação: PostgreSQL real aprovado em ambiente descartável."
