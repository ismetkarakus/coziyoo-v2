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

if [[ ! -f "${ROOT_ENV}" ]]; then
  GENERATOR="${SCRIPT_DIR}/generate_env.sh"
  if [[ -f "${GENERATOR}" ]]; then
    log "Root .env not found at ${ROOT_ENV}; regenerating from template and installation/config.env"
    bash "${GENERATOR}" --output "${ROOT_ENV}"
  else
    fail "Root .env not found at ${ROOT_ENV} and generator script is missing at ${GENERATOR}"
  fi
fi

maybe_git_update "${REPO_ROOT}"

(
  cd "${API_DIR_ABS}"
  NPM_INSTALL_FLAGS=(--silent --no-audit --no-fund --loglevel=error --omit=optional)
  needs_install="false"
  if [[ ! -d "${API_NODE_MODULES}" && ! -d "${ROOT_NODE_MODULES}" ]]; then
    needs_install="true"
  fi

  # Even if node_modules exists, ensure core API deps are actually resolvable from API workspace.
  if ! node -e "require.resolve('express'); require.resolve('typescript'); require.resolve('@types/express/package.json')" >/dev/null 2>&1; then
    needs_install="true"
  fi

  # Verify iconv-lite encodings module is present (can be corrupted/broken in some deployments)
  if ! node -e "require('iconv-lite').getCodec('utf8')" >/dev/null 2>&1; then
    log "iconv-lite module corrupted or incomplete; forcing reinstall"
    needs_install="true"
  fi

  if [[ "${needs_install}" == "true" ]]; then
    log "API dependencies missing/incomplete; installing dependencies"
    # Clean install from repo root (workspace root) to ensure monorepo deps are resolved
    cd "${REPO_ROOT}"
    if [[ -d "${ROOT_NODE_MODULES}" ]]; then
      log "Removing existing node_modules for clean install"
      rm -rf "${ROOT_NODE_MODULES}"
    fi
    if [[ -f package-lock.json ]]; then
      if ! npm ci "${NPM_INSTALL_FLAGS[@]}"; then
        log "npm ci failed, retrying with npm install"
        rm -rf node_modules
        npm install "${NPM_INSTALL_FLAGS[@]}"
      fi
    else
      npm install "${NPM_INSTALL_FLAGS[@]}"
    fi
    # Return to API dir for build
    cd "${API_DIR_ABS}"
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
