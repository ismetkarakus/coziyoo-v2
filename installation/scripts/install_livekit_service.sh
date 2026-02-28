#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_LIVEKIT:-true}" != "true" ]]; then
  log "INSTALL_LIVEKIT=false, skipping"
  exit 0
fi

OS="$(os_type)"
SERVICE_NAME="${LIVEKIT_SERVICE_NAME:-livekit}"
VERSION="${LIVEKIT_VERSION:-1.8.3}"
BIN_PATH="${LIVEKIT_BIN_PATH:-/usr/local/bin/livekit-server}"
CONFIG_FILE="${LIVEKIT_CONFIG_FILE:-/etc/livekit/livekit.yaml}"
PORT="${LIVEKIT_PORT:-7880}"
NODE_IP="${LIVEKIT_NODE_IP:-127.0.0.1}"
KEYS="${LIVEKIT_KEYS:-}"
FORCE_INSTALL="${FORCE_LIVEKIT_INSTALL:-false}"

if [[ "${OS}" == "linux" ]]; then
  if [[ -x "${BIN_PATH}" && "${FORCE_INSTALL}" != "true" ]]; then
    log "LiveKit binary already exists at ${BIN_PATH}, skipping binary install"
  else
    TMP_DIR="$(mktemp -d)"
    ARCHIVE="${TMP_DIR}/livekit.tgz"
    URL="https://github.com/livekit/livekit/releases/download/v${VERSION}/livekit-linux-amd64.tar.gz"
    log "Installing LiveKit ${VERSION} from ${URL}"
    curl -fsSL "${URL}" -o "${ARCHIVE}"
    tar -xzf "${ARCHIVE}" -C "${TMP_DIR}"
    run_root install -m 0755 "${TMP_DIR}/livekit-server" "${BIN_PATH}"
    rm -rf "${TMP_DIR}"
  fi

  run_root mkdir -p "$(dirname "${CONFIG_FILE}")"
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    run_root tee "${CONFIG_FILE}" >/dev/null <<EOF2
port: ${PORT}
rtc:
  tcp_port: 7881
  use_external_ip: false
keys:
EOF2
    IFS=',' read -r -a PAIRS <<< "${KEYS}"
    for pair in "${PAIRS[@]}"; do
      [[ -z "${pair}" ]] && continue
      run_root tee -a "${CONFIG_FILE}" >/dev/null <<EOF2
  ${pair}
EOF2
    done
  else
    log "LiveKit config already exists at ${CONFIG_FILE}, leaving unchanged"
  fi

  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  run_root tee "${UNIT_PATH}" >/dev/null <<EOF2
[Unit]
Description=LiveKit Server
After=network.target

[Service]
Type=simple
ExecStart=${BIN_PATH} --config ${CONFIG_FILE} --node-ip ${NODE_IP}
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
  if [[ -x "${BIN_PATH}" && "${FORCE_INSTALL}" != "true" ]]; then
    log "LiveKit binary already exists at ${BIN_PATH}, skipping binary install"
  else
    require_cmd brew
    brew tap livekit/livekit || true
    brew install livekit || true
    if command -v livekit-server >/dev/null 2>&1; then
      BIN_PATH="$(command -v livekit-server)"
    fi
  fi

  mkdir -p "${HOME}/.livekit"
  if [[ ! -f "${HOME}/.livekit/livekit.yaml" ]]; then
    cat > "${HOME}/.livekit/livekit.yaml" <<EOF2
port: ${PORT}
rtc:
  tcp_port: 7881
  use_external_ip: false
keys:
EOF2
    IFS=',' read -r -a PAIRS <<< "${KEYS}"
    for pair in "${PAIRS[@]}"; do
      [[ -z "${pair}" ]] && continue
      cat >> "${HOME}/.livekit/livekit.yaml" <<EOF2
  ${pair}
EOF2
    done
  fi

  PLIST_DIR="${HOME}/Library/LaunchAgents"
  mkdir -p "${PLIST_DIR}"
  PLIST_PATH="${PLIST_DIR}/${SERVICE_NAME}.plist"
  cat > "${PLIST_PATH}" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_PATH}</string>
    <string>--config</string>
    <string>${HOME}/.livekit/livekit.yaml</string>
    <string>--node-ip</string>
    <string>${NODE_IP}</string>
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

log "LiveKit setup finished"
