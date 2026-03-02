#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
RESET_SQL="${API_DIR_ABS}/src/db/reset-and-init-schema.sql"
[[ -f "${RESET_SQL}" ]] || fail "Reset SQL not found: ${RESET_SQL}"

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

log "Rebuilding demo database from reset schema"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${RESET_SQL}"
log "Demo database rebuild finished"
