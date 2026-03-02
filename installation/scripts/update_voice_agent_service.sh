#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

VOICE_AGENT_DIR_ABS="$(resolve_path "${VOICE_AGENT_DIR:-apps/voice-agent}")"
VOICE_AGENT_API_SERVICE_NAME="${VOICE_AGENT_API_SERVICE_NAME:-coziyoo-voice-agent-api}"
VOICE_AGENT_WORKER_SERVICE_NAME="${VOICE_AGENT_WORKER_SERVICE_NAME:-coziyoo-voice-agent-worker}"

[[ -d "${VOICE_AGENT_DIR_ABS}" ]] || fail "Voice agent directory not found: ${VOICE_AGENT_DIR_ABS}"
[[ -f "${VOICE_AGENT_DIR_ABS}/pyproject.toml" ]] || fail "pyproject.toml not found in ${VOICE_AGENT_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"
install_python_project "${VOICE_AGENT_DIR_ABS}"

service_action restart "${VOICE_AGENT_API_SERVICE_NAME}"
service_action restart "${VOICE_AGENT_WORKER_SERVICE_NAME}"

log "Voice agent services updated"
