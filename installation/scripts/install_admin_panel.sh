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
ADMIN_SERVICE_NAME="${ADMIN_SERVICE_NAME:-coziyoo-admin}"
ADMIN_PORT="${ADMIN_PORT:-81}"

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
  PYTHON_BIN="$(command -v python3 || true)"
  [[ -n "${PYTHON_BIN}" ]] || fail "python3 is required to run admin panel service in INGRESS_MODE=npm"

  UNIT_PATH="/etc/systemd/system/${ADMIN_SERVICE_NAME}.service"
  log "Configuring admin panel systemd service ${UNIT_PATH} on 127.0.0.1:${ADMIN_PORT}"
  run_root tee "${UNIT_PATH}" >/dev/null <<EOF2
[Unit]
Description=Coziyoo Admin Static Service
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${PUBLISH_DIR}
ExecStart=${PYTHON_BIN} -m http.server ${ADMIN_PORT} --bind 127.0.0.1 --directory ${PUBLISH_DIR}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2

  run_root systemctl daemon-reload
  run_root systemctl enable "${ADMIN_SERVICE_NAME}"
  run_root systemctl restart "${ADMIN_SERVICE_NAME}"
  run_root systemctl status "${ADMIN_SERVICE_NAME}" --no-pager -l
fi

log "Admin panel setup finished"
