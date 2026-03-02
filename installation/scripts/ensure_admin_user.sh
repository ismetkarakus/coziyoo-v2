#!/usr/bin/env bash
set -euo pipefail

# Ensure admin user exists and credentials are synchronized.
# This script is intentionally independent from sample data seeding.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Preserve runtime overrides before config load.
RUNTIME_ADMIN_SYNC_EMAIL="${ADMIN_SYNC_EMAIL:-}"
RUNTIME_ADMIN_SYNC_PASSWORD="${ADMIN_SYNC_PASSWORD:-}"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"

# Runtime vars have precedence. If not provided, use stable defaults.
ADMIN_EMAIL="${RUNTIME_ADMIN_SYNC_EMAIL:-admin@coziyoo.com}"
ADMIN_PASSWORD="${RUNTIME_ADMIN_SYNC_PASSWORD:-Admin12345}"

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

log "Ensuring admin credentials are synchronized for ${ADMIN_EMAIL}"

# Verify argon2 is available (required for password hashing)
if ! node -e "require('argon2')" >/dev/null 2>&1; then
  fail "argon2 module not found in API dependencies. Run update_api_service.sh first."
fi

PASSWORD_HASH="$(
  cd "${API_DIR_ABS}" && node -e "require('argon2').hash(process.argv[1], { type: require('argon2').argon2id }).then(h => { process.stdout.write(h); }).catch(e => { console.error(e); process.exit(1); });" "${ADMIN_PASSWORD}"
)"
[[ -n "${PASSWORD_HASH}" ]] || fail "Failed to generate admin password hash"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v admin_email="${ADMIN_EMAIL}" \
  -v admin_hash="${PASSWORD_HASH}" <<'SQL'
INSERT INTO admin_users (email, password_hash, role, is_active)
VALUES (:'admin_email', :'admin_hash', 'super_admin', TRUE)
ON CONFLICT (email)
DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  is_active = TRUE,
  updated_at = now();
SQL

log "Admin credential sync completed for ${ADMIN_EMAIL}"
