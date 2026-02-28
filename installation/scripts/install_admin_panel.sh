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
ADMIN_PORT="${ADMIN_PORT:-8000}"

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

if [[ "$(os_type)" == "linux" && "${INGRESS_MODE:-nginx}" == "npm" ]]; then
  LOCAL_CONF_AVAIL="/etc/nginx/sites-available/coziyoo-admin-local.conf"
  LOCAL_CONF_ENABLED="/etc/nginx/sites-enabled/coziyoo-admin-local.conf"
  log "Configuring host nginx to serve admin panel on 0.0.0.0:${ADMIN_PORT}"
  run_root tee "${LOCAL_CONF_AVAIL}" >/dev/null <<EOF2
server {
    listen ${ADMIN_PORT};
    server_name _;
    root ${PUBLISH_DIR};
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
}
EOF2

  run_root mkdir -p /etc/nginx/sites-enabled
  run_root ln -sf "${LOCAL_CONF_AVAIL}" "${LOCAL_CONF_ENABLED}"
  run_root rm -f /etc/nginx/sites-enabled/default
  run_root rm -f /etc/nginx/sites-enabled/coziyoo.conf

  run_root systemctl enable nginx
  run_root nginx -t
  run_root systemctl restart nginx
  run_root systemctl status nginx --no-pager -l
fi

log "Admin panel setup finished"
