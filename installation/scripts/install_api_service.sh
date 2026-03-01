#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_API:-true}" != "true" ]]; then
  log "INSTALL_API=false, skipping"
  exit 0
fi

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "package.json not found in API dir: ${API_DIR_ABS}"

# Root .env is the source of truth for app config
ROOT_ENV="${REPO_ROOT}/.env"
[[ -f "${ROOT_ENV}" ]] || fail "Root .env not found at ${ROOT_ENV}"

SEED_ADMIN_EMAIL_VALUE="${SEED_ADMIN_EMAIL:-admin@YOURDOMAIN.com}"
SEED_ADMIN_PASSWORD_VALUE="${SEED_ADMIN_PASSWORD:-CHANGE_ME_TO_SECURE_PASSWORD_12345}"

maybe_git_update "${REPO_ROOT}"

require_cmd npm
log "Installing API dependencies and building in ${API_DIR_ABS}"
(
  cd "${API_DIR_ABS}"
  
  # Load root env
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_ENV}"
  set +a
  
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
  
  # Run database migrations
  log "Running database migrations"
  npm run db:migrate
  
  # Seed admin user
  log "Seeding admin user"
  SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL_VALUE}" SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD_VALUE}" npm run seed:admin
  
  # Seed sample data (optional, skip if data already exists)
  if [[ "${SEED_SAMPLE_DATA:-false}" == "true" ]]; then
    log "Seeding sample data"
    npm run seed:sample || log "Sample seeding skipped or failed (may already have data)"
  fi
)

SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
RUN_USER="${API_RUN_USER:-root}"
RUN_GROUP="${API_RUN_GROUP:-root}"
START_CMD="${API_START_CMD:-node dist/src/server.js}"

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
if run_root systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend >/dev/null 2>&1; then
  log "Existing service detected (${SERVICE_NAME}), stopping before unit update"
  run_root systemctl stop "${SERVICE_NAME}" || true
  run_root systemctl reset-failed "${SERVICE_NAME}" || true
fi

log "Writing systemd service ${UNIT_PATH}"
run_root tee "${UNIT_PATH}" >/dev/null <<EOF
[Unit]
Description=Coziyoo API Service (Node/Express)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${API_DIR_ABS}
EnvironmentFile=${ROOT_ENV}
ExecStart=/bin/bash -lc 'cd "${API_DIR_ABS}" && exec ${START_CMD}'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

run_root systemctl daemon-reload
run_root systemctl enable "${SERVICE_NAME}"
run_root systemctl restart "${SERVICE_NAME}"

log "API service setup finished"
