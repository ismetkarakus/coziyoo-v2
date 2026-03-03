#!/usr/bin/env bash
set -euo pipefail

# Reset the database: drop all tables, re-run all migrations, re-seed admin.
#
# WARNING: This is DESTRUCTIVE. All data will be permanently deleted.
#
# Usage (on the VPS):
#   bash installation/scripts/reset-db.sh
#
# To also seed sample data:
#   SEED_SAMPLE_DATA=true bash installation/scripts/reset-db.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

DB_USER="${PG_USER:-coziyoo}"

log "============================================="
log " DATABASE RESET — ALL DATA WILL BE DELETED"
log "============================================="
log "Target: ${DATABASE_URL}"
log ""

# Confirm unless running non-interactively (CI / GH Actions)
if [[ -t 0 && "${RESET_DB_SKIP_CONFIRM:-false}" != "true" ]]; then
  read -r -p "Type 'yes' to confirm reset: " CONFIRM
  if [[ "${CONFIRM}" != "yes" ]]; then
    log "Aborted."
    exit 0
  fi
fi

log "Step 1/3: Wiping all tables..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO "${DB_USER}";
GRANT ALL ON SCHEMA public TO public;
SQL
log "  ✓ Schema wiped."

log "Step 2/3: Applying all migrations..."
API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
MIGRATIONS_DIR="${API_DIR_ABS}/src/db/migrations"
[[ -d "${MIGRATIONS_DIR}" ]] || fail "Migrations directory not found: ${MIGRATIONS_DIR}"

mapfile -t MIGRATION_FILES < <(find "${MIGRATIONS_DIR}" -name "*.sql" -type f | sort)
[[ ${#MIGRATION_FILES[@]} -gt 0 ]] || fail "No migration files found in ${MIGRATIONS_DIR}"

# Create migration tracker
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
  CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );"

# Apply all files in one pass — no incremental checking needed on a fresh schema
cat "${MIGRATION_FILES[@]}" | psql "${DATABASE_URL}" -v ON_ERROR_STOP=1

# Bulk-mark all files as applied
VALUES=""
for f in "${MIGRATION_FILES[@]}"; do
  VALUES="${VALUES}('$(basename "${f}")'),"
done
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "INSERT INTO schema_migrations (filename) VALUES ${VALUES%,};"
log "  ✓ Applied ${#MIGRATION_FILES[@]} migration(s)."

log "Step 3/3: Seeding..."
_api_service="${API_SERVICE_NAME:-coziyoo-api}"
_api_port="${API_PORT:-3000}"

if [[ "${SEED_SAMPLE_DATA:-false}" == "true" ]]; then
  log "  Sample data requested — restarting API first..."
  service_action restart "${_api_service}" || log "  Warning: could not restart ${_api_service} (may not be installed yet)"
  for ((_attempt=1; _attempt<=24; _attempt++)); do
    if curl -fsS --max-time 5 "http://127.0.0.1:${_api_port}/v1" >/dev/null 2>&1; then
      log "  API ready"
      break
    fi
    log "  API not ready yet (attempt ${_attempt}/24), waiting 5s..."
    sleep 5
  done
else
  log "  Seeding admin user directly via SQL (no API restart needed)"
fi
bash "${SCRIPT_DIR}/seed-data.sh"

log ""
log "✓ Database reset complete. Admin: ${SEED_ADMIN_EMAIL:-admin@coziyoo.com} / ${SEED_ADMIN_PASSWORD:-Admin12345}"
