#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

AGENT_DIR_ABS="$(resolve_path "${AGENT_DIR:-agent-python}")"
SERVICE_NAME="${AGENT_SERVICE_NAME:-coziyoo-agent}"
if [[ "${INSTALL_AGENT:-true}" != "true" ]]; then
  log "INSTALL_AGENT=false, skipping Python agent update"
  exit 0
fi
if [[ ! -d "${AGENT_DIR_ABS}" ]]; then
  log "Agent directory missing (${AGENT_DIR_ABS}), skipping Python agent update"
  exit 0
fi

maybe_git_update "${REPO_ROOT}"
install_python_project "${AGENT_DIR_ABS}"

service_action restart "${SERVICE_NAME}"
log "Python agent updated"
