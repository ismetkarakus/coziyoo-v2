#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-.}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
ENV_FILE="${API_ENV_FILE:-${API_DIR_ABS}/.env}"
SEED_ADMIN_EMAIL_VALUE="${SEED_ADMIN_EMAIL:-admin@coziyoo.com}"
SEED_ADMIN_PASSWORD_VALUE="${SEED_ADMIN_PASSWORD:-12345}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "API package.json not found in ${API_DIR_ABS}"

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
    "LIVEKIT_API_KEY=coziyoo_livekit_api_key_dummy"
    "LIVEKIT_API_SECRET=coziyoo_livekit_api_secret_dummy_12345678"
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

(
  cd "${API_DIR_ABS}"
  if [[ ! -d node_modules ]]; then
    fail "node_modules missing in ${API_DIR_ABS}. Run install_all.sh once before update_all.sh."
  fi

  npm run build

  if [[ "${UPDATE_RUN_DB_MIGRATE:-false}" == "true" ]]; then
    if [[ -n "${API_ENV_FILE:-}" && -f "${API_ENV_FILE}" ]]; then
      export_env_file_kv "${API_ENV_FILE}"
    fi
    npm run db:migrate
  fi

  if [[ "${UPDATE_RUN_SEED_ADMIN:-false}" == "true" ]]; then
    if [[ -n "${API_ENV_FILE:-}" && -f "${API_ENV_FILE}" ]]; then
      export_env_file_kv "${API_ENV_FILE}"
    fi
    SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL_VALUE}" SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD_VALUE}" npm run seed:admin
  fi
)

service_action restart "${SERVICE_NAME}"
log "API updated"
