#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_AGENT:-true}" != "true" ]]; then
  log "INSTALL_AGENT=false, skipping"
  exit 0
fi

AGENT_DIR_ABS="$(resolve_path "${AGENT_DIR:-agent-python}")"
[[ -d "${AGENT_DIR_ABS}" ]] || fail "Agent directory not found: ${AGENT_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"
install_python_project "${AGENT_DIR_ABS}"

OS="$(os_type)"
SERVICE_NAME="${AGENT_SERVICE_NAME:-coziyoo-agent}"
RUN_USER="${AGENT_RUN_USER:-root}"
RUN_GROUP="${AGENT_RUN_GROUP:-root}"
ENV_FILE="${AGENT_ENV_FILE:-${AGENT_DIR_ABS}/.env.local}"
START_CMD="${AGENT_START_CMD:-python src/agent_http_runner.py}"
AGENT_HTTP_HOST="${AGENT_HTTP_HOST:-127.0.0.1}"
AGENT_HTTP_PORT="${AGENT_HTTP_PORT:-8787}"

if [[ "${OS}" == "linux" ]]; then
  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  log "Writing systemd service ${UNIT_PATH}"
  run_root tee "${UNIT_PATH}" >/dev/null <<EOF2
[Unit]
Description=Coziyoo Agent Service
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${AGENT_DIR_ABS}
EnvironmentFile=-${ENV_FILE}
Environment=AGENT_HTTP_HOST=${AGENT_HTTP_HOST}
Environment=AGENT_HTTP_PORT=${AGENT_HTTP_PORT}
ExecStart=/bin/bash -lc 'cd "${AGENT_DIR_ABS}" && source "${AGENT_DIR_ABS}/.venv/bin/activate" && exec ${START_CMD}'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2

  log "Reloading systemd daemon"
  run_root systemctl daemon-reload
  log "Enabling service ${SERVICE_NAME}"
  run_root systemctl enable "${SERVICE_NAME}"
  log "Restarting service ${SERVICE_NAME}"
  if command -v timeout >/dev/null 2>&1; then
    if ! run_root timeout 90s systemctl restart "${SERVICE_NAME}"; then
      run_root systemctl status "${SERVICE_NAME}" --no-pager -l || true
      run_root journalctl -u "${SERVICE_NAME}" -n 120 --no-pager || true
      fail "Failed to restart ${SERVICE_NAME} within timeout"
    fi
  else
    run_root systemctl restart "${SERVICE_NAME}"
  fi
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
    <string>cd "${AGENT_DIR_ABS}" && source "${AGENT_DIR_ABS}/.venv/bin/activate" && export AGENT_HTTP_HOST="${AGENT_HTTP_HOST}" AGENT_HTTP_PORT="${AGENT_HTTP_PORT}"; [ -f "${ENV_FILE}" ] && set -a && source "${ENV_FILE}" && set +a; exec ${START_CMD}</string>
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

log "Agent service setup finished"
