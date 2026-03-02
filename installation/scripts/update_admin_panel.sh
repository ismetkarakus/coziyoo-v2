#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-apps/admin}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"
ADMIN_API_BASE_URL="${ADMIN_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
ADMIN_SERVICE_NAME="${ADMIN_SERVICE_NAME:-coziyoo-admin}"
ROOT_NODE_MODULES="${REPO_ROOT}/node_modules"
ADMIN_NODE_MODULES="${ADMIN_DIR_ABS}/node_modules"

[[ -f "${ADMIN_DIR_ABS}/package.json" ]] || fail "Admin package.json not found in ${ADMIN_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${ADMIN_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  needs_install="false"
  # Install when neither workspace-root nor app-local node_modules exists.
  if [[ ! -d "${ADMIN_NODE_MODULES}" && ! -d "${ROOT_NODE_MODULES}" ]]; then
    needs_install="true"
  fi

  # Even if node_modules exists, ensure core admin build deps are resolvable.
  if ! node -e "require.resolve('vite'); require.resolve('@vitejs/plugin-react'); require.resolve('vite/client')" >/dev/null 2>&1; then
    needs_install="true"
  fi

  if [[ "${needs_install}" == "true" ]]; then
    log "Admin dependencies missing/incomplete; installing dependencies from workspace root"
    # Install from repo root (workspace root) to ensure monorepo deps are resolved
    cd "${REPO_ROOT}"
    if [[ -f package-lock.json ]]; then
      if ! npm ci --silent --no-audit --no-fund --loglevel=error; then
        log "npm ci failed, retrying with npm install"
        rm -rf node_modules
        npm install --silent --no-audit --no-fund --loglevel=error
      fi
    else
      npm install --silent --no-audit --no-fund --loglevel=error
    fi
    # Return to admin dir for build
    cd "${ADMIN_DIR_ABS}"
  fi
  npm run build
)

run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

# Restart the Python HTTP service
service_action restart "${ADMIN_SERVICE_NAME}"

log "Admin updated (Python HTTP server restarted)"
