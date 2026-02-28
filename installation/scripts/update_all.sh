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
log "Running health checks"
curl -fsS "http://127.0.0.1:${API_PORT}/v1/health" >/dev/null
log "API health check passed"

log "Full update finished"
