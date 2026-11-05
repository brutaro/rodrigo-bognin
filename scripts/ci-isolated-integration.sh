#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$root/scripts/isolated-integration-supervisor.sh" evidence "$@"
