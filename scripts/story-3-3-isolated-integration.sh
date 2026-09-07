#!/usr/bin/env bash
set -Eeuo pipefail

# A Story 3.2 é uma baseline protegida. Este runner transforma uma cópia
# descartável fora do repositório e mantém o arquivo original intacto.
root="$(cd "$(dirname "$0")/.." && pwd)"
baseline="$root/scripts/story-3-2-isolated-integration.sh"
[[ -f "$baseline" ]] || { echo "G33-01 FAIL: harness da Story 3.2 ausente." >&2; exit 1; }

mode="run"
self_test_child=""
case "$#" in
  0) ;;
  1) [[ "$1" == "--preflight-only" ]] || { echo "Uso: $0 [--preflight-only | --harness-self-test <child>]" >&2; exit 2; }; mode="preflight" ;;
  2) [[ "$1" == "--harness-self-test" ]] || { echo "Uso: $0 [--preflight-only | --harness-self-test <child>]" >&2; exit 2; }; mode="self-test"; self_test_child="$2" ;;
  *) echo "Uso: $0 [--preflight-only | --harness-self-test <child>]" >&2; exit 2 ;;
esac

namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-adjustments-local-$(date +%s)-${RANDOM}}"
[[ "$namespace" =~ ^tria-adjustments-[a-z0-9_-]+$ ]] || { echo "G33-01 FAIL: namespace isolado 3.3 recusado." >&2; exit 2; }
if [[ "$mode" == "self-test" && ! "$namespace" =~ ^tria-adjustments-harness-self-test-[a-z0-9_-]+$ ]]; then
  echo "G33-01 SELF-TEST FAIL: namespace de teste recusado." >&2
  exit 2
fi
web_container="${namespace}-story32-web"
network="${namespace}_default"
volume_names=("${namespace}_postgres_data" "${namespace}_file_data" "${namespace}_next_cache")

if [[ "$mode" == "self-test" ]]; then
  node "$root/scripts/verify-story-3-3-baseline.mjs" --root "$root" >/dev/null
  echo "G33-01 SELF-TEST: contrato interno e runner 3.2 preservados"
else
  node "$root/scripts/verify-story-3-3-baseline.mjs" --root "$root"
  echo "G33-01 PASS: contrato interno e runner 3.2 preservados"
fi

marker_counts="$(awk '
/^root=/ {root_count++}
/^echo "Suíte dedicada PostgreSQL concluída/ {postgres++}
/^echo "Story 3.2:/ {story32++}
END { print root_count + 0, postgres + 0, story32 + 0 }
' "$baseline")"
read -r root_marker_count postgres_marker_count story32_marker_count <<<"$marker_counts"
if [[ "$root_marker_count" -ne 1 || "$postgres_marker_count" -ne 1 || "$story32_marker_count" -ne 1 ]]; then
  echo "G33-01 FAIL: a baseline deve conter exatamente uma raiz e uma ocorrência de cada marcador (root=$root_marker_count, PostgreSQL=$postgres_marker_count, Story 3.2=$story32_marker_count)." >&2
  exit 1
fi

residue="$(find "$root/scripts" -maxdepth 1 -name '.story-3-3-*' -print -quit)"
[[ -z "$residue" ]] || { echo "G33-01 FAIL: resíduo transitório dentro do repositório: $residue" >&2; exit 1; }
if [[ "$mode" == "self-test" ]]; then echo "G33-01 SELF-TEST: marcadores únicos e árvore sem resíduos"; else echo "G33-01 PASS: marcadores únicos e árvore sem resíduos transitórios"; fi

temporary="$(mktemp -d "${TMPDIR:-/tmp}/tria-story-3-3.XXXXXX")"
resources_owned=0
child_pid=""
forced_status=0

