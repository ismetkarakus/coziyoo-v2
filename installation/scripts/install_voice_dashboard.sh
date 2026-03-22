#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_VOICE_DASHBOARD:-true}" != "true" ]]; then
  log "INSTALL_VOICE_DASHBOARD=false, skipping"
  exit 0
fi

DASHBOARD_DIR_ABS="$(resolve_path "${VOICE_DASHBOARD_DIR:-apps/voice-dashboard}")"
DASHBOARD_PORT="${VOICE_DASHBOARD_PORT:-3001}"
DASHBOARD_API_BASE_URL="${VOICE_DASHBOARD_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
DASHBOARD_SERVICE_NAME="${VOICE_DASHBOARD_SERVICE_NAME:-coziyoo-voice-dashboard}"

[[ -d "${DASHBOARD_DIR_ABS}" ]] || fail "Voice dashboard directory not found: ${DASHBOARD_DIR_ABS}"
maybe_git_update "${REPO_ROOT}"

require_cmd npm

log "Building voice dashboard in ${DASHBOARD_DIR_ABS}"
(
  npm_install_from_root

  cd "${DASHBOARD_DIR_ABS}"
  cat > .env.production.local <<EOF
NEXT_PUBLIC_API_BASE_URL=${DASHBOARD_API_BASE_URL}
EOF
  npm run build
)

# Copy static assets into standalone directory (Next.js standalone output requirement)
cp -r "${DASHBOARD_DIR_ABS}/.next/static" "${DASHBOARD_DIR_ABS}/.next/standalone/.next/static"
cp -r "${DASHBOARD_DIR_ABS}/public" "${DASHBOARD_DIR_ABS}/.next/standalone/public" 2>/dev/null || true

# Create systemd service for Next.js standalone server
UNIT_PATH="/etc/systemd/system/${DASHBOARD_SERVICE_NAME}.service"
log "Creating systemd service for voice dashboard at ${UNIT_PATH}"

run_root tee "${UNIT_PATH}" >/dev/null <<EOF
[Unit]
Description=Coziyoo Voice Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=${API_RUN_USER:-coziyoo}
Group=${API_RUN_GROUP:-coziyoo}
WorkingDirectory=${DASHBOARD_DIR_ABS}/.next/standalone
ExecStart=/bin/bash -lc 'cd "${DASHBOARD_DIR_ABS}/.next/standalone" && exec node server.js'
Environment=PORT=${DASHBOARD_PORT}
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_BASE_URL=${DASHBOARD_API_BASE_URL}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

run_root systemctl daemon-reload
run_root systemctl enable "${DASHBOARD_SERVICE_NAME}"
run_root systemctl restart "${DASHBOARD_SERVICE_NAME}"

log "Voice dashboard setup finished (Next.js standalone on port ${DASHBOARD_PORT})"
