#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
run_id="${GITHUB_RUN_ID:-local}"
run_attempt="${GITHUB_RUN_ATTEMPT:-0}"
[[ "$run_id" =~ ^[a-z0-9_-]+$ && "$run_attempt" =~ ^[a-z0-9_-]+$ ]] || {
  echo "Identidade da execução CI contém caracteres inválidos." >&2
  exit 2
}
story33_namespace="tria-adjustments-ci-${run_id}-${run_attempt}-${RANDOM}"

if [[ "${1:-}" == "--print-plan" ]]; then
  echo "bash scripts/ci-isolated-integration.sh"
  echo "TRIA_INTEGRATION_NAMESPACE=$story33_namespace bash scripts/source-ledger-ci-integration.sh"
  exit 0
fi

cd "$root"
# Evidências, recuperação após falha, HTTP e bootstrap sem deploy.
bash scripts/ci-isolated-integration.sh
# Preparação e reconciliação PostgreSQL no namespace descartável próprio.
TRIA_INTEGRATION_ISOLATED=confirmed \
TRIA_INTEGRATION_NAMESPACE="$story33_namespace" \
  bash scripts/source-ledger-ci-integration.sh