cleanup_owned_resources() {
  [[ "$resources_owned" -eq 1 ]] || return 0
  local failed=0 compose_ids="" integration_ids="" web_ids="" volume_inventory="" network_inventory=""
  local id compose_label integration_label volume label

  docker info >/dev/null 2>&1 || failed=1
  compose_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$namespace" 2>/dev/null)" || failed=1
  integration_ids="$(docker ps -aq --filter "label=com.tria.integration.namespace=$namespace" 2>/dev/null)" || failed=1
  web_ids="$(docker ps -aq --filter "name=^/${web_container}$" 2>/dev/null)" || failed=1
  for id in $(printf '%s\n%s\n%s\n' "$compose_ids" "$integration_ids" "$web_ids" | awk 'NF && !seen[$0]++'); do
    compose_label="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null)" || compose_label=""
    integration_label="$(docker inspect -f '{{ index .Config.Labels "com.tria.integration.namespace" }}' "$id" 2>/dev/null)" || integration_label=""
    if [[ "$compose_label" == "$namespace" || "$integration_label" == "$namespace" ]]; then
      docker rm -f "$id" >/dev/null 2>&1 || failed=1
    else
      failed=1
    fi
  done

  volume_inventory="$(docker volume ls -q 2>/dev/null)" || failed=1
  for volume in "${volume_names[@]}"; do
    if printf '%s\n' "$volume_inventory" | grep -Fxq "$volume"; then
      label="$(docker volume inspect -f '{{ index .Labels "com.docker.compose.project" }}' "$volume" 2>/dev/null)" || { failed=1; continue; }
      if [[ "$label" == "$namespace" ]]; then docker volume rm "$volume" >/dev/null 2>&1 || failed=1; else failed=1; fi
    fi
  done

  network_inventory="$(docker network ls -q --filter "name=^${network}$" 2>/dev/null)" || failed=1
  if [[ -n "$network_inventory" ]]; then
    label="$(docker network inspect -f '{{ index .Labels "com.docker.compose.project" }}' "$network" 2>/dev/null)" || label=""
    if [[ "$label" == "$namespace" ]]; then docker network rm "$network" >/dev/null 2>&1 || failed=1; else failed=1; fi
  fi

  compose_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$namespace" 2>/dev/null)" || failed=1
  integration_ids="$(docker ps -aq --filter "label=com.tria.integration.namespace=$namespace" 2>/dev/null)" || failed=1
  web_ids="$(docker ps -aq --filter "name=^/${web_container}$" 2>/dev/null)" || failed=1
  [[ -z "$compose_ids$integration_ids$web_ids" ]] || failed=1
  volume_inventory="$(docker volume ls -q 2>/dev/null)" || failed=1
  for volume in "${volume_names[@]}"; do printf '%s\n' "$volume_inventory" | grep -Fxq "$volume" && failed=1; done
  network_inventory="$(docker network ls -q --filter "name=^${network}$" 2>/dev/null)" || failed=1
  [[ -z "$network_inventory" ]] || failed=1
  docker info >/dev/null 2>&1 || failed=1
  return "$failed"
}

process_group_exists() {
  [[ -n "$child_pid" ]] && kill -0 -- "-$child_pid" >/dev/null 2>&1
}
signal_process_group() {
  local signal="$1"
  [[ -n "$child_pid" ]] && kill -"$signal" -- "-$child_pid" >/dev/null 2>&1 || true
}
stop_process_group_bounded() {
  local attempt
  process_group_exists || return 0
  signal_process_group TERM
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    process_group_exists || return 0
    sleep 0.1
  done
  signal_process_group KILL
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    process_group_exists || return 0
    sleep 0.1
  done
  return 1
}
on_exit() {
  local status=$? cleanup_status=0
  trap - EXIT INT TERM
  if [[ -n "$child_pid" ]]; then
    stop_process_group_bounded || cleanup_status=1
    wait "$child_pid" >/dev/null 2>&1 || true
  fi
  cleanup_owned_resources || cleanup_status=$?
  rm -rf "$temporary"
  if [[ "$forced_status" -ne 0 ]]; then status="$forced_status"; fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    echo "G33-01 FAIL: cleanup defensivo ou pós-condição dos recursos isolados falhou para $namespace." >&2
    status=1
  fi
  exit "$status"
}
forward_signal() {
  local signal="$1"
  if [[ "$signal" == INT ]]; then forced_status=130; else forced_status=143; fi
  signal_process_group "$signal"
}

trap on_exit EXIT
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

case "$(cd "$temporary" && pwd -P)/" in
  "$(cd "$root" && pwd -P)/"*)
    echo "G33-01 FAIL: diretório transitório foi criado dentro do repositório." >&2
    exit 1
    ;;
esac

generated="$temporary/story-3-3-isolated-generated.sh"
postgres_test="$temporary/story-3-3-postgres-injection.sh"
story_test="$temporary/story-3-3-browser-injection.sh"

