#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

DASHBOARD_DIR_ABS="$(resolve_path "${VOICE_DASHBOARD_DIR:-apps/voice-dashboard}")"
DASHBOARD_API_BASE_URL="${VOICE_DASHBOARD_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
DASHBOARD_SERVICE_NAME="${VOICE_DASHBOARD_SERVICE_NAME:-coziyoo-voice-dashboard}"
ROOT_NODE_MODULES="${REPO_ROOT}/node_modules"
DASHBOARD_NODE_MODULES="${DASHBOARD_DIR_ABS}/node_modules"

[[ -f "${DASHBOARD_DIR_ABS}/package.json" ]] || fail "Voice dashboard package.json not found in ${DASHBOARD_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${DASHBOARD_DIR_ABS}"
  cat > .env.production.local <<EOF
NEXT_PUBLIC_API_BASE_URL=${DASHBOARD_API_BASE_URL}
EOF
  # Remove stale dashboard-local node_modules (workspace root handles deps)
  if [[ -d "${DASHBOARD_NODE_MODULES}" ]]; then
    log "Removing stale dashboard-local node_modules (workspace root handles deps)"
    rm -rf "${DASHBOARD_NODE_MODULES}"
  fi

  needs_install="false"
  if [[ ! -d "${ROOT_NODE_MODULES}" ]]; then
    needs_install="true"
  fi

  # Ensure core dashboard build deps are resolvable from workspace root
  if ! node -e "require.resolve('next');" >/dev/null 2>&1; then
    needs_install="true"
  fi

  if [[ "${needs_install}" == "true" ]]; then
    log "Dashboard dependencies missing/incomplete; installing from workspace root"
    npm_install_from_root
    cd "${DASHBOARD_DIR_ABS}"
  fi
  npm run build
)

# Copy static assets into standalone directory (Next.js standalone output requirement)
cp -r "${DASHBOARD_DIR_ABS}/.next/static" "${DASHBOARD_DIR_ABS}/.next/standalone/.next/static"
cp -r "${DASHBOARD_DIR_ABS}/public" "${DASHBOARD_DIR_ABS}/.next/standalone/public" 2>/dev/null || true

# Restart the voice dashboard service
service_action restart "${DASHBOARD_SERVICE_NAME}"

log "Voice dashboard updated"
