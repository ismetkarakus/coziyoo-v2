#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_API:-true}" != "true" ]]; then
  log "INSTALL_API=false, skipping"
  exit 0
fi

API_DIR_ABS="$(resolve_path "${API_DIR:-.}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "package.json not found in API dir: ${API_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

require_cmd npm
log "Installing API dependencies and building in ${API_DIR_ABS}"
(
  cd "${API_DIR_ABS}"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
  npm run db:migrate
)

OS="$(os_type)"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
RUN_USER="${API_RUN_USER:-www-data}"
RUN_GROUP="${API_RUN_GROUP:-www-data}"
ENV_FILE="${API_ENV_FILE:-${API_DIR_ABS}/.env}"
START_CMD="${API_START_CMD:-node dist/src/server.js}"

if [[ "${OS}" == "linux" ]]; then
  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  log "Writing systemd service ${UNIT_PATH}"
  run_root tee "${UNIT_PATH}" >/dev/null <<EOF2
[Unit]
Description=Coziyoo API Service (Node/Express)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${API_DIR_ABS}
EnvironmentFile=-${ENV_FILE}
ExecStart=/bin/bash -lc 'cd "${API_DIR_ABS}" && exec ${START_CMD}'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2

  run_root systemctl daemon-reload
  run_root systemctl enable "${SERVICE_NAME}"
  run_root systemctl restart "${SERVICE_NAME}"
  run_root systemctl status "${SERVICE_NAME}" --no-pager -l
else
  PLIST_DIR="${HOME}/Library/LaunchAgents"
  mkdir -p "${PLIST_DIR}"
  PLIST_PATH="${PLIST_DIR}/${SERVICE_NAME}.plist"

  log "Writing launchd agent ${PLIST_PATH}"
  cat > "${PLIST_PATH}" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "${API_DIR_ABS}" && [ -f "${ENV_FILE}" ] && set -a && source "${ENV_FILE}" && set +a; exec ${START_CMD}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/${SERVICE_NAME}.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${SERVICE_NAME}.err.log</string>
</dict>
</plist>
EOF2

  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  launchctl load "${PLIST_PATH}"
fi

log "API service setup finished"
