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
  if [[ -f package-lock.json ]]; then
    npm ci --silent --no-audit --no-fund --loglevel=error
  else
    npm install --silent --no-audit --no-fund --loglevel=error
  fi
  npm run build
  npm run db:migrate
  SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL_VALUE}" SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD_VALUE}" npm run seed:admin
)

service_action restart "${SERVICE_NAME}"
log "API updated"
