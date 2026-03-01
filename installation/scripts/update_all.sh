#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
sync_repo_to_root
acquire_update_lock

log "Starting full update"

stop_if_present() {
  local svc="$1"
  if [[ "$(os_type)" == "linux" ]]; then
    if systemctl list-unit-files | awk '{print $1}' | grep -qx "${svc}.service"; then
      run_root systemctl stop "${svc}" || true
    fi
  else
    service_action stop "${svc}" || true
  fi
}

log "Stopping services before update"
stop_if_present "${API_SERVICE_NAME:-coziyoo-api}"
stop_if_present "${AGENT_SERVICE_NAME:-coziyoo-agent}"
if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
  stop_if_present "${ADMIN_SERVICE_NAME:-coziyoo-admin}"
fi

LIVEKIT_DIR="/opt/livekit"
LIVEKIT_COMPOSE_FILE="${LIVEKIT_DIR}/docker-compose.yaml"
if [[ -f "${LIVEKIT_COMPOSE_FILE}" ]]; then
  if docker compose version >/dev/null 2>&1; then
    run_root bash -lc "cd '${LIVEKIT_DIR}' && docker compose -f '${LIVEKIT_COMPOSE_FILE}' down" || true
  elif command -v docker-compose >/dev/null 2>&1; then
    run_root bash -lc "cd '${LIVEKIT_DIR}' && docker-compose -f '${LIVEKIT_COMPOSE_FILE}' down" || true
  fi
  stop_if_present "livekit-docker"
fi

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
