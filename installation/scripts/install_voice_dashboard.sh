#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[deprecated] install_voice_dashboard.sh now delegates to install_voice_agent_service.sh"
exec "${SCRIPT_DIR}/install_voice_agent_service.sh"
