#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-.}")"
SERVICE_NAME="${API_SERVICE_NAME:-coziyoo-api}"
[[ -f "${API_DIR_ABS}/package.json" ]] || fail "API package.json not found in ${API_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${API_DIR_ABS}"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
  npm run db:migrate
)

service_action restart "${SERVICE_NAME}"
service_action status "${SERVICE_NAME}"
log "API updated"
