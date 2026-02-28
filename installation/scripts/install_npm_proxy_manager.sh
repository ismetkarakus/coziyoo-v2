#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
  log "INGRESS_MODE is not npm, skipping Nginx Proxy Manager install"
  exit 0
fi

OS="$(os_type)"
if [[ "${OS}" != "linux" ]]; then
  log "Nginx Proxy Manager installer currently supports Linux only, skipping"
  exit 0
fi

NPM_INSTALL_DIR="${NPM_INSTALL_DIR:-/opt/nginx-proxy-manager}"
NPM_HTTP_PORT="${NPM_HTTP_PORT:-80}"
NPM_HTTPS_PORT="${NPM_HTTPS_PORT:-443}"
NPM_UI_PORT="${NPM_UI_PORT:-81}"
COMPOSE_FILE="${NPM_INSTALL_DIR}/docker-compose.yml"

ensure_compose_installed() {
  if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
    return
  fi

  log "Installing Docker Compose package"
  run_root apt-get update
  run_root apt-get install -y docker-compose-plugin \
    || run_root apt-get install -y docker-compose-v2 \
    || run_root apt-get install -y docker-compose
}

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker packages"
  run_root apt-get update
  run_root apt-get install -y docker.io
fi
ensure_compose_installed

run_root systemctl enable docker
run_root systemctl start docker

if run_root docker ps --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
  log "Nginx Proxy Manager container is already running, skipping reinstall"
  run_root docker ps --filter "name=nginx-proxy-manager" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  exit 0
fi

if run_root docker ps -a --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
  log "Nginx Proxy Manager container exists but is not running, starting it"
  run_root docker start nginx-proxy-manager >/dev/null
  run_root docker ps --filter "name=nginx-proxy-manager" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  exit 0
fi

if [[ "${INGRESS_MODE:-nginx}" == "npm" ]] && run_root systemctl is-active --quiet nginx; then
  log "Stopping local nginx to free ports for Nginx Proxy Manager"
  run_root systemctl stop nginx || true
  run_root systemctl disable nginx || true
fi

run_root mkdir -p "${NPM_INSTALL_DIR}/data" "${NPM_INSTALL_DIR}/letsencrypt"
run_root tee "${COMPOSE_FILE}" >/dev/null <<EOF
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "${NPM_HTTP_PORT}:80"
      - "${NPM_HTTPS_PORT}:443"
      - "${NPM_UI_PORT}:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
EOF

if docker compose version >/dev/null 2>&1; then
  run_root docker compose -f "${COMPOSE_FILE}" up -d
elif command -v docker-compose >/dev/null 2>&1; then
  run_root docker-compose -f "${COMPOSE_FILE}" up -d
else
  fail "Neither 'docker compose' nor 'docker-compose' is available"
fi

run_root docker ps --filter "name=nginx-proxy-manager" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
log "Nginx Proxy Manager setup finished"
