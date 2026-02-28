#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_ADMIN:-true}" != "true" ]]; then
  log "INSTALL_ADMIN=false, skipping"
  exit 0
fi

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-admin-panel}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"

[[ -d "${ADMIN_DIR_ABS}" ]] || fail "Admin directory not found: ${ADMIN_DIR_ABS}"
maybe_git_update "${REPO_ROOT}"

require_cmd npm

log "Building admin panel in ${ADMIN_DIR_ABS}"
(
  cd "${ADMIN_DIR_ABS}"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
)

log "Publishing admin files to ${PUBLISH_DIR}"
run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -av --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

log "Admin panel setup finished"
