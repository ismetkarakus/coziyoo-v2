#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_step() {
  local step="$1"
  echo ""
  echo "========== ${step} =========="
  "${SCRIPT_DIR}/${step}"
}

run_step install_prereqs.sh
run_step install_postgres.sh
run_step install_livekit_service.sh
run_step install_api_service.sh
run_step install_agent_service.sh
run_step install_admin_panel.sh
run_step install_nginx.sh

echo ""
echo "All installation steps completed."
