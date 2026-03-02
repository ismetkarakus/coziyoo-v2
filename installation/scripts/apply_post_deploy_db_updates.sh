#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

# Global on/off toggle for post-deploy DB data patches.
if [[ "${APPLY_POST_DEPLOY_DATA_PATCHES:-true}" != "true" ]]; then
  log "Post-deploy DB data patches disabled (APPLY_POST_DEPLOY_DATA_PATCHES!=true), skipping."
  exit 0
fi

# Build DATABASE_URL from components if not set
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="postgresql://${PG_USER:-coziyoo}:${PG_PASSWORD:-coziyoo}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PG_DB:-coziyoo}"
fi

PATCH_KEY="users_phone_backfill_v1_20260302"
PATCH_NOTE="Backfill users.phone from seller_compliance_checks once after deploy"

log "Checking post-deploy DB patch flag: ${PATCH_KEY}"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS deployment_update_flags (
  flag_key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT
);
SQL

EXISTS="$(
  psql "${DATABASE_URL}" -t -A \
    -v flag_key="${PATCH_KEY}" \
    -c "SELECT 1 FROM deployment_update_flags WHERE flag_key = :'flag_key' LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true
)"

if [[ "${EXISTS}" == "1" ]]; then
  log "Patch already applied (${PATCH_KEY}), skipping."
else
  log "Applying post-deploy DB patch: ${PATCH_KEY}"

  UPDATED_COUNT="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone TEXT;

WITH candidate_phone AS (
  SELECT DISTINCT ON (c.seller_id)
    c.seller_id,
    NULLIF(
      btrim(
        COALESCE(
          NULLIF(c.value_json->>'phone', ''),
          NULLIF(c.value_json->>'telephone', ''),
          NULLIF(c.value_json->>'number', ''),
          NULLIF(c.value_json->>'value', ''),
          CASE
            WHEN jsonb_typeof(c.value_json) = 'string' THEN btrim(c.value_json::text, '"')
            ELSE NULL
          END
        )
      ),
      ''
    ) AS phone
  FROM seller_compliance_checks c
  WHERE (
      lower(c.check_code) LIKE '%phone%'
      OR lower(c.check_code) LIKE '%telefon%'
    )
  ORDER BY c.seller_id, c.updated_at DESC, c.id DESC
),
updated AS (
  UPDATE users u
  SET phone = cp.phone,
      updated_at = NOW()
  FROM candidate_phone cp
  WHERE u.id = cp.seller_id
    AND cp.phone IS NOT NULL
    AND (u.phone IS NULL OR btrim(u.phone) = '')
  RETURNING u.id
)
SELECT count(*)::text FROM updated;
SQL
  )"
  UPDATED_COUNT="$(printf "%s" "${UPDATED_COUNT}" | tr -d '[:space:]')"

  FLAG_WRITTEN="$(
  psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
    -v flag_key="${PATCH_KEY}" \
    -v note="${PATCH_NOTE}; updated_rows=${UPDATED_COUNT}" <<'SQL'
INSERT INTO deployment_update_flags (flag_key, note)
VALUES (:'flag_key', :'note')
ON CONFLICT (flag_key) DO NOTHING
RETURNING flag_key;
SQL
  )"
  FLAG_WRITTEN="$(printf "%s" "${FLAG_WRITTEN}" | tr -d '[:space:]')"

  if [[ -z "${FLAG_WRITTEN}" ]]; then
    log "Patch execution completed but flag already existed (${PATCH_KEY}); treating as applied."
  else
    log "Patch applied (${PATCH_KEY}). Updated rows: ${UPDATED_COUNT}"
  fi
fi

PATCH_KEY="users_legal_hold_state_and_profile_documents_v1_20260302"
PATCH_NOTE="Ensure users.legal_hold_state and seller_compliance_profile_documents exist/backfilled"

log "Checking post-deploy DB patch flag: ${PATCH_KEY}"
EXISTS="$(
  psql "${DATABASE_URL}" -t -A \
    -v flag_key="${PATCH_KEY}" \
    -c "SELECT 1 FROM deployment_update_flags WHERE flag_key = :'flag_key' LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true
)"

if [[ "${EXISTS}" == "1" ]]; then
  log "Patch already applied (${PATCH_KEY}), skipping."
else
  log "Applying post-deploy DB patch: ${PATCH_KEY}"
  UPDATED_COUNT="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE users
ADD COLUMN IF NOT EXISTS legal_hold_state BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS seller_compliance_profile_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_compliance_profiles(seller_id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  latest_document_id UUID REFERENCES seller_compliance_documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rejected')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, doc_type)
);

WITH latest AS (
  SELECT DISTINCT ON (d.seller_id, d.doc_type)
    d.id,
    d.seller_id,
    d.doc_type,
    d.status
  FROM seller_compliance_documents d
  JOIN seller_compliance_profiles p ON p.seller_id = d.seller_id
  ORDER BY d.seller_id, d.doc_type, d.uploaded_at DESC, d.id DESC
),
upserted AS (
  INSERT INTO seller_compliance_profile_documents (seller_id, doc_type, latest_document_id, status, required, updated_at)
  SELECT seller_id, doc_type, id, status, TRUE, NOW()
  FROM latest
  ON CONFLICT (seller_id, doc_type)
  DO UPDATE SET
    latest_document_id = EXCLUDED.latest_document_id,
    status = EXCLUDED.status,
    required = EXCLUDED.required,
    updated_at = NOW()
  RETURNING id
)
SELECT count(*)::text FROM upserted;
SQL
  )"
  UPDATED_COUNT="$(printf "%s" "${UPDATED_COUNT}" | tr -d '[:space:]')"

  FLAG_WRITTEN="$(
  psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
    -v flag_key="${PATCH_KEY}" \
    -v note="${PATCH_NOTE}; upserted_rows=${UPDATED_COUNT}" <<'SQL'
INSERT INTO deployment_update_flags (flag_key, note)
VALUES (:'flag_key', :'note')
ON CONFLICT (flag_key) DO NOTHING
RETURNING flag_key;
SQL
  )"
  FLAG_WRITTEN="$(printf "%s" "${FLAG_WRITTEN}" | tr -d '[:space:]')"

  if [[ -z "${FLAG_WRITTEN}" ]]; then
    log "Patch execution completed but flag already existed (${PATCH_KEY}); treating as applied."
  else
    log "Patch applied (${PATCH_KEY}). Upserted rows: ${UPDATED_COUNT}"
  fi
fi
