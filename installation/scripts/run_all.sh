#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ACTION="${1:-}"
SERVICE="${2:-}"

if [[ -z "${ACTION}" ]]; then
  echo "Usage: $0 <start|stop|restart|status|logs> [api|admin|voice-agent-api|voice-agent-worker|postgres]"
  exit 1
fi

api_service="${API_SERVICE_NAME:-coziyoo-api}"
admin_service="${ADMIN_SERVICE_NAME:-coziyoo-admin}"
voice_agent_api_service="${VOICE_AGENT_API_SERVICE_NAME:-coziyoo-voice-agent-api}"
voice_agent_worker_service="${VOICE_AGENT_WORKER_SERVICE_NAME:-coziyoo-voice-agent-worker}"
postgres_service="${POSTGRES_SERVICE_NAME:-postgresql}"

service_for_name() {
  case "$1" in
    api) echo "${api_service}" ;;
    admin) echo "${admin_service}" ;;
    voice-agent-api) echo "${voice_agent_api_service}" ;;
    voice-agent-worker) echo "${voice_agent_worker_service}" ;;
    postgres) echo "${postgres_service}" ;;
    *) fail "Unknown service name: $1" ;;
  esac
}

run_on_service() {
  local name="$1"
  local resolved
  resolved="$(service_for_name "${name}")"

  case "${ACTION}" in
    start|stop|restart|status)
      run_root systemctl "${ACTION}" "${resolved}"
      ;;
    logs)
      run_root journalctl -u "${resolved}" -n 100 --no-pager
      ;;
    *)
      fail "Unsupported action: ${ACTION}"
      ;;
  esac
}

if [[ -n "${SERVICE}" ]]; then
  run_on_service "${SERVICE}"
else
  run_on_service api
  run_on_service admin
  run_on_service voice-agent-api
  run_on_service voice-agent-worker
  run_on_service postgres
fi

log "Action ${ACTION} finished"
