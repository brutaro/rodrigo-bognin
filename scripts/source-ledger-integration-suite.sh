#!/usr/bin/env bash
set -Eeuo pipefail
# Fixed functional suite. The supervisor owns inventory, signals and cleanup.
[[ "$#" -eq 0 && "${TRIA_INTEGRATION_ISOLATED:-}" == confirmed && -n "${TRIA_INTEGRATION_OWNER:-}" ]] || exit 2
root="$(cd "$(dirname "$0")/.." && pwd)"
namespace="${TRIA_INTEGRATION_NAMESPACE:?}"
temp="${TRIA_INTEGRATION_TEMP:?}"
tools_image="${TRIA_TOOLS_IMAGE:?}"
secrets="$temp/secrets"
evidence="$temp/evidence"
mkdir -m 700 "$secrets" "$evidence"
for role in admin app migrator importer; do printf 'synthetic-%s-disposable-password\n' "$role" > "$secrets/$role"; done
printf '%s\n' '33333333-3333-4333-8333-333333333333' > "$secrets/uuid"
printf '%s\n' 'synthetic-story32-owner-code-2026' > "$secrets/login"
printf '%s\n' 'synthetic-story32-session-key-disposable-2026' > "$secrets/session"
# Mount individual readonly files: UID 1001 need not traverse the host's 0700
# directory. All of these values are synthetic and contain no owner credentials.
chmod 444 "$secrets"/*
secrets_yaml="$temp/compose.yaml"
cat > "$secrets_yaml" <<YAML
secrets:
  db_admin_password: { file: "$secrets/admin" }
  db_app_password: { file: "$secrets/app" }
  db_migrator_password: { file: "$secrets/migrator" }
  db_importer_password: { file: "$secrets/importer" }
  file_store_uuid: { file: "$secrets/uuid" }
  tria_login_code: { file: "$secrets/login" }
  tria_session_key: { file: "$secrets/session" }
x-integration-labels: &integration-labels
  com.tria.integration.namespace: "$namespace"
  com.tria.integration.owner: "$TRIA_INTEGRATION_OWNER"
services:
  db: { labels: *integration-labels }
  roles: { labels: *integration-labels }
  migrate: { image: "$tools_image", labels: *integration-labels, environment: { TRIA_INSTANCE_NAMESPACE: "$namespace" } }
  file-init: { image: "$tools_image", labels: *integration-labels, environment: { TRIA_INSTANCE_NAMESPACE: "$namespace" } }
volumes:
  postgres_data: { labels: *integration-labels }
  file_data: { labels: *integration-labels }
  next_cache: { labels: *integration-labels }
networks:
  default: { labels: *integration-labels }
YAML
compose=(docker compose -p "$namespace" -f "$root/compose.yaml" -f "$secrets_yaml")
network="${namespace}_default"
file_volume="${namespace}_file_data"
web_container="${namespace}-story32-web"
"${compose[@]}" up -d --no-build db roles migrate file-init
for service in migrate file-init; do
  service_id="$("${compose[@]}" ps -aq "$service")"
  [[ -n "$service_id" && "$(docker wait "$service_id")" == 0 ]] || { echo "$service falhou." >&2; "${compose[@]}" logs --no-color "$service" >&2; exit 1; }
done
secret_mounts=()
for name in admin app migrator importer uuid; do secret_mounts+=(--mount "type=bind,src=$secrets/$name,dst=/run/tria-secrets/$name,readonly"); done
run_tool() {
  local role="$1"; shift
  docker run --rm --label "com.tria.integration.namespace=$namespace" --label "com.tria.integration.owner=$TRIA_INTEGRATION_OWNER" \
    --user 1001:1001 --network "$network" "${secret_mounts[@]}" \
    --mount "type=volume,src=$file_volume,dst=/data/files" \
    -e PGHOST=db -e PGPORT=5432 -e PGDATABASE=tria -e "PGUSER=tria_$role" \
    -e "PGPASSWORD_FILE=/run/tria-secrets/$role" \
    -e TRIA_ADMIN_PASSWORD_FILE=/run/tria-secrets/admin -e TRIA_APP_PASSWORD_FILE=/run/tria-secrets/app \
    -e TRIA_IMPORTER_PASSWORD_FILE=/run/tria-secrets/importer -e DB_APP_PASSWORD_FILE=/run/tria-secrets/app \
    -e TRIA_FILE_STORE_PATH=/data/files -e TRIA_FILE_STORE_UUID_FILE=/run/tria-secrets/uuid \
    -e TRIA_CONSOLIDATED_SOURCE_UPLOAD=synthetic-fixtures-only -e TRIA_INTEGRATION_ISOLATED=confirmed \
    -e "TRIA_INTEGRATION_NAMESPACE=$namespace" -e "TRIA_INSTANCE_NAMESPACE=$namespace" \
    "$tools_image" "$@"
}
run_tool admin node scripts/configure-synthetic-import-bridge.mjs
for fixture in primary copy unattested rejected; do run_tool app node scripts/seed-synthetic-import-source.mjs "$fixture"; done
for id in 1 2 4; do run_tool importer node scripts/seed-synthetic-import-attestation.mjs "42000000-0000-4000-8000-00000000000$id"; done
run_tool app node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
  src/modules/source-ledger/__tests__/hash-canonical.test.ts \
  src/modules/source-ledger/__tests__/passive-reader.test.ts \
  src/modules/source-ledger/__tests__/hostile-matrix.test.ts \
  src/modules/source-ledger/__tests__/source-ledger.test.ts \
  tests/integration/story-3-2-postgres.integration.test.ts
docker run -d --name "$web_container" --user 1001:1001 --network "$network" -p 127.0.0.1::3000 \
  --label "com.tria.integration.namespace=$namespace" --label "com.tria.integration.owner=$TRIA_INTEGRATION_OWNER" \
  --mount "type=bind,src=$secrets/app,dst=/run/app,readonly" \
  --mount "type=bind,src=$secrets/login,dst=/run/login,readonly" \
  --mount "type=bind,src=$secrets/session,dst=/run/session,readonly" \
  --mount "type=bind,src=$secrets/uuid,dst=/run/uuid,readonly" \
  --mount "type=volume,src=$file_volume,dst=/data/files" \
  -e PGHOST=db -e PGDATABASE=tria -e PGUSER=tria_app -e PGPASSWORD_FILE=/run/app \
  -e TRIA_LOGIN_CODE_FILE=/run/login -e TRIA_SESSION_KEY_FILE=/run/session \
  -e TRIA_FILE_STORE_PATH=/data/files -e TRIA_FILE_STORE_UUID_FILE=/run/uuid \
  -e TRIA_TRUST_PROXY=disabled -e TRIA_CONSOLIDATED_SOURCE_UPLOAD=synthetic-fixtures-only \
  -e TRIA_INTEGRATION_ISOLATED=confirmed -e "TRIA_INTEGRATION_NAMESPACE=$namespace" -e "TRIA_INSTANCE_NAMESPACE=$namespace" \
  "$tools_image" sh -c 'node_modules/.bin/next build && mkdir -p .next/standalone/public .next/standalone/.next/static && cp -R public/. .next/standalone/public/ && cp -R .next/static/. .next/standalone/.next/static/ && HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js' >/dev/null
browser_port="$(docker port "$web_container" 3000/tcp | sed 's/.*://')"
[[ "$browser_port" =~ ^[0-9]+$ ]] || exit 1
ready=0
for attempt in {1..180}; do
  if curl --silent --fail --connect-timeout 2 --max-time 5 "http://127.0.0.1:$browser_port/entrar" >/dev/null; then ready=1; break; fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$web_container")" == true ]] || break
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then docker logs "$web_container" >&2; echo "Aplicação sintética não ficou pronta." >&2; exit 1; fi
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "http://127.0.0.1:$browser_port/tria.png" > "$evidence/standalone-logo.png"
STORY32_BASE_URL="http://127.0.0.1:$browser_port" STORY32_LOGIN_CODE="$(cat "$secrets/login")" \
  STORY32_EVIDENCE_DIR="$evidence" node "$root/scripts/story-3-2-browser.mjs"
run_tool admin sh -lc '
  export TRIA_ADMIN_PASSWORD="$(cat "$TRIA_ADMIN_PASSWORD_FILE")"
  export TRIA_APP_PASSWORD="$(cat "$TRIA_APP_PASSWORD_FILE")"
  export TRIA_IMPORTER_PASSWORD="$(cat "$TRIA_IMPORTER_PASSWORD_FILE")"
  export TRIA_STORY33_POSTGRES=confirmed
  exec node_modules/.bin/vitest run --config vitest.story-3-2.config.ts tests/integration/story-3-3-postgres.integration.test.ts
'
echo "PostgreSQL atual: Stories 3.2 e 3.3 aprovadas."
run_tool admin sh -lc 'export TRIA_ADMIN_PASSWORD="$(cat "$TRIA_ADMIN_PASSWORD_FILE")"; exec node scripts/seed-story-3-3-reconciliation.mjs'
STORY33_BASE_URL="http://127.0.0.1:$browser_port" STORY33_LOGIN_CODE="$(cat "$secrets/login")" \
  STORY33_EVIDENCE_DIR="$evidence" node "$root/scripts/story-3-3-browser.mjs"
echo "Integração atual aprovada: PostgreSQL e browsers 3.2/3.3 em recursos sintéticos próprios."
