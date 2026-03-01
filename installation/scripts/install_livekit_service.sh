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
RTC_PORT_START="${LIVEKIT_RTC_PORT_START:-50000}"
RTC_PORT_END="${LIVEKIT_RTC_PORT_END:-50200}"
FORCE_INSTALL="${FORCE_LIVEKIT_INSTALL:-false}" # backward compatibility
SERVICE_NAME="livekit-docker"
INIT_SCRIPT_OUT="${SCRIPT_DIR}/init_script.sh"

validate_livekit_keys() {
  local pairs="$1"
  local pair key secret
  IFS=',' read -r -a KEY_PAIRS <<< "${pairs}"
  for pair in "${KEY_PAIRS[@]}"; do
    [[ -z "${pair}" ]] && continue
    key="${pair%%:*}"
    secret="${pair#*:}"
    [[ -n "${key}" && -n "${secret}" ]] || fail "Invalid LIVEKIT_KEYS pair '${pair}'. Expected key:secret."
    if [[ "${#secret}" -lt 32 ]]; then
      fail "LiveKit secret for key '${key}' is too short (${#secret}). Minimum is 32 characters."
    fi
  done
}

if [[ "${OS}" == "linux" ]]; then
  if [[ "${RTC_PORT_START}" =~ ^[0-9]+$ && "${RTC_PORT_END}" =~ ^[0-9]+$ ]]; then
    if (( RTC_PORT_START < 1024 || RTC_PORT_END > 65535 || RTC_PORT_START > RTC_PORT_END )); then
      fail "Invalid LiveKit RTC port range: ${RTC_PORT_START}-${RTC_PORT_END}"
    fi
  else
    fail "LIVEKIT_RTC_PORT_START and LIVEKIT_RTC_PORT_END must be numeric"
  fi
  validate_livekit_keys "${KEYS}"

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
    log "Installing Docker for LiveKit deployment"
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

  run_root mkdir -p "${INSTALL_DIR}" "${INSTALL_DIR}/redis-data"

  run_root tee "${REDIS_CONF}" >/dev/null <<EOF_REDIS
bind 0.0.0.0
protected-mode no
port 6379
appendonly yes
EOF_REDIS

  run_root tee "${CONFIG_FILE}" >/dev/null <<EOF_CFG
port: ${PORT}
rtc:
  tcp_port: 7881
  port_range_start: ${RTC_PORT_START}
  port_range_end: ${RTC_PORT_END}
  use_external_ip: true
redis:
  address: redis:6379
keys:
EOF_CFG

  IFS=',' read -r -a PAIRS <<< "${KEYS}"
  for pair in "${PAIRS[@]}"; do
    [[ -z "${pair}" ]] && continue
    key="${pair%%:*}"
    secret="${pair#*:}"
    [[ -n "${key}" && -n "${secret}" ]] || continue
    run_root tee -a "${CONFIG_FILE}" >/dev/null <<EOF_KEY
  ${key}: ${secret}
EOF_KEY
  done

  run_root tee "${COMPOSE_FILE}" >/dev/null <<EOF_COMPOSE
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
      - "${RTC_PORT_START}-${RTC_PORT_END}:${RTC_PORT_START}-${RTC_PORT_END}/udp"
EOF_COMPOSE

  run_root tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF_UNIT
[Unit]
Description=LiveKit Docker Compose stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/env bash -lc '${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --remove-orphans'
ExecStop=/usr/bin/env bash -lc '${COMPOSE_CMD} -f "${COMPOSE_FILE}" down'
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF_UNIT

  run_root systemctl daemon-reload
  run_root systemctl enable "${SERVICE_NAME}"
  run_root systemctl stop "${SERVICE_NAME}" || true
  log "Stopping existing LiveKit compose stack (LiveKit + Redis) before restart"
  run_root bash -lc "cd '${INSTALL_DIR}' && ${COMPOSE_CMD} -f '${COMPOSE_FILE}' down" || true
  run_root systemctl restart "${SERVICE_NAME}"

  cat > "${INIT_SCRIPT_OUT}" <<EOF_INIT
#!/usr/bin/env bash
set -euo pipefail

LIVEKIT_VERSION="${VERSION}"
LIVEKIT_PORT="${PORT}"
LIVEKIT_NODE_IP="${NODE_IP}"
LIVEKIT_KEYS="${KEYS}"
LIVEKIT_RTC_PORT_START="${RTC_PORT_START}"
LIVEKIT_RTC_PORT_END="${RTC_PORT_END}"
INSTALL_DIR="/opt/livekit"
COMPOSE_FILE="\${INSTALL_DIR}/docker-compose.yaml"
CONFIG_FILE="\${INSTALL_DIR}/livekit.yaml"
REDIS_CONF="\${INSTALL_DIR}/redis.conf"
SERVICE_NAME="livekit-docker"

