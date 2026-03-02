#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_AGENT_APP:-true}" != "true" ]]; then
  log "INSTALL_AGENT_APP=false, skipping"
  exit 0
fi

AGENT_APP_DIR_ABS="$(resolve_path "${AGENT_APP_DIR:-apps/agent}")"
PUBLISH_DIR="${AGENT_APP_PUBLISH_DIR:-/var/www/coziyoo-agent}"
AGENT_APP_PORT="${AGENT_APP_PORT:-9000}"
AGENT_API_BASE_URL="${AGENT_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
AGENT_APP_SERVICE_NAME="${AGENT_APP_SERVICE_NAME:-coziyoo-agent-app}"

[[ -d "${AGENT_APP_DIR_ABS}" ]] || fail "Agent app directory not found: ${AGENT_APP_DIR_ABS}"
maybe_git_update "${REPO_ROOT}"

require_cmd npm

log "Building agent app in ${AGENT_APP_DIR_ABS}"
(
  cd "${AGENT_APP_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${AGENT_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
)

log "Publishing agent app files to ${PUBLISH_DIR}"
run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${AGENT_APP_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

UNIT_PATH="/etc/systemd/system/${AGENT_APP_SERVICE_NAME}.service"
log "Creating Python HTTP service for agent app at ${UNIT_PATH}"

run_root tee "${UNIT_PATH}" >/dev/null <<EOF
[Unit]
Description=Coziyoo Agent App (Python HTTP Server)
After=network.target

[Service]
Type=simple
WorkingDirectory=${PUBLISH_DIR}
ExecStart=/usr/bin/env python3 -m http.server ${AGENT_APP_PORT} --bind 0.0.0.0 --directory ${PUBLISH_DIR}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

run_root systemctl daemon-reload
run_root systemctl enable "${AGENT_APP_SERVICE_NAME}"
run_root systemctl restart "${AGENT_APP_SERVICE_NAME}"

log "Agent app setup finished (Python HTTP server on port ${AGENT_APP_PORT})"
