#!/usr/bin/env bash
set -euo pipefail

# Run database migrations from apps/api/src/db/migrations/
# Tracks applied migrations in schema_migrations table

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
MIGRATIONS_DIR="${API_DIR_ABS}/src/db/migrations"

[[ -d "${MIGRATIONS_DIR}" ]] || fail "Migrations directory not found: ${MIGRATIONS_DIR}"

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

log "Running database migrations from ${MIGRATIONS_DIR}"

# Ensure schema_migrations table exists
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# Get list of already applied migrations
APPLIED=$(psql "${DATABASE_URL}" -t -c "SELECT filename FROM schema_migrations;" 2>/dev/null || echo "")

# Find and sort migration files
MIGRATION_FILES=$(find "${MIGRATIONS_DIR}" -name "*.sql" -type f | sort)

APPLIED_COUNT=0
for FILE in ${MIGRATION_FILES}; do
  FILENAME=$(basename "${FILE}")
  
  # Check if already applied
  if echo "${APPLIED}" | grep -q "${FILENAME}"; then
    log "  ✓ Already applied: ${FILENAME}"
    continue
  fi
  
  log "  Applying: ${FILENAME}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${FILE}"
  psql "${DATABASE_URL}" -c "INSERT INTO schema_migrations (filename) VALUES ('${FILENAME}');"
  ((APPLIED_COUNT++)) || true
  log "  ✓ Applied: ${FILENAME}"
done

if [[ ${APPLIED_COUNT} -eq 0 ]]; then
  log "No new migrations to apply."
else
  log "Applied ${APPLIED_COUNT} migration(s)."
fi