if [[ "\${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo ./init_script.sh" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu-based Linux VMs." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get -qq update
  apt-get -y -qq install docker.io
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  apt-get -qq update
  apt-get -y -qq install docker-compose-plugin \\
    || apt-get -y -qq install docker-compose-v2 \\
    || apt-get -y -qq install docker-compose
fi

COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Neither 'docker compose' nor 'docker-compose' is available" >&2
  exit 1
fi

systemctl enable docker
systemctl start docker

mkdir -p "\${INSTALL_DIR}" "\${INSTALL_DIR}/redis-data"

cat > "\${REDIS_CONF}" <<EOF_REDIS
bind 0.0.0.0
protected-mode no
port 6379
appendonly yes
EOF_REDIS

cat > "\${CONFIG_FILE}" <<EOF_CFG
port: \${LIVEKIT_PORT}
rtc:
  tcp_port: 7881
  port_range_start: \${LIVEKIT_RTC_PORT_START}
  port_range_end: \${LIVEKIT_RTC_PORT_END}
  use_external_ip: true
redis:
  address: redis:6379
keys:
EOF_CFG

IFS=',' read -r -a PAIRS <<< "\${LIVEKIT_KEYS}"
for pair in "\${PAIRS[@]}"; do
  [[ -z "\${pair}" ]] && continue
  key="\${pair%%:*}"
  secret="\${pair#*:}"
  [[ -n "\${key}" && -n "\${secret}" ]] || continue
  printf '  %s: %s\n' "\${key}" "\${secret}" >> "\${CONFIG_FILE}"
done

cat > "\${COMPOSE_FILE}" <<EOF_COMPOSE
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "/etc/redis/redis.conf"]
    volumes:
      - ./redis.conf:/etc/redis/redis.conf:ro
      - ./redis-data:/data

  livekit:
    image: livekit/livekit-server:v\${LIVEKIT_VERSION}
    restart: unless-stopped
    command: ["--config", "/etc/livekit.yaml", "--node-ip", "\${LIVEKIT_NODE_IP}"]
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    depends_on:
      - redis
    ports:
      - "\${LIVEKIT_PORT}:\${LIVEKIT_PORT}/tcp"
      - "7881:7881/tcp"
      - "3478:3478/udp"
      - "\${LIVEKIT_RTC_PORT_START}-\${LIVEKIT_RTC_PORT_END}:\${LIVEKIT_RTC_PORT_START}-\${LIVEKIT_RTC_PORT_END}/udp"
EOF_COMPOSE

cat > "/etc/systemd/system/\${SERVICE_NAME}.service" <<EOF_UNIT
[Unit]
Description=LiveKit Docker Compose stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=\${INSTALL_DIR}
ExecStart=/usr/bin/env bash -lc '\${COMPOSE_CMD} -f "\${COMPOSE_FILE}" up -d --remove-orphans'
ExecStop=/usr/bin/env bash -lc '\${COMPOSE_CMD} -f "\${COMPOSE_FILE}" down'
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF_UNIT

systemctl daemon-reload
systemctl enable "\${SERVICE_NAME}"
systemctl stop "\${SERVICE_NAME}" || true
\${COMPOSE_CMD} -f "\${COMPOSE_FILE}" down || true
systemctl restart "\${SERVICE_NAME}"

echo "LiveKit installation complete."
echo "Control service with: systemctl stop \${SERVICE_NAME} | systemctl start \${SERVICE_NAME}"
EOF_INIT

  chmod +x "${INIT_SCRIPT_OUT}"

  log "LiveKit deployed at ${INSTALL_DIR} using Docker Compose"
  log "Systemd service '${SERVICE_NAME}' is enabled and started"
  log "Generated startup script at ${INIT_SCRIPT_OUT}"
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
    cat > "${HOME}/.livekit/livekit.yaml" <<EOF_CFG
port: ${PORT}
rtc:
  tcp_port: 7881
  use_external_ip: false
keys:
EOF_CFG
    IFS=',' read -r -a PAIRS <<< "${KEYS}"
    for pair in "${PAIRS[@]}"; do
      [[ -z "${pair}" ]] && continue
      cat >> "${HOME}/.livekit/livekit.yaml" <<EOF_KEY
  ${pair}
EOF_KEY
    done
  fi

  PLIST_DIR="${HOME}/Library/LaunchAgents"
  mkdir -p "${PLIST_DIR}"
  PLIST_PATH="${PLIST_DIR}/${SERVICE_NAME}.plist"
  cat > "${PLIST_PATH}" <<EOF_PLIST
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
EOF_PLIST

  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  launchctl load "${PLIST_PATH}"
fi

log "LiveKit setup finished"
