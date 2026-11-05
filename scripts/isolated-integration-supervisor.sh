#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
suite="${1:?Suíte obrigatória}"; shift
runner_needed=0
case "$suite" in
  source-ledger)
    namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-adjustments-local-$(date +%s)-${RANDOM}}"
    [[ "$namespace" =~ ^tria-adjustments-[a-z0-9][a-z0-9_-]{0,80}$ ]] || exit 2
    suite_command=(bash "$root/scripts/source-ledger-integration-suite.sh") ;;
  evidence)
    namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-evidence-local-$(date +%s)-${RANDOM}}"
    [[ "$namespace" =~ ^tria-evidence-[a-z0-9][a-z0-9_-]{0,80}$ ]] || exit 2
    suite_command=(bash "$root/scripts/ci-evidence-integration-suite.sh"); runner_needed=1 ;;
  project-resource)
    namespace="${TRIA_INTEGRATION_NAMESPACE:-tria-project-import-test}"
    [[ "$namespace" == tria-project-import-test ]] || exit 2
    suite_command=(bash "$root/scripts/project-resource-integration-suite.sh"); runner_needed=1 ;;
  *) echo "Suíte desconhecida recusada." >&2; exit 2 ;;
esac
[[ "${TRIA_RUNTIME:-}" != railway ]] || { echo "Runtime de produção recusado." >&2; exit 2; }
mode=run
self_test_child=""
case "$#" in
  0) ;;
  1) if [[ "$1" == --preflight-only ]]; then mode=preflight; elif [[ "$suite" == project-resource && "$1" == --new-only ]]; then suite_command+=(--new-only); else exit 2; fi ;;
  2) [[ "$1" == --harness-self-test && ( "$namespace" =~ ^tria-(adjustments|evidence)-harness-self-test- || "$namespace" == tria-project-import-test ) ]] || exit 2; mode=self-test; self_test_child="$2"; [[ -x "$self_test_child" ]] || exit 2 ;;
  *) exit 2 ;;
esac
# Only this explicit self-test argument can substitute the fixed suite. Its output
# is suppressed, and it cannot print a functional gate approval.
if [[ "$mode" == preflight ]]; then
  bash -n "${suite_command[1]}"
  echo "Preflight: sintaxe da suíte atual aprovada; PostgreSQL e browsers ainda não executados."
  exit 0