cat > "$postgres_test" <<'EOF'
echo "Story 3.3: integração PostgreSQL real no mesmo ambiente descartável"
docker run --rm --user 1001:1001 --network "$network" \
  --mount "type=bind,src=$secrets,dst=/run/tria-secrets,readonly" \
  --mount "type=volume,src=$file_volume,dst=/data/files" \
  -e "PGHOST=db" -e "PGPORT=5432" -e "PGDATABASE=tria" \
  -e "TRIA_ADMIN_PASSWORD_FILE=/run/tria-secrets/admin" \
  -e "TRIA_APP_PASSWORD_FILE=/run/tria-secrets/app" \
  -e "TRIA_IMPORTER_PASSWORD_FILE=/run/tria-secrets/importer" \
  -e "TRIA_STORY33_POSTGRES=confirmed" \
  -e "TRIA_CONSOLIDATED_SOURCE_UPLOAD=synthetic-fixtures-only" \
  -e "TRIA_INTEGRATION_ISOLATED=confirmed" \
  -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  "$tools_image" sh -lc '
    export TRIA_ADMIN_PASSWORD="$(cat "$TRIA_ADMIN_PASSWORD_FILE")"
    export TRIA_APP_PASSWORD="$(cat "$TRIA_APP_PASSWORD_FILE")"
    export TRIA_IMPORTER_PASSWORD="$(cat "$TRIA_IMPORTER_PASSWORD_FILE")"
    exec node_modules/.bin/vitest run --config vitest.story-3-2.config.ts \
      tests/integration/story-3-3-postgres.integration.test.ts
  '
EOF

cat > "$story_test" <<'EOF'
docker run --rm --user 1001:1001 --network "$network" \
  --mount "type=bind,src=$secrets,dst=/run/tria-secrets,readonly" \
  --mount "type=volume,src=$file_volume,dst=/data/files" \
  -e PGHOST=db -e PGPORT=5432 -e PGDATABASE=tria -e PGUSER=tria_admin \
  -e PGPASSWORD_FILE=/run/tria-secrets/admin \
  -e TRIA_ADMIN_PASSWORD_FILE=/run/tria-secrets/admin \
  -e TRIA_INTEGRATION_ISOLATED=confirmed \
  -e "TRIA_INTEGRATION_NAMESPACE=$namespace" \
  -e "TRIA_INSTANCE_NAMESPACE=$namespace" \
  "$tools_image" sh -lc '
    export TRIA_ADMIN_PASSWORD="$(cat "$TRIA_ADMIN_PASSWORD_FILE")"
    exec node scripts/seed-story-3-3-reconciliation.mjs
  '
STORY33_BASE_URL="http://127.0.0.1:$browser_port" \
  STORY33_LOGIN_CODE='synthetic-story32-owner-code-2026' \
  STORY33_EVIDENCE_DIR="$evidence" \
  node "$root/scripts/story-3-3-browser.mjs"
EOF

awk -v postgres_test="$postgres_test" -v story_test="$story_test" '
function emit(line) {
  sub(/docker run /, "docker run --label \"com.tria.integration.namespace=$namespace\" ", line)
  print line
}
/^root=/ {
  print "root=\"${TRIA_STORY33_PROJECT_ROOT:?}\""
  next
}
/^echo "Story 3.2:/ {
  emit($0)
  while ((getline line < postgres_test) > 0) emit(line)
  close(postgres_test)
  while ((getline line < story_test) > 0) emit(line)
  close(story_test)
  next
}
{ emit($0) }
' "$baseline" > "$generated"
chmod +x "$generated"

story32_line="$(grep -n '^echo "Story 3.2:' "$generated" | cut -d: -f1)"
postgres_line="$(grep -n '^echo "Story 3.3: integração PostgreSQL' "$generated" | cut -d: -f1)"
seed_line="$(grep -n 'exec node scripts/seed-story-3-3-reconciliation.mjs' "$generated" | cut -d: -f1)"
browser_line="$(grep -n 'node "$root/scripts/story-3-3-browser.mjs"' "$generated" | cut -d: -f1)"
docker_run_count="$(grep -c 'docker run ' "$generated")"
labelled_run_count="$(grep -c 'docker run --label "com.tria.integration.namespace=$namespace" ' "$generated")"
if [[ "$docker_run_count" -eq 0 || "$docker_run_count" -ne "$labelled_run_count" ]]; then
  echo "G33-01 FAIL: todo docker run da cópia deve carregar o label isolado." >&2
  exit 1
