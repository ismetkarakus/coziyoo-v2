#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
sync_repo_to_root
acquire_update_lock

log "Starting full update"
log "Stopping all managed services before update"
"${SCRIPT_DIR}/run_all.sh" stop || true

"${SCRIPT_DIR}/update_api_service.sh"
"${SCRIPT_DIR}/update_agent_service.sh"
"${SCRIPT_DIR}/update_admin_panel.sh"

API_PORT="${API_PORT:-3000}"
AGENT_HTTP_HOST="${AGENT_HTTP_HOST:-127.0.0.1}"
AGENT_HTTP_PORT="${AGENT_HTTP_PORT:-8787}"
AGENT_HEALTH_PATH="${AGENT_HEALTH_PATH:-/health}"
ADMIN_PORT="${ADMIN_PORT:-8000}"
UPDATE_SKIP_HEALTHCHECKS="${UPDATE_SKIP_HEALTHCHECKS:-false}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-8}"
if [[ "${UPDATE_SKIP_HEALTHCHECKS}" != "true" ]]; then
  log "Running health checks"
  curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" "http://127.0.0.1:${API_PORT}/v1/health" >/dev/null
  log "API health check passed"
  curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" "http://${AGENT_HTTP_HOST}:${AGENT_HTTP_PORT}${AGENT_HEALTH_PATH}" >/dev/null
  log "Agent health check passed"
  if [[ "${INGRESS_MODE:-nginx}" == "npm" ]]; then
    curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" "http://127.0.0.1:${ADMIN_PORT}" >/dev/null
    log "Admin health check passed"
  fi
else
  log "Skipping health checks (UPDATE_SKIP_HEALTHCHECKS=true)"
fi

if [[ "${INGRESS_MODE:-nginx}" == "npm" && -x "${SCRIPT_DIR}/validate_npm_domains.sh" ]]; then
  "${SCRIPT_DIR}/validate_npm_domains.sh" || log "NPM domain validation failed; check DNS/TLS/proxy hosts"
fi

log "Full update finished"
