#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
namespace=tria-project-import-test
[[ -n "${TRIA_INTEGRATION_OWNER:-}" && ( "$#" -eq 0 || ( "$#" -eq 1 && "$1" == --new-only ) ) ]] || exit 2
temp="${TRIA_INTEGRATION_TEMP:?}"
export TRIA_PORT=3111 COMPOSE_PROJECT_NAME="$namespace"
export TRIA_PROJECT_IMPORT_TEST_URL=http://127.0.0.1:3111 TRIA_INTEGRATION_NAMESPACE="$namespace"
node --input-type=module - "$temp" <<'JS'
import {writeFileSync} from 'node:fs';
const temp=process.argv[2];
const values={db_admin_password:'synthetic-project-import-admin-password',db_app_password:'synthetic-project-import-app-password',db_migrator_password:'synthetic-project-import-migrator-password',db_importer_password:'synthetic-project-import-importer-password',tria_login_code:'synthetic-project-import-login',tria_session_key:'synthetic-project-import-session-key-32-bytes',file_store_uuid:'33333333-3333-4333-8333-333333333333'};
const secrets={};for(const [name,value] of Object.entries(values)){writeFileSync(`${temp}/${name}`,value,{mode:0o444});secrets[name]={file:`${temp}/${name}`};}
const environment={TRIA_INSTANCE_NAMESPACE:'tria-project-import-test'};
const appImage=process.env.TRIA_RUNNER_IMAGE;
const toolsImage=process.env.TRIA_TOOLS_IMAGE;
const labels={'com.tria.integration.namespace':process.env.TRIA_INTEGRATION_NAMESPACE,'com.tria.integration.owner':process.env.TRIA_INTEGRATION_OWNER};
writeFileSync(`${temp}/override.json`,JSON.stringify({secrets,services:{db:{labels},roles:{labels},app:{labels,image:appImage,environment:{...environment,TRIA_LOCAL_HOSTS:'app:3000,127.0.0.1:3111'}},migrate:{labels,image:toolsImage,environment},'file-init':{labels,image:toolsImage,environment}},volumes:{postgres_data:{labels},file_data:{labels},next_cache:{labels}},networks:{default:{labels}}}));
JS
compose=(docker compose -p "$namespace" -f compose.yaml -f "$temp/override.json")
"${compose[@]}" up -d --no-build --wait app
if [[ "${1:-}" != --new-only ]]; then node tests/e2e/project-resource-import.mjs; fi
node tests/e2e/local-three-requirements.mjs
tools_image="${TRIA_TOOLS_IMAGE:?}"
docker run --rm --label "com.tria.integration.namespace=$namespace" --label "com.tria.integration.owner=$TRIA_INTEGRATION_OWNER" --user 1001:1001 --network "${namespace}_default" \
  --mount "type=bind,src=$temp/db_app_password,dst=/run/test-secrets/db_app_password,readonly" \
  --mount "type=bind,src=$temp/db_admin_password,dst=/run/test-secrets/db_admin_password,readonly" \
  -e PGHOST=db -e PGDATABASE=tria \
  -e TRIA_INTEGRATION_ISOLATED=confirmed -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  -e TRIA_APP_PASSWORD_FILE=/run/test-secrets/db_app_password \
  -e TRIA_ADMIN_PASSWORD_FILE=/run/test-secrets/db_admin_password \
  "$tools_image" node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
  tests/integration/local-requirements-postgres.integration.test.ts \
  tests/integration/upgrade-preservation.integration.test.ts \
  tests/integration/fiscal-payment.integration.test.ts
