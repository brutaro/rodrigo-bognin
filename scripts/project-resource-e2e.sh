#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
namespace=tria-project-import-test
for suffix in postgres_data file_data next_cache; do
  if docker volume inspect "${namespace}_${suffix}" >/dev/null 2>&1; then
    echo "Ambiente de teste já existe; recusando reutilizar seus dados." >&2; exit 2
  fi
done
if docker network inspect "${namespace}_default" >/dev/null 2>&1; then
  echo "Ambiente de teste em uso." >&2; exit 2
fi
temp="$(mktemp -d)"
export TRIA_PORT=3111 COMPOSE_PROJECT_NAME="$namespace"
export TRIA_PROJECT_IMPORT_TEST_URL=http://127.0.0.1:3111 TRIA_INTEGRATION_NAMESPACE="$namespace"
node --input-type=module - "$temp" <<'JS'
import {writeFileSync} from 'node:fs';
const temp=process.argv[2];
const values={db_admin_password:'synthetic-project-import-admin-password',db_app_password:'synthetic-project-import-app-password',db_migrator_password:'synthetic-project-import-migrator-password',db_importer_password:'synthetic-project-import-importer-password',tria_login_code:'synthetic-project-import-login',tria_session_key:'synthetic-project-import-session-key-32-bytes',file_store_uuid:'33333333-3333-4333-8333-333333333333'};
const secrets={};for(const [name,value] of Object.entries(values)){writeFileSync(`${temp}/${name}`,value,{mode:0o444});secrets[name]={file:`${temp}/${name}`};}
const environment={TRIA_INSTANCE_NAMESPACE:'tria-project-import-test'};
const local=process.env.TRIA_E2E_LOCAL_IMAGES==='1';
const appImage=local?'tria-local-app:current':'tria-app:tria-project-import-test';
const toolsImage=local?'tria-local-tools:current':'tria-tools:tria-project-import-test';
writeFileSync(`${temp}/override.json`,JSON.stringify({secrets,services:{app:{image:appImage,environment:{...environment,TRIA_LOCAL_HOSTS:'app:3000,127.0.0.1:3111'}},migrate:{image:toolsImage,environment},'file-init':{image:toolsImage,environment}}}));
JS
compose=(docker compose -p "$namespace" -f compose.yaml -f "$temp/override.json")
cleanup() {
  status=$?; trap - EXIT
  if [[ $status -ne 0 ]]; then "${compose[@]}" logs --tail 50 app migrate >&2 || true; fi
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  if [[ "${TRIA_E2E_LOCAL_IMAGES:-}" != 1 ]]; then
    docker image rm tria-app:tria-project-import-test tria-tools:tria-project-import-test >/dev/null 2>&1 || true
  fi
  rm -rf "$temp"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${TRIA_E2E_LOCAL_IMAGES:-}" == 1 ]]; then
  "${compose[@]}" up -d --no-build --wait app
else
  "${compose[@]}" up -d --build --wait app
fi
if [[ "${1:-}" != --new-only ]]; then node tests/e2e/project-resource-import.mjs; fi
node tests/e2e/local-three-requirements.mjs
tools_image=tria-tools:tria-project-import-test
if [[ "${TRIA_E2E_LOCAL_IMAGES:-}" == 1 ]]; then tools_image=tria-local-tools:current; fi
docker run --rm --network "${namespace}_default" \
  --mount "type=bind,src=$temp,dst=/run/test-secrets,readonly" \
  -e PGHOST=db -e PGDATABASE=tria \
  -e TRIA_INTEGRATION_ISOLATED=confirmed -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  -e TRIA_APP_PASSWORD_FILE=/run/test-secrets/db_app_password \
  -e TRIA_ADMIN_PASSWORD_FILE=/run/test-secrets/db_admin_password \
  "$tools_image" node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
  tests/integration/local-requirements-postgres.integration.test.ts \
  tests/integration/upgrade-preservation.integration.test.ts
