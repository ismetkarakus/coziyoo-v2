#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_VOICE_AGENT:-true}" != "true" ]]; then
  log "INSTALL_VOICE_AGENT=false, skipping"
  exit 0
fi

VOICE_AGENT_DIR_ABS="$(resolve_path "${VOICE_AGENT_DIR:-apps/voice-agent}")"
VOICE_AGENT_HOST="${VOICE_AGENT_HOST:-0.0.0.0}"
VOICE_AGENT_PORT="${VOICE_AGENT_PORT:-9000}"
VOICE_AGENT_API_SERVICE_NAME="${VOICE_AGENT_API_SERVICE_NAME:-coziyoo-voice-agent-api}"
VOICE_AGENT_WORKER_SERVICE_NAME="${VOICE_AGENT_WORKER_SERVICE_NAME:-coziyoo-voice-agent-worker}"
ROOT_ENV="${REPO_ROOT}/.env"

[[ -d "${VOICE_AGENT_DIR_ABS}" ]] || fail "Voice agent directory not found: ${VOICE_AGENT_DIR_ABS}"
[[ -f "${VOICE_AGENT_DIR_ABS}/pyproject.toml" ]] || fail "pyproject.toml not found in ${VOICE_AGENT_DIR_ABS}"

if [[ ! -f "${ROOT_ENV}" ]]; then
  GENERATOR="${SCRIPT_DIR}/generate_env.sh"
  if [[ -f "${GENERATOR}" ]]; then
    log "Root .env not found at ${ROOT_ENV}; generating from template and installation/config.env"
    bash "${GENERATOR}" --output "${ROOT_ENV}"
  else
    fail "Root .env not found at ${ROOT_ENV} and generator script is missing at ${GENERATOR}"
  fi
fi

maybe_git_update "${REPO_ROOT}"
install_python_project "${VOICE_AGENT_DIR_ABS}"

API_UNIT_PATH="/etc/systemd/system/${VOICE_AGENT_API_SERVICE_NAME}.service"
WORKER_UNIT_PATH="/etc/systemd/system/${VOICE_AGENT_WORKER_SERVICE_NAME}.service"

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
ExecStart=/bin/bash -lc 'cd "${VOICE_AGENT_DIR_ABS}" && exec .venv/bin/uvicorn voice_agent.join_api:app --host ${VOICE_AGENT_HOST} --port ${VOICE_AGENT_PORT}'
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
ExecStart=/bin/bash -lc 'cd "${VOICE_AGENT_DIR_ABS}" && exec .venv/bin/python -m voice_agent.entrypoint start'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOT

run_root systemctl daemon-reload
run_root systemctl enable "${VOICE_AGENT_API_SERVICE_NAME}" "${VOICE_AGENT_WORKER_SERVICE_NAME}"
run_root systemctl restart "${VOICE_AGENT_API_SERVICE_NAME}" "${VOICE_AGENT_WORKER_SERVICE_NAME}"

log "Voice agent services installed"
