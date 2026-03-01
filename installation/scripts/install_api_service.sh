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

API_DIR_ABS="$(resolve_path "${API_DIR:-.}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "package.json not found in API dir: ${API_DIR_ABS}"
ENV_FILE="${API_ENV_FILE:-${API_DIR_ABS}/.env}"
SEED_ADMIN_EMAIL_VALUE="${SEED_ADMIN_EMAIL:-admin@coziyoo.com}"
SEED_ADMIN_PASSWORD_VALUE="${SEED_ADMIN_PASSWORD:-12345}"

ensure_api_env_defaults() {
  local env_file="$1"
  local pg_db_default="${PG_DB:-coziyoo}"
  local pg_user_default="${PG_USER:-coziyoo}"
  local pg_password_default="${PG_PASSWORD:-coziyoo}"
  local admin_domain="${ADMIN_DOMAIN:-admin.coziyoo.com}"
  local agent_domain="${AGENT_DOMAIN:-agent.coziyoo.com}"
  local cors_default="${API_CORS_ALLOWED_ORIGINS:-https://${admin_domain},http://${admin_domain},https://${agent_domain},http://${agent_domain},http://localhost:8081,http://localhost:5173,http://localhost:19006}"
  local defaults=(
    "APP_JWT_SECRET=coziyoo_app_jwt_secret_change_me_1234567890"
    "ADMIN_JWT_SECRET=coziyoo_admin_jwt_secret_change_me_1234567890"
    "PAYMENT_WEBHOOK_SECRET=coziyoo_webhook_secret_1234"
    "AI_SERVER_SHARED_SECRET=coziyoo_ai_shared_secret_dummy_123456"
    "SPEECH_TO_TEXT_API_KEY=coziyoo_stt_api_key_dummy"
    "TTS_API_KEY=coziyoo_tts_api_key_dummy"
    "N8N_API_KEY=coziyoo_n8n_api_key_dummy"
    "PGHOST=127.0.0.1"
    "PGPORT=5432"
    "PGUSER=${pg_user_default}"
    "PGPASSWORD=${pg_password_default}"
    "PGDATABASE=${pg_db_default}"
    "CORS_ALLOWED_ORIGINS=${cors_default}"
  )

  if [[ ! -f "${env_file}" ]]; then
    log "Creating API env file at ${env_file}"
    mkdir -p "$(dirname "${env_file}")"
    printf "%s\n" "${defaults[@]}" > "${env_file}"
    return
  fi

  local entry key
  for entry in "${defaults[@]}"; do
    key="${entry%%=*}"
    if ! grep -q "^${key}=" "${env_file}"; then
      echo "${entry}" >> "${env_file}"
    fi
  done
}

ensure_api_env_defaults "${ENV_FILE}"

maybe_git_update "${REPO_ROOT}"

require_cmd npm
log "Installing API dependencies and building in ${API_DIR_ABS}"
(
  cd "${API_DIR_ABS}"
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
  npm run db:migrate
  SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL_VALUE}" SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD_VALUE}" npm run seed:admin
)

OS="$(os_type)"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
RUN_USER="${API_RUN_USER:-root}"
RUN_GROUP="${API_RUN_GROUP:-root}"
START_CMD="${API_START_CMD:-node dist/src/server.js}"

if [[ "${OS}" == "linux" ]]; then
  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  if run_root systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend >/dev/null 2>&1; then
    log "Existing service detected (${SERVICE_NAME}), stopping before unit update"
    run_root systemctl stop "${SERVICE_NAME}" || true
    run_root systemctl reset-failed "${SERVICE_NAME}" || true
  fi
  log "Writing systemd service ${UNIT_PATH}"
  run_root tee "${UNIT_PATH}" >/dev/null <<EOF2
[Unit]
Description=Coziyoo API Service (Node/Express)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${API_DIR_ABS}
EnvironmentFile=-${ENV_FILE}
ExecStart=/bin/bash -lc 'cd "${API_DIR_ABS}" && exec ${START_CMD}'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2

  run_root systemctl daemon-reload
  run_root systemctl enable "${SERVICE_NAME}"
  run_root systemctl restart "${SERVICE_NAME}"
else
  PLIST_DIR="${HOME}/Library/LaunchAgents"
  mkdir -p "${PLIST_DIR}"
  PLIST_PATH="${PLIST_DIR}/${SERVICE_NAME}.plist"

  log "Writing launchd agent ${PLIST_PATH}"
  cat > "${PLIST_PATH}" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "${API_DIR_ABS}" && [ -f "${ENV_FILE}" ] && set -a && source "${ENV_FILE}" && set +a; exec ${START_CMD}</string>
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

log "API service setup finished"