fi
command -v docker >/dev/null
namespace_label="com.tria.integration.namespace"
owner_label="com.tria.integration.owner"
owner="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
export TRIA_INTEGRATION_OWNER="$owner"
network="${namespace}_default"
lock_name="${namespace}-integration-lock"
lock_id=""
lock_attempted=0
lock_image="${TRIA_TOOLS_IMAGE:-postgres:16-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825}"
tools_tag="${TRIA_TOOLS_IMAGE:-tria-tools:${namespace}}"
runner_tag="${TRIA_RUNNER_IMAGE:-tria:${namespace}}"
tools_image="$tools_tag"
runner_image="$runner_tag"
[[ "$tools_tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9./_:@-]+$ && "$runner_tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9./_:@-]+$ ]] || exit 2
docker_timeout="${TRIA_DOCKER_TIMEOUT_SECONDS:-15}"
[[ "$docker_timeout" =~ ^[0-9]+([.][0-9]+)?$ ]] || exit 2
bounded="$root/scripts/lib/run-bounded.mjs"
docker() { node "$bounded" "$docker_timeout" docker "$@"; }
resources_owned=0
image_owned=0
runner_image_owned=0
owned_image_id=""
owned_runner_image_id=""
child_pid=""
forced_status=0
temporary="$(mktemp -d "${TMPDIR:-/tmp}/tria-integration.XXXXXX")"
case "$(cd "$temporary" && pwd -P)/" in "$(cd "$root" && pwd -P)/"*) rmdir "$temporary"; exit 1 ;; esac
inventory() {
  docker info >/dev/null 2>&1 || return 1
  compose_ids="$(docker ps -aq --no-trunc --filter "label=com.docker.compose.project=$namespace")" || return 1
  integration_ids="$(docker ps -aq --no-trunc --filter "label=$namespace_label=$namespace")" || return 1
  named_ids="$(docker ps -aq --no-trunc --filter "name=^/${namespace}[-_]")" || return 1
  # The reservation container is owned separately and never belongs to Compose.
  named_ids="$(printf '%s\n' "$named_ids" | awk -v lock="$lock_id" 'NF && $0 != lock')"
  volume_inventory="$(docker volume ls -q)" || return 1
  network_inventory="$(docker network ls -q --filter "name=^${network}$")" || return 1
  image_inventory="$(docker image ls --format '{{.Repository}}:{{.Tag}}')" || return 1
}
namespace_has_resources() {
  [[ -n "$compose_ids$integration_ids$named_ids$network_inventory" ]] && return 0
  local volume
  while IFS= read -r volume; do [[ "$volume" == "${namespace}_"* ]] && return 0; done <<<"$volume_inventory"
  return 1
}
cleanup_image() {
  local tag="$1" iidfile="$2" expected="$3" current label
  # A failing build can publish a tag before its CLI exits; its iidfile or owner
  # label must still prove ownership. An absent tag is an already-clean result.
  [[ -s "$iidfile" ]] && expected="$(cat "$iidfile")"
  if ! printf '%s\n' "$image_inventory" | grep -Fxq "$tag"; then return 0; fi
  current="$(docker image inspect -f '{{.Id}}' "$tag")" || return 1
  label="$(docker image inspect -f '{{ index .Config.Labels "com.tria.integration.owner" }}' "$tag")" || return 1
  [[ "$label" == "$owner" && ( -z "$expected" || "$current" == "$expected" ) ]] || return 1
  docker image rm "$tag" >/dev/null
}
cleanup_owned_resources() {
  [[ "$resources_owned" -eq 1 ]] || return 0
  local failed=0 id label volume
  inventory || return 1
  for id in $(printf '%s\n%s\n%s\n' "$compose_ids" "$integration_ids" "$named_ids" | awk 'NF && !seen[$0]++'); do
    label="$(docker inspect -f '{{ index .Config.Labels "com.tria.integration.owner" }}' "$id")" || { failed=1; continue; }
    if [[ "$label" == "$owner" ]]; then docker rm -f "$id" >/dev/null || failed=1; else failed=1; fi
  done
  while IFS= read -r volume; do
    [[ "$volume" == "${namespace}_"* ]] || continue
    label="$(docker volume inspect -f '{{ index .Labels "com.tria.integration.owner" }}' "$volume")" || { failed=1; continue; }
    if [[ "$label" == "$owner" ]]; then docker volume rm "$volume" >/dev/null || failed=1; else failed=1; fi
  done <<<"$volume_inventory"
  if [[ -n "$network_inventory" ]]; then
    label="$(docker network inspect -f '{{ index .Labels "com.tria.integration.owner" }}' "$network")" || label=""
    if [[ "$label" == "$owner" ]]; then docker network rm "$network" >/dev/null || failed=1; else failed=1; fi
  fi
  [[ "$image_owned" -eq 0 ]] || cleanup_image "$tools_tag" "$temporary/tools.iid" "$owned_image_id" || failed=1
  [[ "$runner_image_owned" -eq 0 ]] || cleanup_image "$runner_tag" "$temporary/runner.iid" "$owned_runner_image_id" || failed=1
  inventory || return 1
  namespace_has_resources && failed=1
  if [[ "$image_owned" -eq 1 ]] && printf '%s\n' "$image_inventory" | grep -Fxq "$tools_tag"; then failed=1; fi
  if [[ "$runner_image_owned" -eq 1 ]] && printf '%s\n' "$image_inventory" | grep -Fxq "$runner_tag"; then failed=1; fi
  return "$failed"
}
release_lock() {
  [[ "$lock_attempted" -eq 1 ]] || return 0
  local ids label id
  ids="$(docker ps -aq --no-trunc --filter "name=^/${lock_name}$")" || return 1
  for id in $ids; do
    label="$(docker inspect -f '{{ index .Config.Labels "com.tria.integration.owner" }}' "$id")" || return 1
    # A losing contender must leave the winning reservation intact.
    [[ "$label" == "$owner" ]] || continue
    docker rm -fv "$id" >/dev/null || return 1
  done
}
process_group_exists() { [[ -n "$child_pid" ]] && kill -0 -- "-$child_pid" >/dev/null 2>&1; }
signal_process_group() { [[ -n "$child_pid" ]] && kill -"$1" -- "-$child_pid" >/dev/null 2>&1 || true; }
stop_process_group_bounded() {
  local attempt group_state
  process_group_exists || return 0
  signal_process_group TERM
  for attempt in {1..10}; do process_group_exists || return 0; sleep 0.1; done
  signal_process_group KILL
  for attempt in {1..10}; do process_group_exists || return 0; sleep 0.1; done
  group_state="$(ps -eo pgid=,stat=)" || return 1
  if awk -v group="$child_pid" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit !live }' <<<"$group_state"; then return 1; fi
}
save_diagnostics() {
  [[ "$mode" == run ]] || return 0
  local ids id label
  mkdir -p "$temporary/diagnostics"
  node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({namespace:process.argv[2],status:Number(process.argv[3]),cleanupStatus:Number(process.argv[4])},null,2))' "$temporary/integration-result.json" "$namespace" "${1:-1}" "${2:-0}"
  ids="$(docker ps -aq --no-trunc --filter "label=$owner_label=$owner")" || ids=""
  for id in $ids; do
    label="$(docker inspect -f '{{ index .Config.Labels "com.tria.integration.owner" }}' "$id")" || continue
    [[ "$label" == "$owner" && "$id" =~ ^[a-zA-Z0-9_-]+$ ]] || continue
    docker logs "$id" >"$temporary/diagnostics/$id.log" 2>&1 || true
  done
  node "$root/scripts/lib/save-integration-artifacts.mjs" "$root" "$temporary" "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tria-integration-artifacts" "$namespace-$owner"
}
on_exit() {
  local status=$? cleanup_status=0 stopped=1
  trap - EXIT INT TERM
  if [[ -n "$child_pid" ]]; then
    if stop_process_group_bounded; then wait "$child_pid" >/dev/null 2>&1 || true; else stopped=0; cleanup_status=1; fi
  fi
  [[ "$forced_status" -eq 0 ]] || status="$forced_status"
  if [[ "$status" -ne 0 ]]; then save_diagnostics "$status" "$cleanup_status" || cleanup_status=1; fi
  if [[ "$stopped" -eq 1 ]]; then
    cleanup_owned_resources || cleanup_status=1
    release_lock || cleanup_status=1
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    echo "FAIL: cleanup defensivo ou pós-condição dos recursos isolados falhou para $namespace." >&2
    status=1
  fi
  if [[ "$status" -ne 0 ]]; then save_diagnostics "$status" "$cleanup_status" || status=1; fi
  rm -rf "$temporary" || status=1
  exit "$status"
}
forward_signal() {
  if [[ "$1" == INT ]]; then forced_status=130; else forced_status=143; fi
  signal_process_group "$1"
  # Exit also when cancellation arrives during inventory or between phases.
  exit "$forced_status"
}
trap on_exit EXIT
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

