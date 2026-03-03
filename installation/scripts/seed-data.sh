#!/usr/bin/env bash
set -euo pipefail

# Seed admin user and optionally sample data
# Must run AFTER API service is started

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Preserve runtime overrides before config load.
RUNTIME_SEED_SAMPLE_DATA="${SEED_SAMPLE_DATA:-}"
RUNTIME_SEED_BUYERS="${SEED_BUYERS:-}"
RUNTIME_SEED_SELLERS="${SEED_SELLERS:-}"
RUNTIME_SEED_CATEGORIES="${SEED_CATEGORIES:-}"
RUNTIME_SEED_FOODS_PER_SELLER="${SEED_FOODS_PER_SELLER:-}"
RUNTIME_SEED_ORDERS_PER_BUYER="${SEED_ORDERS_PER_BUYER:-}"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config
if [[ -n "${RUNTIME_SEED_SAMPLE_DATA}" ]]; then
  SEED_SAMPLE_DATA="${RUNTIME_SEED_SAMPLE_DATA}"
fi
if [[ -n "${RUNTIME_SEED_BUYERS}" ]]; then
  SEED_BUYERS="${RUNTIME_SEED_BUYERS}"
fi
if [[ -n "${RUNTIME_SEED_SELLERS}" ]]; then
  SEED_SELLERS="${RUNTIME_SEED_SELLERS}"
fi
if [[ -n "${RUNTIME_SEED_CATEGORIES}" ]]; then
  SEED_CATEGORIES="${RUNTIME_SEED_CATEGORIES}"
fi
if [[ -n "${RUNTIME_SEED_FOODS_PER_SELLER}" ]]; then
  SEED_FOODS_PER_SELLER="${RUNTIME_SEED_FOODS_PER_SELLER}"
fi
if [[ -n "${RUNTIME_SEED_ORDERS_PER_BUYER}" ]]; then
  SEED_ORDERS_PER_BUYER="${RUNTIME_SEED_ORDERS_PER_BUYER}"
fi

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"

# Normalize email to lowercase — the login endpoint queries with email.toLowerCase()
# so the stored email MUST be lowercase or the lookup will never match.
ADMIN_EMAIL="$(printf '%s' "${SEED_ADMIN_EMAIL:-admin@coziyoo.com}" | tr '[:upper:]' '[:lower:]')"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin12345}"
ADMIN_PASSWORD_SYNC_IF_EXISTS="${SEED_ADMIN_PASSWORD_SYNC_IF_EXISTS:-true}"
API_BASE_URL="http://127.0.0.1:${API_PORT:-3000}"

log "Seeding admin user: ${ADMIN_EMAIL}"

# Verify argon2 is available (required for password hashing)
# Must be checked from within the API workspace so Node can resolve workspace modules
if ! (cd "${API_DIR_ABS}" && node -e "require('argon2')") >/dev/null 2>&1; then
  fail "argon2 module not found in API dependencies. Run install_api_service.sh first."
fi

# API verifies with argon2, so generate argon2id hash via Node in API workspace.
PASSWORD_HASH="$(
  cd "${API_DIR_ABS}" && node -e "require('argon2').hash(process.argv[1], { type: require('argon2').argon2id }).then(h => { process.stdout.write(h); }).catch(e => { console.error(e); process.exit(1); });" "${ADMIN_PASSWORD}"
)"
[[ -n "${PASSWORD_HASH}" ]] || fail "Failed to generate admin password hash"

if [[ "${ADMIN_PASSWORD_SYNC_IF_EXISTS}" == "true" ]]; then
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
  log "  ✓ Ensured admin user and synced password: ${ADMIN_EMAIL}"
else
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -v admin_email="${ADMIN_EMAIL}" \
    -v admin_hash="${PASSWORD_HASH}" <<'SQL'
INSERT INTO admin_users (email, password_hash, role)
VALUES (:'admin_email', :'admin_hash', 'super_admin');
SQL
  log "  ✓ Created admin user (password sync disabled for existing users): ${ADMIN_EMAIL}"
fi

# Sample data seeding (optional, runs via Python through API)
if [[ "${SEED_SAMPLE_DATA:-false}" == "true" ]]; then
  log "Seeding sample data via API..."
  ALLOW_SEED_FAILURE="${INSTALL_ALLOW_SEED_FAILURE:-false}"
  
  PYTHON_SCRIPT="${INSTALL_DIR}/seed-data/seed_api_sample_load.py"
  if [[ -f "${PYTHON_SCRIPT}" ]]; then
    if python3 "${PYTHON_SCRIPT}" \
      --base-url "${API_BASE_URL}" \
      --database-url "${DATABASE_URL}" \
      --admin-email "${ADMIN_EMAIL}" \
      --admin-password "${ADMIN_PASSWORD}" \
      --buyers "${SEED_BUYERS:-10}" \
      --sellers "${SEED_SELLERS:-10}" \
      --categories "${SEED_CATEGORIES:-5}" \
      --foods-per-seller "${SEED_FOODS_PER_SELLER:-5}" \
      --orders-per-buyer "${SEED_ORDERS_PER_BUYER:-5}" \
      --out "${REPO_ROOT}/seed_output.json" 2>&1; then
      log "  ✓ Sample data seeding finished"
    else
      if [[ "${ALLOW_SEED_FAILURE}" == "true" ]]; then
        log "  Warning: sample data seeding failed but INSTALL_ALLOW_SEED_FAILURE=true, continuing"
      else
        fail "Sample data seeding failed. Set INSTALL_ALLOW_SEED_FAILURE=true to continue anyway."
      fi
    fi
  else
    log "  Warning: Python seed script not found at ${PYTHON_SCRIPT}"
  fi
else
  log "Sample data seeding disabled (set SEED_SAMPLE_DATA=true to enable)"
fi
