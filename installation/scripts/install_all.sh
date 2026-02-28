#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

choose_livekit_install() {
  local mode="${INSTALL_LIVEKIT:-ask}"
  case "${mode}" in
    true|false)
      ;;
    ask)
      if [[ -t 0 ]]; then
        read -r -p "Install LiveKit server in this setup? (y/N): " answer
        case "${answer}" in
          y|Y|yes|YES)
            INSTALL_LIVEKIT=true
            ;;
          *)
            INSTALL_LIVEKIT=false
            ;;
        esac
      else
        INSTALL_LIVEKIT=false
        log "INSTALL_LIVEKIT=ask in non-interactive mode; defaulting to false"
      fi
      ;;
    *)
      fail "Invalid INSTALL_LIVEKIT value: ${mode} (use ask|true|false)"
      ;;
  esac
  export INSTALL_LIVEKIT
  log "LiveKit installation enabled: ${INSTALL_LIVEKIT}"
}

run_step() {
  local step="$1"
  echo ""
  echo "========== ${step} =========="
  "${SCRIPT_DIR}/${step}"
}

run_step install_prereqs.sh
run_step install_postgres.sh
choose_livekit_install
run_step install_livekit_service.sh
run_step install_api_service.sh
run_step install_agent_service.sh
run_step install_admin_panel.sh
run_step install_nginx.sh

echo ""
echo "All installation steps completed."
