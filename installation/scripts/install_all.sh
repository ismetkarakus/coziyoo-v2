#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CFG_PATH="${INSTALL_CONFIG:-${INSTALL_DIR}/config.env}"
CFG_EXAMPLE_PATH="${INSTALL_DIR}/config.env.example"

if [[ ! -f "${CFG_PATH}" ]]; then
  [[ -f "${CFG_EXAMPLE_PATH}" ]] || {
    echo "ERROR: Missing config template at ${CFG_EXAMPLE_PATH}" >&2
    exit 1
  }
  cp "${CFG_EXAMPLE_PATH}" "${CFG_PATH}"
  echo "Created ${CFG_PATH} from ${CFG_EXAMPLE_PATH}. Edit it for your environment, then rerun."
  exit 0
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
sync_repo_to_root

choose_livekit_install() {
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
    log "Non-interactive mode; defaulting LiveKit install to false"
  fi
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
run_step install_npm_proxy_manager.sh
run_step install_postgres.sh
choose_livekit_install
run_step install_livekit_service.sh
run_step install_api_service.sh
run_step install_agent_service.sh
run_step install_admin_panel.sh
run_step install_nginx.sh

echo ""
echo "All installation steps completed."
