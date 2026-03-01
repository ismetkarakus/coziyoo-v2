#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

require_cmd psql

ROOT_ENV="${REPO_ROOT}/.env"
if [[ -f "${ROOT_ENV}" ]]; then
  export_env_file_kv "${ROOT_ENV}"
fi

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "${DATABASE_URL}" ]]; then
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-5432}"
  PGUSER="${PGUSER:-${PG_USER:-coziyoo}}"
  PGPASSWORD="${PGPASSWORD:-${PG_PASSWORD:-}}"
  PGDATABASE="${PGDATABASE:-${PG_DB:-coziyoo}}"
  DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
fi

log "Backfilling foods.image_url with real image URLs"

PSQL="psql \"${DATABASE_URL}\" -v ON_ERROR_STOP=1"

eval "${PSQL}" <<'SQL'
WITH updated AS (
  UPDATE foods
  SET image_url = CASE
    WHEN lower(name) LIKE '%mercimek%' OR lower(name) LIKE '%ezogelin%' OR lower(name) LIKE '%corba%'
      THEN 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80'
    WHEN lower(name) LIKE '%karniyarik%' OR lower(name) LIKE '%karnıyarık%' OR lower(name) LIKE '%kuru fasulye%' OR lower(name) LIKE '%fasulye%'
      THEN 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80'
    WHEN lower(name) LIKE '%tavuk%' OR lower(name) LIKE '%pilav%'
      THEN 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80'
    WHEN lower(name) LIKE '%enginar%' OR lower(name) LIKE '%zeytinyagli%' OR lower(name) LIKE '%zeytinyağlı%'
      THEN 'https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80'
    WHEN lower(name) LIKE '%sutlac%' OR lower(name) LIKE '%sütlaç%' OR lower(name) LIKE '%revani%' OR lower(name) LIKE '%baklava%' OR lower(name) LIKE '%ayran%' OR lower(name) LIKE '%salgam%' OR lower(name) LIKE '%şalgam%'
      THEN 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80'
    ELSE 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80'
  END
  WHERE image_url IS NULL
     OR btrim(image_url) = ''
     OR image_url LIKE 'https://images.coziyoo.local/%'
  RETURNING id
)
SELECT count(*)::int AS updated_rows FROM updated;
SQL

log "Food image backfill completed"
