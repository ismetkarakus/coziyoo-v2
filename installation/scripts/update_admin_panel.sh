#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-apps/admin}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"
ADMIN_API_BASE_URL="${ADMIN_API_BASE_URL:-https://${API_DOMAIN:-api.YOURDOMAIN.com}}"
ADMIN_SERVICE_NAME="${ADMIN_SERVICE_NAME:-coziyoo-admin}"

[[ -f "${ADMIN_DIR_ABS}/package.json" ]] || fail "Admin package.json not found in ${ADMIN_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${ADMIN_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  if [[ ! -d node_modules ]]; then
    log "node_modules missing in ${ADMIN_DIR_ABS}; installing dependencies"
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
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

# Restart the Python HTTP service
service_action restart "${ADMIN_SERVICE_NAME}"

log "Admin updated (Python HTTP server restarted)"
