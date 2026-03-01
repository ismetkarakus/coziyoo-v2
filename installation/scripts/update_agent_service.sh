#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

AGENT_NODE_DIR_ABS="$(resolve_path "${AGENT_NODE_DIR:-agent}")"
AGENT_NODE_SERVICE_NAME="${AGENT_NODE_SERVICE_NAME:-}"
AGENT_NODE_HEALTH_URL="${AGENT_NODE_HEALTH_URL:-}"
[[ -f "${AGENT_NODE_DIR_ABS}/package.json" ]] || fail "Agent node package.json not found in ${AGENT_NODE_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${AGENT_NODE_DIR_ABS}"

  if [[ -f pnpm-lock.yaml ]]; then
    require_cmd pnpm
    pnpm install --frozen-lockfile
    if ! pnpm run --if-present ci; then
      pnpm run build
    fi
  else
    require_cmd npm
    npm ci
    if ! npm run --if-present ci; then
      npm run build
    fi
  fi
)

if [[ -n "${AGENT_NODE_SERVICE_NAME}" ]]; then
  service_action restart "${AGENT_NODE_SERVICE_NAME}"
fi

if [[ -n "${AGENT_NODE_HEALTH_URL}" ]]; then
  curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS:-8}" "${AGENT_NODE_HEALTH_URL}" >/dev/null
fi

log "Node agent updated"
