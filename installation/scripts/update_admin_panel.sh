#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-admin-panel}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"

[[ -f "${ADMIN_DIR_ABS}/package.json" ]] || fail "Admin package.json not found in ${ADMIN_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${ADMIN_DIR_ABS}"
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
)

run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

if [[ "${INGRESS_MODE:-nginx}" == "npm" ]]; then
  log "INGRESS_MODE=npm, reloading host nginx for admin panel"
  run_root nginx -t
  run_root systemctl reload nginx
elif [[ "$(os_type)" == "linux" ]]; then
  run_root nginx -t
  run_root systemctl reload nginx
else
  nginx -t
  brew services restart nginx
fi

log "Admin updated"
