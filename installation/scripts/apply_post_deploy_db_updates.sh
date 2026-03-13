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

  HAS_SELLER_COMPLIANCE_CHECKS="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
      -c "SELECT to_regclass('public.seller_compliance_checks') IS NOT NULL;" | tr -d '[:space:]' || echo "f"
  )"
  if [[ "${HAS_SELLER_COMPLIANCE_CHECKS}" != "t" ]]; then
    log "Legacy source table seller_compliance_checks not found; skipping data backfill for ${PATCH_KEY}"
    UPDATED_COUNT="0"
  else
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
  fi
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

PATCH_KEY="compliance_document_versions_v1_20260313"
PATCH_NOTE="Ensure seller compliance versioning columns and validity years schema exist/backfilled"

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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'compliance_documents_list'
      AND column_name = 'validity_days'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'compliance_documents_list'
      AND column_name = 'validity_years'
  ) THEN
    ALTER TABLE compliance_documents_list RENAME COLUMN validity_days TO validity_years;
  END IF;
END $$;

ALTER TABLE compliance_documents_list
  ADD COLUMN IF NOT EXISTS validity_years integer;

ALTER TABLE compliance_documents_list
  DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_days_check;

ALTER TABLE compliance_documents_list
  DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_years_check;

ALTER TABLE compliance_documents_list
  ADD CONSTRAINT compliance_documents_list_validity_years_check
  CHECK (validity_years IS NULL OR validity_years > 0);

ALTER TABLE seller_compliance_documents
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT TRUE;

ALTER TABLE seller_compliance_documents
  DROP CONSTRAINT IF EXISTS seller_compliance_documents_status_check;

ALTER TABLE seller_compliance_documents
  ADD CONSTRAINT seller_compliance_documents_status_check
  CHECK (status = ANY (ARRAY['requested'::text, 'uploaded'::text, 'approved'::text, 'rejected'::text, 'expired'::text]));

ALTER TABLE seller_compliance_documents
  DROP CONSTRAINT IF EXISTS seller_compliance_documents_version_check;

ALTER TABLE seller_compliance_documents
  ADD CONSTRAINT seller_compliance_documents_version_check
  CHECK (version > 0);

ALTER TABLE seller_optional_uploads
  DROP CONSTRAINT IF EXISTS seller_optional_uploads_status_check;

ALTER TABLE seller_optional_uploads
  ADD CONSTRAINT seller_optional_uploads_status_check
  CHECK (status = ANY (ARRAY['uploaded'::text, 'approved'::text, 'rejected'::text, 'archived'::text, 'expired'::text]));

ALTER TABLE seller_compliance_documents
  DROP CONSTRAINT IF EXISTS seller_compliance_documents_seller_id_document_list_id_key;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY seller_id, document_list_id
      ORDER BY COALESCE(uploaded_at, created_at) DESC, created_at DESC, id DESC
    ) AS row_rank,
    count(*) OVER (PARTITION BY seller_id, document_list_id) AS total_count
  FROM seller_compliance_documents
),
updated AS (
  UPDATE seller_compliance_documents scd
  SET
    version = ranked.total_count - ranked.row_rank + 1,
    is_current = (ranked.row_rank = 1)
  FROM ranked
  WHERE ranked.id = scd.id
  RETURNING scd.id
)
SELECT count(*)::text FROM updated;

DROP INDEX IF EXISTS idx_seller_compliance_documents_seller_document_current;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_compliance_documents_seller_document_current
  ON seller_compliance_documents (seller_id, document_list_id)
  WHERE is_current = TRUE;
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
  HAS_LEGACY_COMPLIANCE_SCHEMA="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
      -c "SELECT (to_regclass('public.seller_compliance_profiles') IS NOT NULL AND to_regclass('public.seller_compliance_documents') IS NOT NULL);" | tr -d '[:space:]' || echo "f"
  )"
  if [[ "${HAS_LEGACY_COMPLIANCE_SCHEMA}" != "t" ]]; then
    log "Legacy compliance schema not found; skipping profile-document backfill for ${PATCH_KEY}"
    UPDATED_COUNT="0"
  else
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
  fi
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

PATCH_KEY="lot_lifecycle_v1_20260302"
PATCH_NOTE="Add lot sale window and snapshot fields with idempotent backfill"

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
ALTER TABLE production_lots
ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS recipe_snapshot TEXT,
ADD COLUMN IF NOT EXISTS ingredients_snapshot_json JSONB,
ADD COLUMN IF NOT EXISTS allergens_snapshot_json JSONB;

UPDATE production_lots
SET sale_starts_at = COALESCE(sale_starts_at, NOW()),
    sale_ends_at = COALESCE(sale_ends_at, use_by, best_before, NOW() + INTERVAL '7 days')
WHERE sale_starts_at IS NULL
   OR sale_ends_at IS NULL;

ALTER TABLE production_lots
ALTER COLUMN sale_starts_at SET NOT NULL,
ALTER COLUMN sale_ends_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_lots_sale_window_check'
  ) THEN
    ALTER TABLE production_lots
    ADD CONSTRAINT production_lots_sale_window_check
    CHECK (sale_starts_at <= sale_ends_at);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_lots_produced_before_sale_start_check'
  ) THEN
    ALTER TABLE production_lots
    ADD CONSTRAINT production_lots_produced_before_sale_start_check
    CHECK (produced_at <= sale_starts_at);
  END IF;
END
$$;

ALTER TABLE production_lots
DROP CONSTRAINT IF EXISTS production_lots_status_check;

ALTER TABLE production_lots
ADD CONSTRAINT production_lots_status_check
CHECK (status IN ('open', 'locked', 'depleted', 'recalled', 'discarded', 'expired'));

SELECT count(*)::text
FROM production_lots
WHERE sale_starts_at IS NOT NULL
  AND sale_ends_at IS NOT NULL;
SQL
  )"
  UPDATED_COUNT="$(printf "%s" "${UPDATED_COUNT}" | tr -d '[:space:]')"

  FLAG_WRITTEN="$(
  psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 \
    -v flag_key="${PATCH_KEY}" \
    -v note="${PATCH_NOTE}; touched_rows=${UPDATED_COUNT}" <<'SQL'
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
    log "Patch applied (${PATCH_KEY}). Rows with sale window: ${UPDATED_COUNT}"
  fi
fi
