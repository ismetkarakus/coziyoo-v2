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

log "Step 2/3: Running migrations..."
bash "${SCRIPT_DIR}/db-migrate.sh"

log "Step 3/3: Seeding admin user..."
bash "${SCRIPT_DIR}/seed-data.sh"

log ""
log "✓ Database reset complete."
log "  Admin login: ${SEED_ADMIN_EMAIL:-admin@coziyoo.com} / ${SEED_ADMIN_PASSWORD:-Admin12345}"
