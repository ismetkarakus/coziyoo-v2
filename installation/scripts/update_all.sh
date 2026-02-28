#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
acquire_update_lock

log "Starting full update"
"${SCRIPT_DIR}/update_api_service.sh"
"${SCRIPT_DIR}/update_agent_service.sh"
"${SCRIPT_DIR}/update_admin_panel.sh"

API_PORT="${API_PORT:-3000}"
AGENT_HTTP_HOST="${AGENT_HTTP_HOST:-127.0.0.1}"
AGENT_HTTP_PORT="${AGENT_HTTP_PORT:-8787}"
AGENT_HEALTH_PATH="${AGENT_HEALTH_PATH:-/health}"
log "Running health checks"
curl -fsS "http://127.0.0.1:${API_PORT}/v1/health" >/dev/null
log "API health check passed"
curl -fsS "http://${AGENT_HTTP_HOST}:${AGENT_HTTP_PORT}${AGENT_HEALTH_PATH}" >/dev/null
log "Agent health check passed"

if [[ "${INGRESS_MODE:-nginx}" == "npm" && -x "${SCRIPT_DIR}/validate_npm_domains.sh" ]]; then
  "${SCRIPT_DIR}/validate_npm_domains.sh" || log "NPM domain validation failed; check DNS/TLS/proxy hosts"
fi

log "Full update finished"
