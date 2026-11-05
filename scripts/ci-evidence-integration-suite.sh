#!/bin/bash
set -euo pipefail
namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-evidence-${GITHUB_RUN_ID:-local}-${RANDOM}}"
[[ "${TRIA_INTEGRATION_ISOLATED:-}" == confirmed && "$namespace" =~ ^tria-evidence-[a-z0-9_-]+$ ]] || { echo "Namespace sintético recusado." >&2; exit 2; }
[[ -n "${TRIA_INTEGRATION_OWNER:-}" && "$#" -eq 0 ]] || exit 2
root="$(cd "$(dirname "$0")/.." && pwd)"; temp="${TRIA_INTEGRATION_TEMP:?}"; evidence="$temp/evidence"; secrets="$temp/secrets"; mkdir -p "$evidence" "$secrets"
printf aa > "$evidence/a.any"; printf bbb > "$evidence/b.any"
printf '%s\n' 'synthetic-admin-password-01' > "$secrets/admin"; printf '%s\n' 'synthetic-app-password-02' > "$secrets/app"
printf '%s\n' 'synthetic-migrator-password-03' > "$secrets/migrator"; printf '%s\n' 'synthetic-importer-password-04' > "$secrets/importer"
printf '%s\n' 'synthetic-login-code' > "$secrets/login"; printf '%s\n' 'synthetic-session-key-with-at-least-32-bytes' > "$secrets/session"
printf '%s\n' '22222222-2222-4222-8222-222222222222' > "$secrets/uuid"; chmod 444 "$secrets"/*
# Apenas fixtures descartáveis: bind mounts do Compose preservam o modo no Linux.
# O diretório temporário 0700 protege os arquivos no host; PostgreSQL usa outro UID.
cat > "$temp/secrets.yaml" <<YAML
secrets:
  db_admin_password: { file: "$secrets/admin" }
  db_app_password: { file: "$secrets/app" }
  db_migrator_password: { file: "$secrets/migrator" }
  db_importer_password: { file: "$secrets/importer" }
  tria_login_code: { file: "$secrets/login" }
  tria_session_key: { file: "$secrets/session" }
  file_store_uuid: { file: "$secrets/uuid" }
services:
  db: { labels: &labels { com.tria.integration.namespace: "$namespace", com.tria.integration.owner: "$TRIA_INTEGRATION_OWNER" } }
  roles: { labels: *labels }
  migrate: { image: "${TRIA_TOOLS_IMAGE:?}", labels: *labels, environment: { TRIA_INSTANCE_NAMESPACE: "$namespace" } }
  file-init: { image: "${TRIA_TOOLS_IMAGE:?}", labels: *labels, environment: { TRIA_INSTANCE_NAMESPACE: "$namespace" } }
  evidence-tool: { image: "${TRIA_TOOLS_IMAGE:?}", labels: *labels }
  app: { image: "${TRIA_RUNNER_IMAGE:?}", labels: *labels }
volumes:
  postgres_data: { labels: *labels }
  file_data: { labels: *labels }
  next_cache: { labels: *labels }
networks:
  default: { labels: *labels }
YAML
compose=(docker compose -p "$namespace" -f "$root/compose.yaml" -f "$root/compose.synthetic.yaml" -f "$temp/secrets.yaml")
export COMPOSE_PROJECT_NAME="$namespace" TRIA_SYNTHETIC_EVIDENCE_DIR="$evidence" TRIA_PORT="$((40000 + RANDOM % 20000))"
cd "$root"
"${compose[@]}" up -d --no-build db roles migrate file-init
"${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/seed-synthetic-evidence.mjs
set +e
"${compose[@]}" --profile synthetic run --rm -e TRIA_EVIDENCE_CRASH_AFTER_RENAMES=1 evidence-tool node scripts/import-evidence-files.mjs --source-dir /imports/evidence
crash_status=$?
set -e
[[ $crash_status -eq 86 ]] || { echo "Crash injetado retornou $crash_status, esperado 86." >&2; exit 1; }
"${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/verify-synthetic-import.mjs --phase crash
"${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/import-evidence-files.mjs --source-dir /imports/evidence
first_state="$("${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/verify-synthetic-import.mjs --phase final | tail -1)"
"${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/import-evidence-files.mjs --source-dir /imports/evidence
second_state="$("${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/verify-synthetic-import.mjs --phase final | tail -1)"
[[ "$first_state" == "$second_state" ]] || { echo "Rerun não preservou IDs/contadores." >&2; exit 1; }
"${compose[@]}" up -d --no-build app
"${compose[@]}" --profile synthetic run --rm evidence-tool node scripts/synthetic-evidence-smoke.mjs
container="$("${compose[@]}" ps -q app)"; docker exec -u 0 "$container" sh -c "grep -Eq '^Uid:[[:space:]]+1001[[:space:]]' /proc/1/status && grep -Eq '^Gid:[[:space:]]+1001[[:space:]]' /proc/1/status"
"${compose[@]}" stop app
runner="${TRIA_RUNNER_IMAGE:?}"
admin="$(cat "$secrets/admin")"; app="$(cat "$secrets/app")"; migrator="$(cat "$secrets/migrator")"; importer="$(cat "$secrets/importer")"
bootstrap_password=synthetic-bootstrap-password-05
"${compose[@]}" exec -T db sh -lc "PGPASSWORD=\$(cat /run/secrets/db_admin_password) psql -U tria_admin -d tria -v ON_ERROR_STOP=1 -c \"CREATE ROLE railway_bootstrap LOGIN SUPERUSER PASSWORD '$bootstrap_password';\""
login="$(cat "$secrets/login")"; session="$(cat "$secrets/session")"
docker run --label "com.tria.integration.namespace=$namespace" --label "com.tria.integration.owner=$TRIA_INTEGRATION_OWNER" -d --name "$namespace-railway" --network "${namespace}_default" -v "${namespace}_file_data:/data/files" \
  -e TRIA_RUNTIME=railway -e TRIA_BOOTSTRAP_MODE=enabled -e TRIA_TRUST_PROXY=disabled -e TRIA_INTEGRATION_ISOLATED=confirmed -e "TRIA_INTEGRATION_NAMESPACE=$namespace" -e "TRIA_INSTANCE_NAMESPACE=$namespace" -e PGHOST=db -e PGPORT=5432 -e PGDATABASE=tria \
  -e "TRIA_DATABASE_ADMIN_URL=postgresql://railway_bootstrap:${bootstrap_password}@db:5432/tria" -e "TRIA_DB_ADMIN_PASSWORD=$admin" -e "TRIA_DB_APP_PASSWORD=$app" \
  -e "TRIA_DB_MIGRATOR_PASSWORD=$migrator" -e "TRIA_DB_IMPORTER_PASSWORD=$importer" -e "TRIA_LOGIN_CODE=$login" \
  -e "TRIA_SESSION_KEY=$session" -e TRIA_FILE_STORE_UUID=22222222-2222-4222-8222-222222222222 "$runner" >/dev/null
bootstrap_ready=0
for attempt in $(seq 1 60); do
  bootstrap_state="$(node "$root/scripts/lib/run-bounded.mjs" 10 docker inspect -f '{{.State.Status}}' "$namespace-railway")"
  if [[ "$bootstrap_state" == exited || "$bootstrap_state" == dead ]]; then docker logs "$namespace-railway" >&2; exit 1; fi
  if node "$root/scripts/lib/run-bounded.mjs" 5 docker exec -u 1001 "$namespace-railway" node -e 'fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(h=>process.exit(h.status==="bootstrap"&&h.uid===1001&&h.gid===1001&&h.privilegedEnvironmentPresent===false?0:1)).catch(()=>process.exit(1))'; then bootstrap_ready=1; break; fi
  sleep 1
done
[[ "$bootstrap_ready" -eq 1 ]] || { docker logs "$namespace-railway" >&2; echo "Bootstrap health não ficou pronto." >&2; exit 1; }
docker exec -u 0 "$namespace-railway" sh -c "grep -Eq '^Uid:[[:space:]]+1001[[:space:]]' /proc/1/status && grep -Eq '^Gid:[[:space:]]+1001[[:space:]]' /proc/1/status"
docker exec -u 1001 "$namespace-railway" node -e 'fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(h=>process.exit(h.status==="bootstrap"&&h.uid===1001&&h.gid===1001&&h.privilegedEnvironmentPresent===false?0:1))'
docker exec -u 0 "$namespace-railway" sh -c 'test ! -e /run/tria-secrets/db-admin-password && test ! -e /run/tria-secrets/db-migrator-password && test ! -e /run/tria-secrets/db-importer-password && test -r /run/tria-secrets/db-app-password && test -r /run/tria-secrets/tria-login-code && test -r /run/tria-secrets/tria-session-key && test -r /run/tria-secrets/file-store-uuid'
docker run --label "com.tria.integration.namespace=$namespace" --label "com.tria.integration.owner=$TRIA_INTEGRATION_OWNER" -d --name "$namespace-uid" --user 1001:1001 -e TRIA_RUNTIME=local "$runner" >/dev/null
sleep 2; [[ "$(docker inspect -f '{{.State.Running}}' "$namespace-uid")" == true ]]; docker exec -u 0 "$namespace-uid" grep -Eq '^Uid:[[:space:]]+1001[[:space:]]' /proc/1/status
echo "integração isolada CI: OK ($namespace)"
