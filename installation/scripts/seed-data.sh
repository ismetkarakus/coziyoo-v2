#!/usr/bin/env bash
set -euo pipefail

# Seed admin user and optionally sample data
# Must run AFTER API service is started

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

API_DIR_ABS="$(resolve_path "${API_DIR:-apps/api}")"
[[ -d "${API_DIR_ABS}" ]] || fail "API directory not found: ${API_DIR_ABS}"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@coziyoo.com}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin12345}"
ADMIN_PASSWORD_SYNC_IF_EXISTS="${SEED_ADMIN_PASSWORD_SYNC_IF_EXISTS:-true}"
API_BASE_URL="http://127.0.0.1:${API_PORT:-3000}"

log "Seeding admin user: ${ADMIN_EMAIL}"

# Verify argon2 is available (required for password hashing)
if ! node -e "require('argon2')" >/dev/null 2>&1; then
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
  
  # Wait for API to be ready
  log "  Waiting for API at ${API_BASE_URL}..."
  for i in {1..60}; do
    if curl -fs "${API_BASE_URL}/v1/health" >/dev/null 2>&1; then
      log "  API is ready"
      break
    fi
    if [[ $i -eq 60 ]]; then
      log "  Warning: API did not become ready, skipping sample data seeding"
      exit 0
    fi
    sleep 1
  done
  
  PYTHON_SCRIPT="${INSTALL_DIR}/seed-data/seed_api_sample_load.py"
  if [[ -f "${PYTHON_SCRIPT}" ]]; then
    if python3 "${PYTHON_SCRIPT}" \
      --base-url "${API_BASE_URL}" \
      --database-url "${DATABASE_URL}" \
      --admin-email "${ADMIN_EMAIL}" \
      --admin-password "${ADMIN_PASSWORD}" \
      --buyers 10 \
      --sellers 10 \
      --categories 5 \
      --foods-per-seller 5 \
      --orders-per-buyer 5 \
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
