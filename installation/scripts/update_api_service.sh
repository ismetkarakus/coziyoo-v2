#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
ROOT_ENV="${REPO_ROOT}/.env"

SEED_ADMIN_EMAIL_VALUE="${SEED_ADMIN_EMAIL:-admin@YOURDOMAIN.com}"
SEED_ADMIN_PASSWORD_VALUE="${SEED_ADMIN_PASSWORD:-CHANGE_ME_TO_SECURE_PASSWORD_12345}"

[[ -f "${API_DIR_ABS}/package.json" ]] || fail "API package.json not found in ${API_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${API_DIR_ABS}"
  if [[ ! -d node_modules ]]; then
    fail "node_modules missing in ${API_DIR_ABS}. Run install_all.sh once before update_all.sh."
  fi

  # Load root env
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_ENV}"
  set +a

  npm run build

  # Run database migrations if enabled
  if [[ "${UPDATE_RUN_DB_MIGRATE:-false}" == "true" ]]; then
    log "Running database migrations"
    npm run db:migrate
  fi

  # Seed admin if enabled
  if [[ "${UPDATE_RUN_SEED_ADMIN:-false}" == "true" ]]; then
    log "Seeding admin user"
    SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL_VALUE}" SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD_VALUE}" npm run seed:admin
  fi
  
  # Seed sample data if enabled
  if [[ "${UPDATE_RUN_SEED_SAMPLE:-false}" == "true" ]]; then
    log "Seeding sample data"
    npm run seed:sample || log "Sample seeding skipped or failed"
  fi
)

service_action restart "${SERVICE_NAME}"
log "API updated"
