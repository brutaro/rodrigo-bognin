#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# Backward compatible opt-in to existing local images; never retag or delete them.
if [[ "${TRIA_E2E_LOCAL_IMAGES:-}" == 1 ]]; then
  export TRIA_TOOLS_IMAGE="${TRIA_TOOLS_IMAGE:-tria-local-tools:current}"
  export TRIA_RUNNER_IMAGE="${TRIA_RUNNER_IMAGE:-tria-local-app:current}"
fi
exec bash "$root/scripts/isolated-integration-supervisor.sh" project-resource "$@"
