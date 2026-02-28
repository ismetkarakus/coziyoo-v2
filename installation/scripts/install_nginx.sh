#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_NGINX:-true}" != "true" ]]; then
  log "INSTALL_NGINX=false, skipping"
  exit 0
fi

OS="$(os_type)"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.example.com}"
API_DOMAIN="${API_DOMAIN:-api.example.com}"
API_PROXY_PORT="${API_PROXY_PORT:-8000}"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"

TMP_CONF="$(mktemp)"
cat > "${TMP_CONF}" <<EOF2
server {
    listen 80;
    server_name ${ADMIN_DOMAIN};

    root ${PUBLISH_DIR};
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
}

server {
    listen 80;
    server_name ${API_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${API_PROXY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF2

if [[ "${OS}" == "linux" ]]; then
  TARGET_AVAIL="/etc/nginx/sites-available/coziyoo.conf"
  TARGET_ENABLED="/etc/nginx/sites-enabled/coziyoo.conf"
  run_root tee "${TARGET_AVAIL}" >/dev/null < "${TMP_CONF}"
  run_root ln -sf "${TARGET_AVAIL}" "${TARGET_ENABLED}"
  run_root nginx -t
  run_root systemctl reload nginx
else
  require_cmd brew
  NGINX_PREFIX="$(brew --prefix nginx 2>/dev/null || true)"
  if [[ -z "${NGINX_PREFIX}" ]]; then
    NGINX_PREFIX="$(brew --prefix)/opt/nginx"
  fi
  TARGET_DIR="${NGINX_PREFIX}/etc/nginx/servers"
  TARGET_CONF="${TARGET_DIR}/coziyoo.conf"
  run_root mkdir -p "${TARGET_DIR}"
  run_root tee "${TARGET_CONF}" >/dev/null < "${TMP_CONF}"
  run_root nginx -t
  brew services restart nginx
fi

rm -f "${TMP_CONF}"
log "Nginx setup finished"
