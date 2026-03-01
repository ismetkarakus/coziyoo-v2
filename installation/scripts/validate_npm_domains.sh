#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DOMAIN="${API_DOMAIN:-api.coziyoo.com}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.coziyoo.com}"
AGENT_DOMAIN="${AGENT_DOMAIN:-agent.coziyoo.com}"
AGENT_HEALTH_PATH="${AGENT_HEALTH_PATH:-/health}"

log "Validating DNS + HTTPS reachability for NPM domains"

hosts=("${API_DOMAIN}" "${ADMIN_DOMAIN}")
if [[ "${INSTALL_AGENT:-true}" == "true" && -n "${AGENT_DOMAIN}" ]]; then
  hosts+=("${AGENT_DOMAIN}")
fi

for host in "${hosts[@]}"; do
  if command -v getent >/dev/null 2>&1; then
    getent hosts "${host}" >/dev/null || fail "DNS resolution failed for ${host}"
  elif command -v dig >/dev/null 2>&1; then
    dig +short "${host}" | grep -q . || fail "DNS resolution failed for ${host}"
  else
    fail "Need getent or dig to validate DNS records"
  fi
  curl -fsSIL "https://${host}" >/dev/null || fail "HTTPS check failed for ${host}"
  log "OK: ${host}"
done

curl -fsS "https://${API_DOMAIN}/v1/health" >/dev/null || fail "API public health check failed"
if [[ "${INSTALL_AGENT:-true}" == "true" && -n "${AGENT_DOMAIN}" ]]; then
  curl -fsS "https://${AGENT_DOMAIN}${AGENT_HEALTH_PATH}" >/dev/null || fail "Agent public health check failed"
else
  log "Skipping agent public health check (INSTALL_AGENT=false or AGENT_DOMAIN empty)"
fi

log "NPM domain validation passed"
