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

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@coziyoo.com}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin12345}"
API_BASE_URL="http://127.0.0.1:${API_PORT:-3000}"

log "Seeding admin user: ${ADMIN_EMAIL}"

# Check if admin already exists
EXISTS=$(psql "${DATABASE_URL}" -t -c "SELECT 1 FROM admin_users WHERE email = '${ADMIN_EMAIL}';" 2>/dev/null | tr -d '[:space:]' || echo "")

if [[ "${EXISTS}" == "1" ]]; then
  log "  Admin user ${ADMIN_EMAIL} already exists, skipping."
else
  # Create admin with pgcrypto (no external dependencies)
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO admin_users (email, password_hash, role)
VALUES (
  '${ADMIN_EMAIL}',
  crypt('${ADMIN_PASSWORD}', gen_salt('bf')),
  'super_admin'
);
SQL
  log "  ✓ Created admin user: ${ADMIN_EMAIL}"
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