# Docker's daemon reserves container names atomically (Engine create: HTTP 409
# for a name already in use). It is never started, reused, or adopted.
# https://docs.docker.com/reference/api/engine/version/v1.53/#tag/Container/operation/ContainerCreate
lock_attempted=1
if ! lock_id="$(docker create --name "$lock_name" --label "$owner_label=$owner" --label "com.tria.integration.lock.namespace=$namespace" --network none --read-only --entrypoint /bin/true "$lock_image")"; then
  echo "Reserva exclusiva recusada; nenhum recurso alheio será removido." >&2
  exit 2
fi
inventory || { echo "Enumeração Docker falhou; ownership não estabelecido." >&2; exit 1; }
if namespace_has_resources; then echo "Recurso preexistente; cleanup proibido para $namespace." >&2; exit 2; fi
if [[ -z "${TRIA_TOOLS_IMAGE:-}" ]] && printf '%s\n' "$image_inventory" | grep -Fxq "$tools_tag"; then exit 2; fi
if [[ "$runner_needed" -eq 1 && -z "${TRIA_RUNNER_IMAGE:-}" ]] && printf '%s\n' "$image_inventory" | grep -Fxq "$runner_tag"; then exit 2; fi
resources_owned=1
run_phase() {
  local seconds="$1" name="$2" status; shift 2
  [[ "$forced_status" -eq 0 ]] || return "$forced_status"
  set -m
  if [[ "$mode" == self-test ]]; then
    node "$bounded" "$seconds" "$@" >"$temporary/child.stdout" 2>"$temporary/child.stderr" &
  else
    node "$bounded" "$seconds" --log "$temporary/$name.log" "$@" &
  fi
  child_pid=$!
  set +m
  set +e
  wait "$child_pid"
  status=$?
  set -e
  # Reap only after proving no live process remains. Never block on failed stop.
  stop_process_group_bounded || return 1
  child_pid=""
  [[ "$forced_status" -eq 0 ]] || return "$forced_status"
  return "$status"
}
if [[ "$mode" == run ]]; then
  if [[ -n "${TRIA_TOOLS_IMAGE:-}" ]]; then tools_image="$(docker image inspect -f '{{.Id}}' "$tools_tag")";
  else
    image_owned=1
    run_phase 1800 tools-build docker build --target tools --label "$owner_label=$owner" --iidfile "$temporary/tools.iid" --tag "$tools_tag" "$root"
    owned_image_id="$(cat "$temporary/tools.iid")"
    tools_image="$owned_image_id"
  fi
  if [[ "$runner_needed" -eq 1 ]]; then
    if [[ -n "${TRIA_RUNNER_IMAGE:-}" ]]; then runner_image="$(docker image inspect -f '{{.Id}}' "$runner_tag")";
    else
      runner_image_owned=1
      run_phase 1800 runner-build docker build --target runner --label "$owner_label=$owner" --iidfile "$temporary/runner.iid" --tag "$runner_tag" "$root"
      owned_runner_image_id="$(cat "$temporary/runner.iid")"
      runner_image="$owned_runner_image_id"
    fi
  fi
fi
export TRIA_INTEGRATION_ISOLATED=confirmed TRIA_INTEGRATION_NAMESPACE="$namespace" TRIA_INTEGRATION_TEMP="$temporary" TRIA_TOOLS_IMAGE="$tools_image" TRIA_RUNNER_IMAGE="$runner_image"
child_command=("${suite_command[@]}")
if [[ "$mode" == self-test ]]; then
  echo "SELF-TEST: cleanup e sinais; a suíte funcional não será alegada."
  child_command=("$self_test_child")
fi
run_phase 3600 suite "${child_command[@]}"
