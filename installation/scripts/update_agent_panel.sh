#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

AGENT_APP_DIR_ABS="$(resolve_path "${AGENT_APP_DIR:-apps/agent}")"
PUBLISH_DIR="${AGENT_APP_PUBLISH_DIR:-/var/www/coziyoo-agent}"
AGENT_API_BASE_URL="${AGENT_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
AGENT_APP_SERVICE_NAME="${AGENT_APP_SERVICE_NAME:-coziyoo-agent-app}"
ROOT_NODE_MODULES="${REPO_ROOT}/node_modules"
AGENT_NODE_MODULES="${AGENT_APP_DIR_ABS}/node_modules"

[[ -f "${AGENT_APP_DIR_ABS}/package.json" ]] || fail "Agent app package.json not found in ${AGENT_APP_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${AGENT_APP_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${AGENT_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  if [[ ! -d "${AGENT_NODE_MODULES}" && ! -d "${ROOT_NODE_MODULES}" ]]; then
    log "node_modules missing in ${AGENT_APP_DIR_ABS} and ${REPO_ROOT}; installing dependencies"
    if [[ -f package-lock.json ]]; then
      if ! npm ci --silent --no-audit --no-fund --loglevel=error; then
        log "npm ci failed, retrying with npm install"
        npm install --silent --no-audit --no-fund --loglevel=error
      fi
    else
      npm install --silent --no-audit --no-fund --loglevel=error
    fi
  fi
  npm run build
)

run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${AGENT_APP_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

service_action restart "${AGENT_APP_SERVICE_NAME}"
log "Agent app updated (Python HTTP server restarted)"
