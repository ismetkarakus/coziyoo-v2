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
ADMIN_API_BASE_URL="${ADMIN_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
ADMIN_SERVICE_NAME="${ADMIN_SERVICE_NAME:-coziyoo-admin}"

[[ -d "${ADMIN_DIR_ABS}" ]] || fail "Admin directory not found: ${ADMIN_DIR_ABS}"
maybe_git_update "${REPO_ROOT}"

require_cmd npm

log "Building admin panel in ${ADMIN_DIR_ABS}"
(
  npm_install_from_root
  
  # Build from admin directory
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${ADMIN_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  npm run build
)

log "Publishing admin files to ${PUBLISH_DIR}"
run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

# Create systemd service for static file serving
UNIT_PATH="/etc/systemd/system/${ADMIN_SERVICE_NAME}.service"
log "Creating systemd service for admin panel at ${UNIT_PATH}"

# We use 'serve' to properly handle SPA routing (-s flag routes unknown paths to index.html)
run_root tee "${UNIT_PATH}" >/dev/null <<EOF
[Unit]
Description=Coziyoo Admin Panel (Node Serve)
After=network.target

[Service]
Type=simple
User=${API_RUN_USER:-coziyoo}
Group=${API_RUN_GROUP:-coziyoo}
WorkingDirectory=${PUBLISH_DIR}
ExecStart=/usr/bin/env npx --yes serve -s . -l ${ADMIN_PORT}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

run_root systemctl daemon-reload
run_root systemctl enable "${ADMIN_SERVICE_NAME}"
run_root systemctl restart "${ADMIN_SERVICE_NAME}"

log "Admin panel setup finished (Node Serve on port ${ADMIN_PORT})"
