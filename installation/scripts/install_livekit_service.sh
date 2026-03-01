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
VERSION="${LIVEKIT_VERSION:-1.8.3}"
INSTALL_DIR="/opt/livekit"
CONFIG_FILE="${LIVEKIT_CONFIG_FILE:-${INSTALL_DIR}/livekit.yaml}"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yaml"
REDIS_CONF="${INSTALL_DIR}/redis.conf"
PORT="${LIVEKIT_PORT:-7880}"
NODE_IP="${LIVEKIT_NODE_IP:-127.0.0.1}"
KEYS="${LIVEKIT_KEYS:-}"
FORCE_INSTALL="${FORCE_LIVEKIT_INSTALL:-false}" # kept for backward compatibility

if [[ "${OS}" == "linux" ]]; then
  ensure_compose_installed() {
    if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
      return
    fi
    run_root apt-get -qq update
    run_root apt-get -y -qq install docker-compose-plugin \
      || run_root apt-get -y -qq install docker-compose-v2 \
      || run_root apt-get -y -qq install docker-compose
  }

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker for LiveKit VM deployment"
    run_root apt-get -qq update
    run_root apt-get -y -qq install docker.io
  fi
  ensure_compose_installed
  COMPOSE_CMD=""
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    fail "Neither 'docker compose' nor 'docker-compose' is available"
  fi

  run_root systemctl enable docker
  run_root systemctl start docker

  run_root mkdir -p "${INSTALL_DIR}"
  run_root tee "${REDIS_CONF}" >/dev/null <<EOF2
bind 127.0.0.1
protected-mode yes
port 6379
appendonly yes
EOF2

  # Always render config from env to keep deployment deterministic.
  run_root tee "${CONFIG_FILE}" >/dev/null <<EOF2
port: ${PORT}
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: redis:6379
keys:
EOF2
  IFS=',' read -r -a PAIRS <<< "${KEYS}"
  for pair in "${PAIRS[@]}"; do
    [[ -z "${pair}" ]] && continue
    key="${pair%%:*}"
    secret="${pair#*:}"
    [[ -n "${key}" && -n "${secret}" ]] || continue
    run_root tee -a "${CONFIG_FILE}" >/dev/null <<EOF2
  ${key}: ${secret}
EOF2
  done

  run_root tee "${COMPOSE_FILE}" >/dev/null <<EOF2
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "/etc/redis/redis.conf"]
    volumes:
      - ./redis.conf:/etc/redis/redis.conf:ro
      - ./redis-data:/data

  livekit:
    image: livekit/livekit-server:v${VERSION}
    restart: unless-stopped
    command: ["--config", "/etc/livekit.yaml", "--node-ip", "${NODE_IP}"]
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    depends_on:
      - redis
    ports:
      - "${PORT}:${PORT}/tcp"
      - "7881:7881/tcp"
      - "3478:3478/udp"
      - "50000-60000:50000-60000/udp"
EOF2

  run_root bash -lc "cd '${INSTALL_DIR}' && ${COMPOSE_CMD} -f '${COMPOSE_FILE}' up -d --remove-orphans"
  log "LiveKit deployed at ${INSTALL_DIR} using Docker Compose"
else
  BIN_PATH="${LIVEKIT_BIN_PATH:-/usr/local/bin/livekit-server}"
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
