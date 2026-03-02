#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
sync_repo_to_root
acquire_update_lock

dump_failure_diagnostics() {
  log "Collecting deployment diagnostics"
  "${SCRIPT_DIR}/run_all.sh" status api || true
  "${SCRIPT_DIR}/run_all.sh" status postgres || true
  "${SCRIPT_DIR}/run_all.sh" status voice-agent-api || true
  "${SCRIPT_DIR}/run_all.sh" status voice-agent-worker || true
  run_root journalctl -u "${API_SERVICE_NAME:-coziyoo-api}" -n 120 --no-pager || true
  run_root journalctl -u postgresql -n 80 --no-pager || true
  run_root journalctl -u "${VOICE_AGENT_API_SERVICE_NAME:-coziyoo-voice-agent-api}" -n 80 --no-pager || true
  run_root journalctl -u "${VOICE_AGENT_WORKER_SERVICE_NAME:-coziyoo-voice-agent-worker}" -n 80 --no-pager || true
}

log "Starting full update"
log "Stopping app services before update (leaving PostgreSQL running)"
"${SCRIPT_DIR}/run_all.sh" stop api || true
"${SCRIPT_DIR}/run_all.sh" stop admin || true
"${SCRIPT_DIR}/run_all.sh" stop voice-agent-api || true
"${SCRIPT_DIR}/run_all.sh" stop voice-agent-worker || true

"${SCRIPT_DIR}/update_api_service.sh"
"${SCRIPT_DIR}/update_admin_panel.sh"
"${SCRIPT_DIR}/update_voice_agent_service.sh"
if [[ -x "${SCRIPT_DIR}/apply_post_deploy_db_updates.sh" ]]; then
  "${SCRIPT_DIR}/apply_post_deploy_db_updates.sh"
fi

API_PORT="${API_PORT:-3000}"
UPDATE_SKIP_HEALTHCHECKS="${UPDATE_SKIP_HEALTHCHECKS:-false}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-8}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-12}"
HEALTHCHECK_RETRY_DELAY_SECONDS="${HEALTHCHECK_RETRY_DELAY_SECONDS:-5}"
HEALTHCHECK_PATH="${HEALTHCHECK_PATH:-/v1}"
STRICT_DB_HEALTHCHECK="${STRICT_DB_HEALTHCHECK:-false}"
if [[ "${UPDATE_SKIP_HEALTHCHECKS}" != "true" ]]; then
  log "Running liveness checks on ${HEALTHCHECK_PATH} (retries=${HEALTHCHECK_RETRIES}, delay=${HEALTHCHECK_RETRY_DELAY_SECONDS}s)"
  health_ok="false"
  health_url="http://127.0.0.1:${API_PORT}${HEALTHCHECK_PATH}"
  for ((attempt=1; attempt<=HEALTHCHECK_RETRIES; attempt++)); do
    if curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" "${health_url}" >/dev/null; then
      health_ok="true"
      log "API liveness check passed (attempt ${attempt}/${HEALTHCHECK_RETRIES})"
      break
    fi
    log "API liveness check failed (attempt ${attempt}/${HEALTHCHECK_RETRIES}), waiting ${HEALTHCHECK_RETRY_DELAY_SECONDS}s"
    sleep "${HEALTHCHECK_RETRY_DELAY_SECONDS}"
  done
  if [[ "${health_ok}" != "true" ]]; then
    dump_failure_diagnostics
    fail "API liveness checks failed after ${HEALTHCHECK_RETRIES} attempts"
  fi

  if [[ "${STRICT_DB_HEALTHCHECK}" == "true" ]]; then
    log "Running strict DB health check on /v1/health"
    if ! curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" "http://127.0.0.1:${API_PORT}/v1/health" >/dev/null; then
      dump_failure_diagnostics
      fail "Strict DB health check failed"
    fi
    log "Strict DB health check passed"
  fi

  log "Running admin login media-type compatibility check"
  login_check_status="$(
    curl -sS -o /tmp/coziyoo-admin-login-check.out -w "%{http_code}" \
      --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" \
      -X POST \
      -H 'content-type: application/json; charset="UTF-8 "' \
      -H 'accept: application/json' \
      -d '{"email":"deploy-check@invalid.local","password":"invalid-password"}' \
      "http://127.0.0.1:${API_PORT}/v1/admin/auth/login" || true
  )"
  case "${login_check_status}" in
    400|401|403|429)
      log "Admin login media-type check passed (HTTP ${login_check_status})"
      ;;
    415)
      dump_failure_diagnostics
      fail "Admin login media-type check failed with HTTP 415"
      ;;
    *)
      log "Admin login media-type check returned HTTP ${login_check_status}; inspect /tmp/coziyoo-admin-login-check.out if needed"
      ;;
  esac
else
  log "Skipping health checks (UPDATE_SKIP_HEALTHCHECKS=true)"
fi

if [[ -x "${SCRIPT_DIR}/validate_npm_domains.sh" ]]; then
  "${SCRIPT_DIR}/validate_npm_domains.sh" || log "NPM domain validation failed; check DNS/TLS/proxy hosts"
fi

log "Full update finished"
