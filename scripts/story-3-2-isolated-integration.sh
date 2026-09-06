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
chmod 600 "$secrets"/*
secrets_yaml="$temp/secrets.yaml"
cat > "$secrets_yaml" <<YAML
secrets:
  db_admin_password: { file: "$secrets/admin" }
  db_app_password: { file: "$secrets/app" }
  db_migrator_password: { file: "$secrets/migrator" }
  db_importer_password: { file: "$secrets/importer" }
  file_store_uuid: { file: "$secrets/uuid" }
YAML

compose=(docker compose -p "$namespace" -f "$root/compose.yaml" -f "$secrets_yaml")
tools_image="tria-plano-b-tools:local"
network="${namespace}_default"
file_volume="${namespace}_file_data"
status=0
web_container="${namespace}-story32-web"
evidence="${STORY32_EVIDENCE_DIR:-/tmp/${namespace}-evidence}"

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
  rm -rf "$temp"
  exit "$status"
}
mkdir -p "$evidence"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git_diff_is_empty() {
  git -C "$root" diff --quiet -- "$1" && git -C "$root" diff --cached --quiet -- "$1"
}

protected_files=(
  ".github/workflows/ci-deploy.yml"
  "scripts/ci-isolated-integration.sh"
  "src/app/api/health/route.ts"
)
for file in "${protected_files[@]}"; do
  git_diff_is_empty "$file" || { echo "G-01 FAIL: arquivo protegido alterado: $file" >&2; exit 1; }
  head_hash="$(git -C "$root" show "HEAD:$file" | shasum -a 256 | awk '{print $1}')"
  origin_hash="$(git -C "$root" show "c95fce1f4665a78043de4691c2abbe14167dfe86:$file" | shasum -a 256 | awk '{print $1}')"
  [[ "$head_hash" == "$origin_hash" ]] || { echo "G-01 FAIL: baseline protegido divergiu: $file" >&2; exit 1; }
done
echo "G-01 PASS: baseline protegido idêntico a HEAD e c95fce1"

if { git -C "$root" diff --name-only; git -C "$root" diff --cached --name-only; } | sort -u | rg -q '(^|/)(\.github/workflows/ci-deploy\.yml|scripts/ci-isolated-integration\.sh|src/app/api/health/route\.ts)$'; then
  echo "G-02 FAIL: diff proibido detectado." >&2
  exit 1
fi
for route in inspect prepare confirm; do
  [[ ! -e "$root/src/app/api/sources/consolidated/$route" ]] || { echo "G-12 FAIL: Route Handler mutável presente: $route" >&2; exit 1; }
done
rg -q '^"use server";' "$root/src/app/fontes/base-consolidada/actions.ts"
rg -q 'ConsolidatedSourceFlow' "$root/src/app/fontes/base-consolidada/page.tsx"
if rg -n "DatabaseSourceFileReader|PostgresImportPreparationRepository|from [\"']@/lib/database|from [\"']postgres" "$root/src/components/consolidated-source-flow.tsx" "$root/src/components/consolidated-source-preparation.tsx" >/dev/null; then
  echo "G-12 FAIL: UI conhece adapter ou conexão PostgreSQL." >&2
  exit 1
fi
echo "Preflight: diff protegido ausente, mutações em Server Actions e UI sem adapter"

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
  "$tools_image" node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
    src/modules/source-ledger/__tests__/hash-canonical.test.ts \
    src/modules/source-ledger/__tests__/passive-reader.test.ts \
    src/modules/source-ledger/__tests__/hostile-matrix.test.ts \
    src/modules/source-ledger/__tests__/source-ledger.test.ts \
    tests/integration/story-3-2-postgres.integration.test.ts

echo "Suíte dedicada PostgreSQL concluída; cobertura individual registrada pelos testes."

printf '%s\n' 'synthetic-story32-owner-code-2026' > "$secrets/login"
printf '%s\n' 'synthetic-story32-session-key-disposable-2026' > "$secrets/session"
chmod 600 "$secrets/login" "$secrets/session"
docker run -d --name "$web_container" --user 1001:1001 --network "$network" -p 127.0.0.1::3000 \
  --mount "type=bind,src=$secrets/app,dst=/run/app,readonly" \
  --mount "type=bind,src=$secrets/login,dst=/run/login,readonly" \
  --mount "type=bind,src=$secrets/session,dst=/run/session,readonly" \
  --mount "type=bind,src=$secrets/uuid,dst=/run/uuid,readonly" \
  --mount "type=volume,src=$file_volume,dst=/data/files" \
  -e PGHOST=db -e PGDATABASE=tria -e PGUSER=tria_app -e PGPASSWORD_FILE=/run/app \
  -e TRIA_LOGIN_CODE_FILE=/run/login -e TRIA_SESSION_KEY_FILE=/run/session \
  -e TRIA_FILE_STORE_PATH=/data/files -e TRIA_FILE_STORE_UUID_FILE=/run/uuid \
  -e TRIA_TRUST_PROXY=disabled -e TRIA_CONSOLIDATED_SOURCE_UPLOAD=synthetic-fixtures-only \
  -e TRIA_INTEGRATION_ISOLATED=confirmed -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  "$tools_image" sh -c 'node_modules/.bin/next build && cp -R public .next/standalone/public && cp -R .next/static .next/standalone/.next/static && HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js' >/dev/null
browser_port="$(docker port "$web_container" 3000/tcp | sed 's/.*://')"
for attempt in {1..90}; do
  if curl --silent --fail "http://127.0.0.1:$browser_port/entrar" >/dev/null; then break; fi
  sleep 1
done
STORY32_BASE_URL="http://127.0.0.1:$browser_port" STORY32_LOGIN_CODE='synthetic-story32-owner-code-2026' \
  STORY32_EVIDENCE_DIR="$evidence" node "$root/scripts/story-3-2-browser.mjs"
echo "Story 3.2: integração PostgreSQL sintética isolada concluída; nenhum dado real, import-real-data.mjs, commit, push ou deploy foi executado"
