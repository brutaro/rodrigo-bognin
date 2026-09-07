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
writeFileSync(`${temp}/override.json`,JSON.stringify({secrets,services:{app:{image:'tria-app:tria-project-import-test',environment:{...environment,TRIA_LOCAL_HOSTS:'app:3000,127.0.0.1:3111'}},migrate:{image:'tria-tools:tria-project-import-test',environment},'file-init':{image:'tria-tools:tria-project-import-test',environment}}}));
JS
compose=(docker compose -p "$namespace" -f compose.yaml -f "$temp/override.json")
cleanup() {
  status=$?; trap - EXIT
  if [[ $status -ne 0 ]]; then "${compose[@]}" logs --tail 50 app migrate >&2 || true; fi
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  docker image rm tria-app:tria-project-import-test tria-tools:tria-project-import-test >/dev/null 2>&1 || true
  rm -rf "$temp"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" up -d --build --wait app
node tests/e2e/project-resource-import.mjs
