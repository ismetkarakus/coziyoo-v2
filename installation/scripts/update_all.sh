#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Preserve runtime overrides passed from caller before config load.
RUNTIME_DEMO_DB_REBUILD_ON_UPDATE="${DEMO_DB_REBUILD_ON_UPDATE:-}"
RUNTIME_DEMO_DB_REBUILD_ON_SCHEMA_CHANGE="${DEMO_DB_REBUILD_ON_SCHEMA_CHANGE:-}"
RUNTIME_DEMO_DB_RESEED_ON_UPDATE="${DEMO_DB_RESEED_ON_UPDATE:-}"
RUNTIME_ADMIN_SYNC_ON_UPDATE="${ADMIN_SYNC_ON_UPDATE:-}"
RUNTIME_ADMIN_SYNC_EMAIL="${ADMIN_SYNC_EMAIL:-}"
RUNTIME_ADMIN_SYNC_PASSWORD="${ADMIN_SYNC_PASSWORD:-}"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
if [[ -n "${RUNTIME_DEMO_DB_REBUILD_ON_UPDATE}" ]]; then
  DEMO_DB_REBUILD_ON_UPDATE="${RUNTIME_DEMO_DB_REBUILD_ON_UPDATE}"
fi
if [[ -n "${RUNTIME_DEMO_DB_REBUILD_ON_SCHEMA_CHANGE}" ]]; then
  DEMO_DB_REBUILD_ON_SCHEMA_CHANGE="${RUNTIME_DEMO_DB_REBUILD_ON_SCHEMA_CHANGE}"
fi
if [[ -n "${RUNTIME_DEMO_DB_RESEED_ON_UPDATE}" ]]; then
  DEMO_DB_RESEED_ON_UPDATE="${RUNTIME_DEMO_DB_RESEED_ON_UPDATE}"
fi
if [[ -n "${RUNTIME_ADMIN_SYNC_ON_UPDATE}" ]]; then
  ADMIN_SYNC_ON_UPDATE="${RUNTIME_ADMIN_SYNC_ON_UPDATE}"
fi
if [[ -n "${RUNTIME_ADMIN_SYNC_EMAIL}" ]]; then
  ADMIN_SYNC_EMAIL="${RUNTIME_ADMIN_SYNC_EMAIL}"
fi
if [[ -n "${RUNTIME_ADMIN_SYNC_PASSWORD}" ]]; then
  ADMIN_SYNC_PASSWORD="${RUNTIME_ADMIN_SYNC_PASSWORD}"
fi
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

db_rebuilt="false"
should_rebuild_db="false"

if [[ "${DEMO_DB_REBUILD_ON_UPDATE:-false}" == "true" ]]; then
  should_rebuild_db="true"
  log "DB rebuild decision: DEMO_DB_REBUILD_ON_UPDATE=true"
elif [[ "${DEMO_DB_REBUILD_ON_SCHEMA_CHANGE:-true}" == "true" ]]; then
  if [[ "${GIT_UPDATE:-false}" == "true" && -d "${REPO_ROOT}/.git" ]]; then
    current_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo "")"
    deploy_branch="${DEPLOY_BRANCH:-main}"
    if [[ -n "${current_sha}" ]]; then
      git -C "${REPO_ROOT}" fetch --quiet origin "${deploy_branch}" || true
      remote_sha="$(git -C "${REPO_ROOT}" rev-parse "origin/${deploy_branch}" 2>/dev/null || echo "")"
      if [[ -n "${remote_sha}" && "${remote_sha}" != "${current_sha}" ]]; then
        if git -C "${REPO_ROOT}" diff --name-only "${current_sha}..${remote_sha}" | grep -E -q \
          '^(apps/api/src/db/migrations/|apps/api/src/db/reset-and-init-schema\.sql|installation/scripts/apply_post_deploy_db_updates\.sh)'; then
          should_rebuild_db="true"
          log "DB rebuild decision: schema-affecting files changed on ${deploy_branch}"
        else
          log "DB rebuild decision: no schema-affecting file changes detected"
        fi
      else
        log "DB rebuild decision: no new remote commit detected"
      fi
    fi
  else
    log "DB rebuild decision: schema-change mode enabled but git remote diff unavailable"
  fi
fi

if [[ "${should_rebuild_db}" == "true" ]]; then
  log "Rebuilding demo DB before service updates"
  "${SCRIPT_DIR}/rebuild_demo_db.sh"
  db_rebuilt="true"
fi

"${SCRIPT_DIR}/update_api_service.sh"

if [[ "${db_rebuilt}" == "true" && "${DEMO_DB_RESEED_ON_UPDATE:-true}" == "true" ]]; then
  log "Demo DB rebuilt, reseeding..."
  _seed_api_port="${API_PORT:-3000}"
  if [[ "${SEED_SAMPLE_DATA:-false}" == "true" ]]; then
    log "  Sample data requested — waiting for API..."
    for ((_attempt=1; _attempt<=24; _attempt++)); do
      if curl -fsS --max-time 5 "http://127.0.0.1:${_seed_api_port}/v1" >/dev/null 2>&1; then
        log "  API ready, reseeding"
        break
      fi
      log "  API not ready yet (attempt ${_attempt}/24), waiting 5s..."
      sleep 5
    done
  else
    log "  Seeding admin user directly via SQL (no API wait needed)"
  fi
  "${SCRIPT_DIR}/seed-data.sh"
fi

if [[ "${ADMIN_SYNC_ON_UPDATE:-true}" == "true" ]]; then
  log "Synchronizing admin credentials after update"
  "${SCRIPT_DIR}/ensure_admin_user.sh"
fi

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
