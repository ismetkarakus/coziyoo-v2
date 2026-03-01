#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-apps/admin}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"

[[ -f "${ADMIN_DIR_ABS}/package.json" ]] || fail "Admin package.json not found in ${ADMIN_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  
  # Get API base URL from root env or use default
  ROOT_ENV="${REPO_ROOT}/.env"
  if [[ -f "${ROOT_ENV}" ]]; then
    # shellcheck disable=SC1090
    source "${ROOT_ENV}"
  fi
  
  cat > .env.production <<EOF
VITE_API_BASE_URL=${API_DOMAIN:-https://api.YOURDOMAIN.com}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF

  if [[ ! -d node_modules ]]; then
    fail "node_modules missing in ${ADMIN_DIR_ABS}. Run install_all.sh once before update_all.sh."
  fi
  npm run build
)

run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

log "Admin updated (nginx serves static files, no restart needed)"
