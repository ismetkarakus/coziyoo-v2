#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-.}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
SEED_ADMIN_EMAIL_VALUE="${SEED_ADMIN_EMAIL:-admin@coziyoo.com}"
SEED_ADMIN_PASSWORD_VALUE="${SEED_ADMIN_PASSWORD:-12345}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "API package.json not found in ${API_DIR_ABS}"

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
