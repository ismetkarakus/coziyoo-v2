#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ACTION="${1:-}"
SERVICE="${2:-}"

if [[ -z "${ACTION}" ]]; then
  echo "Usage: $0 <start|stop|restart|status|logs> [api|agent|admin|nginx|postgres]"
  exit 1
fi

api_service="${API_SERVICE_NAME:-coziyoo-api}"
agent_service="${AGENT_SERVICE_NAME:-coziyoo-agent}"
admin_service="${ADMIN_SERVICE_NAME:-coziyoo-admin}"
agent_dir_abs="$(resolve_path "${AGENT_DIR:-agent-python}")"
agent_enabled="true"
if [[ "${INSTALL_AGENT:-true}" != "true" || ! -d "${agent_dir_abs}" ]]; then
  agent_enabled="false"
fi

service_for_name() {
  case "$1" in
    api) echo "${api_service}" ;;
    agent) echo "${agent_service}" ;;
    admin) echo "${admin_service}" ;;
    nginx) echo "nginx" ;;
    postgres)
      if [[ "$(os_type)" == "linux" ]]; then
        echo "postgresql"
      else
        echo "postgresql@16"
      fi
      ;;
    *) fail "Unknown service name: $1" ;;
  esac
}

run_on_service() {
  local name="$1"
  local resolved
  resolved="$(service_for_name "${name}")"

  case "${ACTION}" in
    start|stop|restart|status)
      service_action "${ACTION}" "${resolved}"
      ;;
    logs)
      if [[ "$(os_type)" == "linux" ]]; then
        run_root journalctl -u "${resolved}" -n 100 --no-pager
      else
        tail -n 100 "/tmp/${resolved}.out.log" "/tmp/${resolved}.err.log" 2>/dev/null || true
      fi
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
  if [[ "${agent_enabled}" == "true" ]]; then
    run_on_service agent
  else
    log "Skipping agent service action (INSTALL_AGENT=false or agent dir missing)"
  fi
  run_on_service admin
  if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
    run_on_service nginx
  else
    log "INGRESS_MODE=npm, skipping nginx service action"
  fi
  run_on_service postgres
fi

log "Action ${ACTION} finished"
