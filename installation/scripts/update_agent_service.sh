#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

AGENT_NODE_DIR_ABS="$(resolve_path "${AGENT_NODE_DIR:-agent}")"
AGENT_NODE_SERVICE_NAME="${AGENT_NODE_SERVICE_NAME:-}"
AGENT_NODE_HEALTH_URL="${AGENT_NODE_HEALTH_URL:-}"
AGENT_NODE_PACKAGE_MANAGER="${AGENT_NODE_PACKAGE_MANAGER:-npm}"
if [[ "${INSTALL_AGENT:-true}" != "true" ]]; then
  log "INSTALL_AGENT=false, skipping Node agent update"
  exit 0
fi
if [[ ! -f "${AGENT_NODE_DIR_ABS}/package.json" ]]; then
  log "Agent node package.json not found in ${AGENT_NODE_DIR_ABS}, skipping Node agent update"
  exit 0
fi

maybe_git_update "${REPO_ROOT}"

(
  cd "${AGENT_NODE_DIR_ABS}"

  if [[ "${AGENT_NODE_PACKAGE_MANAGER}" == "pnpm" ]]; then
    require_cmd pnpm
    pnpm install --frozen-lockfile
    if ! pnpm run --if-present ci; then
      pnpm run build
    fi
  elif [[ "${AGENT_NODE_PACKAGE_MANAGER}" == "npm" ]]; then
    require_cmd npm
    npm ci
    if ! npm run --if-present ci; then
      npm run build
    fi
  else
    fail "Unsupported AGENT_NODE_PACKAGE_MANAGER='${AGENT_NODE_PACKAGE_MANAGER}'. Use 'npm' or 'pnpm'."
  fi
)

if [[ -n "${AGENT_NODE_SERVICE_NAME}" ]]; then
  service_action restart "${AGENT_NODE_SERVICE_NAME}"
fi

if [[ -n "${AGENT_NODE_HEALTH_URL}" ]]; then
  curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS:-8}" "${AGENT_NODE_HEALTH_URL}" >/dev/null
fi

log "Node agent updated"
