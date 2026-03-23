#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[deprecated] update_voice_dashboard.sh now delegates to update_voice_agent_service.sh"
exec "${SCRIPT_DIR}/update_voice_agent_service.sh"
