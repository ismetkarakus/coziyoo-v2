#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
ROOT_ENV="${REPO_ROOT}/.env"
ROOT_NODE_MODULES="${REPO_ROOT}/node_modules"
API_NODE_MODULES="${API_DIR_ABS}/node_modules"

[[ -f "${API_DIR_ABS}/package.json" ]] || fail "API package.json not found in ${API_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${API_DIR_ABS}"
  NPM_INSTALL_FLAGS=(--silent --no-audit --no-fund --loglevel=error --omit=optional)
  if [[ ! -d "${API_NODE_MODULES}" && ! -d "${ROOT_NODE_MODULES}" ]]; then
    log "node_modules missing in ${API_DIR_ABS} and ${REPO_ROOT}; installing dependencies"
    if [[ -f package-lock.json ]]; then
      if ! npm ci "${NPM_INSTALL_FLAGS[@]}"; then
        log "npm ci failed, retrying with npm install"
        npm install "${NPM_INSTALL_FLAGS[@]}"
      fi
    else
      npm install "${NPM_INSTALL_FLAGS[@]}"
    fi
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
