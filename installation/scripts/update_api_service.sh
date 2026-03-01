#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
ROOT_ENV="${REPO_ROOT}/.env"

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
  
  # Note: Database migrations and seeding are NOT run during updates by design
  # Run install_all.sh if you need to re-run migrations or seeding
)

service_action restart "${SERVICE_NAME}"
log "API updated"