fi
node - "$generated" <<'NODE'
const { readFileSync } = require("node:fs");
const normalized = readFileSync(process.argv[2], "utf8").replace(/\\\r?\n\s*/g, " ");
const secretNames = "(?:TRIA_ADMIN_PASSWORD|TRIA_APP_PASSWORD|TRIA_IMPORTER_PASSWORD|PGPASSWORD|POSTGRES_PASSWORD|DATABASE_URL|TRIA_LOGIN_CODE|TRIA_SESSION_KEY)";
const forbiddenSecret = new RegExp(`(?:^|\\s)(?:-e\\s*|--env(?:=|\\s+))["']?${secretNames}(?=["'=\\s]|$)`, "m");
if (forbiddenSecret.test(normalized) || /(?:^|\s)--env-file(?:\s+|=)/m.test(normalized)) {
  console.error("G33-01 FAIL: metadata Docker da cópia contém secret direto ou env-file.");
  process.exit(1);
}
NODE
if [[ -z "$story32_line" || -z "$postgres_line" || -z "$seed_line" || -z "$browser_line" ||
      "$story32_line" -ge "$postgres_line" || "$postgres_line" -ge "$seed_line" || "$seed_line" -ge "$browser_line" ]]; then
  echo "G33-01 FAIL: sequência gerada não preserva Story 3.2 concluída antes de PostgreSQL, seed e browser 3.3." >&2
  exit 1
fi

if [[ "$mode" == "preflight" ]]; then
  bash -n "$generated"
  grep -Fq 'root="${TRIA_STORY33_PROJECT_ROOT:?}"' "$generated"
  echo "G33-01 PASS: sequência Story3.2-final < PostgreSQL3.3 < seed3.3 < browser3.3"
  echo "G33-01 PASS: $labelled_run_count/$docker_run_count docker run com label isolado"
  echo "G33-01 PASS: cópia descartável gerada fora do repositório"
  exit 0
fi

command -v docker >/dev/null 2>&1 || { echo "G33-01 FAIL: Docker indisponível." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "G33-01 FAIL: daemon Docker indisponível." >&2; exit 1; }
compose_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$namespace" 2>/dev/null)" || { echo "G33-01 FAIL: enumeração de containers compose falhou." >&2; exit 1; }
integration_ids="$(docker ps -aq --filter "label=com.tria.integration.namespace=$namespace" 2>/dev/null)" || { echo "G33-01 FAIL: enumeração de containers isolados falhou." >&2; exit 1; }
web_ids="$(docker ps -aq --filter "name=^/${web_container}$" 2>/dev/null)" || { echo "G33-01 FAIL: enumeração do container web falhou." >&2; exit 1; }
volume_inventory="$(docker volume ls -q 2>/dev/null)" || { echo "G33-01 FAIL: enumeração de volumes falhou." >&2; exit 1; }
network_inventory="$(docker network ls -q --filter "name=^${network}$" 2>/dev/null)" || { echo "G33-01 FAIL: enumeração de networks falhou." >&2; exit 1; }
preexisting="${compose_ids}${integration_ids}${web_ids}${network_inventory}"
for volume in "${volume_names[@]}"; do
  if printf '%s\n' "$volume_inventory" | grep -Fxq "$volume"; then preexisting="${preexisting}${volume}"; fi
done
if [[ -n "$preexisting" ]]; then
  echo "G33-01 FAIL: recurso preexistente; ownership não estabelecido e cleanup proibido para $namespace" >&2
  exit 2
fi
resources_owned=1

child_command=("$generated")
if [[ "$mode" == "self-test" ]]; then
  [[ -x "$self_test_child" ]] || { echo "G33-01 SELF-TEST FAIL: child sintético inválido." >&2; exit 2; }
  echo "G33-01 SELF-TEST: execução controlada de cleanup/sinais; a suíte real não será alegada"
  child_command=("$self_test_child")
fi
set +e
set -m
if [[ "$mode" == "self-test" ]]; then
  # O child sintético não é autoridade de gate. Sua saída fica suprimida.
  TRIA_STORY33_PROJECT_ROOT="$root" TRIA_INTEGRATION_ISOLATED=confirmed TRIA_INTEGRATION_NAMESPACE="$namespace" \
    "${child_command[@]}" >"$temporary/self-test-child.stdout" 2>"$temporary/self-test-child.stderr" &
else
  TRIA_STORY33_PROJECT_ROOT="$root" TRIA_INTEGRATION_ISOLATED=confirmed TRIA_INTEGRATION_NAMESPACE="$namespace" "${child_command[@]}" &
fi
child_pid=$!
set +m
wait "$child_pid"
child_status=$?
if [[ "$forced_status" -ne 0 ]]; then
  stop_process_group_bounded || child_status=1
  wait "$child_pid" >/dev/null 2>&1 || true
  child_status="$forced_status"
fi
child_pid=""
set -e
exit "$child_status"
