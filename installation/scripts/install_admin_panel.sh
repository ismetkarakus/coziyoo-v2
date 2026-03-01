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

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-apps/admin}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"
ADMIN_PORT="${ADMIN_PORT:-8000}"

[[ -d "${ADMIN_DIR_ABS}" ]] || fail "Admin directory not found: ${ADMIN_DIR_ABS}"
maybe_git_update "${REPO_ROOT}"

require_cmd npm

log "Building admin panel in ${ADMIN_DIR_ABS}"
(
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  
  # Get API base URL from root env or use default
  ROOT_ENV="${REPO_ROOT}/.env"
  if [[ -f "${ROOT_ENV}" ]]; then
    # shellcheck disable=SC1090
    source "${ROOT_ENV}"
  fi
  
  cat > .env.production <<EOF
VITE_API_BASE_URL=${API_DOMAIN:-https://api.YOURDOMAIN.com}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
)

log "Publishing admin files to ${PUBLISH_DIR}"
run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

# Create nginx config for admin static files
NGINX_CONF="/etc/nginx/sites-available/coziyoo-admin.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/coziyoo-admin.conf"

log "Creating nginx config for admin panel at ${NGINX_CONF}"
run_root tee "${NGINX_CONF}" >/dev/null <<EOF
server {
    listen ${ADMIN_PORT};
    server_name _;
    root ${PUBLISH_DIR};
    index index.html;

    location / {
        try_files \$uri /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

run_root ln -sf "${NGINX_CONF}" "${NGINX_ENABLED}"
run_root nginx -t
run_root systemctl reload nginx

log "Admin panel setup finished (served by nginx on port ${ADMIN_PORT})"
