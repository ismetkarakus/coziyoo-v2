#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

VOICE_AGENT_DIR_ABS="$(resolve_path "${VOICE_AGENT_DIR:-apps/voice-agent}")"
VOICE_AGENT_HOST="${VOICE_AGENT_HOST:-0.0.0.0}"
VOICE_AGENT_PORT="${VOICE_AGENT_PORT:-9000}"
VOICE_AGENT_API_SERVICE_NAME="${VOICE_AGENT_API_SERVICE_NAME:-coziyoo-voice-agent-api}"
VOICE_AGENT_WORKER_SERVICE_NAME="${VOICE_AGENT_WORKER_SERVICE_NAME:-coziyoo-voice-agent-worker}"
VOICE_AGENT_RUN_DIR="${REPO_ROOT}/run"
ROOT_ENV="${REPO_ROOT}/.env"

[[ -d "${VOICE_AGENT_DIR_ABS}" ]] || fail "Voice agent directory not found: ${VOICE_AGENT_DIR_ABS}"
[[ -f "${VOICE_AGENT_DIR_ABS}/pyproject.toml" ]] || fail "pyproject.toml not found in ${VOICE_AGENT_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"
install_python_project "${VOICE_AGENT_DIR_ABS}"

log "Creating runtime directory ${VOICE_AGENT_RUN_DIR}"
run_root mkdir -p "${VOICE_AGENT_RUN_DIR}"
run_root chown "${API_RUN_USER}:${API_RUN_GROUP}" "${VOICE_AGENT_RUN_DIR}"

API_UNIT_PATH="/etc/systemd/system/${VOICE_AGENT_API_SERVICE_NAME}.service"
WORKER_UNIT_PATH="/etc/systemd/system/${VOICE_AGENT_WORKER_SERVICE_NAME}.service"

# Always rewrite service files so new env vars and ExecStart changes take effect on every deploy
log "Writing systemd service ${API_UNIT_PATH}"
run_root tee "${API_UNIT_PATH}" >/dev/null <<EOT
[Unit]
Description=Coziyoo Voice Agent Join API
After=network.target

[Service]
Type=simple
User=${API_RUN_USER:-coziyoo}
Group=${API_RUN_GROUP:-coziyoo}
WorkingDirectory=${VOICE_AGENT_DIR_ABS}
EnvironmentFile=${ROOT_ENV}
Environment=VOICE_AGENT_REQUEST_LOG_FILE=${VOICE_AGENT_RUN_DIR}/voice-agent-requests.log
Environment=VOICE_AGENT_WORKER_HEARTBEAT_FILE=${VOICE_AGENT_RUN_DIR}/voice-agent-worker-heartbeat.json
ExecStart=/bin/bash -lc 'cd "${VOICE_AGENT_DIR_ABS}" && exec .venv/bin/uvicorn voice_agent.join_api:app --host ${VOICE_AGENT_HOST} --port ${VOICE_AGENT_PORT} --no-access-log'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOT

log "Writing systemd service ${WORKER_UNIT_PATH}"
run_root tee "${WORKER_UNIT_PATH}" >/dev/null <<EOT
[Unit]
Description=Coziyoo Voice Agent LiveKit Worker
After=network.target

[Service]
Type=simple
User=${API_RUN_USER:-coziyoo}
Group=${API_RUN_GROUP:-coziyoo}
WorkingDirectory=${VOICE_AGENT_DIR_ABS}
EnvironmentFile=${ROOT_ENV}
Environment=VOICE_AGENT_REQUEST_LOG_FILE=${VOICE_AGENT_RUN_DIR}/voice-agent-requests.log
Environment=VOICE_AGENT_WORKER_HEARTBEAT_FILE=${VOICE_AGENT_RUN_DIR}/voice-agent-worker-heartbeat.json
ExecStart=/bin/bash -lc 'cd "${VOICE_AGENT_DIR_ABS}" && exec .venv/bin/python -m voice_agent.entrypoint start'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOT

run_root systemctl daemon-reload
run_root systemctl enable "${VOICE_AGENT_API_SERVICE_NAME}" "${VOICE_AGENT_WORKER_SERVICE_NAME}"
service_action restart "${VOICE_AGENT_API_SERVICE_NAME}"
service_action restart "${VOICE_AGENT_WORKER_SERVICE_NAME}"

log "Voice agent services updated"
