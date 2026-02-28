#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_POSTGRES:-true}" != "true" ]]; then
  log "INSTALL_POSTGRES=false, skipping"
  exit 0
fi

OS="$(os_type)"
log "Configuring PostgreSQL on ${OS}"

if [[ "${OS}" == "linux" ]]; then
  run_root systemctl enable postgresql
  run_root systemctl start postgresql
else
  require_cmd brew
  brew services start postgresql@16
fi

if [[ -n "${PG_DB:-}" && -n "${PG_USER:-}" && -n "${PG_PASSWORD:-}" ]]; then
  log "Creating/updating PostgreSQL user and database"
  if [[ "${OS}" == "linux" ]]; then
    run_root -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO
\$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}';
  ELSE
    ALTER ROLE ${PG_USER} WITH LOGIN PASSWORD '${PG_PASSWORD}';
  END IF;
END
\$\$;
SQL

    run_root -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${PG_DB}'" | grep -q 1 || \
      run_root -u postgres createdb -O "${PG_USER}" "${PG_DB}"
  else
    psql postgres -v ON_ERROR_STOP=1 <<SQL
DO
\$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}';
  ELSE
    ALTER ROLE ${PG_USER} WITH LOGIN PASSWORD '${PG_PASSWORD}';
  END IF;
END
\$\$;
SQL

    psql postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${PG_DB}'" | grep -q 1 || \
      createdb -O "${PG_USER}" "${PG_DB}"
  fi
else
  log "PG_DB/PG_USER/PG_PASSWORD not fully set, skipping DB bootstrap"
fi

log "PostgreSQL setup finished"
