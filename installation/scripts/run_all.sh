#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ACTION="${1:-}"
SERVICE="${2:-}"

if [[ -z "${ACTION}" ]]; then
  echo "Usage: $0 <start|stop|restart|status|logs> [api|nginx|postgres]"
  exit 1
fi

api_service="${API_SERVICE_NAME:-coziyoo-api}"

service_for_name() {
  case "$1" in
    api) echo "${api_service}" ;;
    nginx) echo "nginx" ;;
    postgres) echo "postgresql" ;;
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
  run_on_service nginx
  run_on_service postgres
fi

log "Action ${ACTION} finished"
