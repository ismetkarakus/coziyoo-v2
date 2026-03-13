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

# Find and sort migration files
mapfile -t MIGRATION_FILES < <(find "${MIGRATIONS_DIR}" -name "*.sql" -type f | sort)

# Legacy bootstrap:
# If the database already has core app tables but schema_migrations is empty,
# assume historical migrations were applied outside this tracker and seed
# tracking rows to prevent replaying non-idempotent early migrations.
MIGRATION_TRACK_COUNT="$(
  psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 -c "SELECT count(*)::text FROM schema_migrations;" | tr -d '[:space:]' || echo "0"
)"
USERS_TABLE_EXISTS="$(
  psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.users') IS NOT NULL;" | tr -d '[:space:]' || echo "f"
)"
if [[ "${MIGRATION_TRACK_COUNT:-0}" == "0" && "${USERS_TABLE_EXISTS}" == "t" ]]; then
  log "Detected legacy DB without schema_migrations history; bootstrapping migration tracker"
  for FILE in "${MIGRATION_FILES[@]}"; do
    FILENAME="$(basename "${FILE}")"
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
      -v fn="${FILENAME}" \
      -c "INSERT INTO schema_migrations (filename) VALUES (:'fn') ON CONFLICT (filename) DO NOTHING;"
  done
  log "Migration tracker bootstrapped from existing schema. New migrations will apply on next deploy."
  exit 0
fi

APPLIED_COUNT=0
for FILE in "${MIGRATION_FILES[@]}"; do
  FILENAME=$(basename "${FILE}")

  EXISTS="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
      -v fn="${FILENAME}" \
      -c "SELECT 1 FROM schema_migrations WHERE filename = :'fn' LIMIT 1;" | tr -d '[:space:]' || true
  )"
  if [[ "${EXISTS}" == "1" ]]; then
    log "  ✓ Already applied: ${FILENAME}"
    continue
  fi

  log "  Applying: ${FILENAME}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${FILE}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -v fn="${FILENAME}" \
    -c "INSERT INTO schema_migrations (filename) VALUES (:'fn') ON CONFLICT (filename) DO NOTHING;"
  ((APPLIED_COUNT++)) || true
  log "  ✓ Applied: ${FILENAME}"
done

if [[ ${APPLIED_COUNT} -eq 0 ]]; then
  log "No new migrations to apply."
else
  log "Applied ${APPLIED_COUNT} migration(s)."
fi
