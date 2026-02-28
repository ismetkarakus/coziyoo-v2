#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

AGENT_DIR_ABS="$(resolve_path "${AGENT_DIR:-agent-python}")"
SERVICE_NAME="${AGENT_SERVICE_NAME:-coziyoo-agent}"
[[ -d "${AGENT_DIR_ABS}" ]] || fail "Agent directory missing: ${AGENT_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"
install_python_project "${AGENT_DIR_ABS}"

service_action restart "${SERVICE_NAME}"
service_action status "${SERVICE_NAME}"
log "Agent updated"
