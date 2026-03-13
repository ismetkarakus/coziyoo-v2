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
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT FALSE;

ALTER TABLE seller_optional_uploads
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT FALSE;

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

UPDATE seller_compliance_documents scd
SET
  expires_at = CASE
    WHEN scd.uploaded_at IS NOT NULL
      AND cdl.validity_years IS NOT NULL
      AND cdl.validity_years > 0
    THEN scd.uploaded_at + make_interval(years => cdl.validity_years)
    ELSE NULL
  END,
  expired = CASE
    WHEN scd.status IN ('uploaded', 'approved', 'expired')
      AND scd.uploaded_at IS NOT NULL
      AND cdl.validity_years IS NOT NULL
      AND cdl.validity_years > 0
      AND scd.uploaded_at + make_interval(years => cdl.validity_years) <= now()
    THEN TRUE
    ELSE FALSE
  END
FROM compliance_documents_list cdl
WHERE cdl.id = scd.document_list_id;

UPDATE seller_optional_uploads sou
SET
  expires_at = CASE
    WHEN sou.created_at IS NOT NULL
      AND cdl.validity_years IS NOT NULL
      AND cdl.validity_years > 0
    THEN sou.created_at + make_interval(years => cdl.validity_years)
    ELSE NULL
  END,
  expired = CASE
    WHEN sou.status IN ('uploaded', 'approved', 'expired')
      AND sou.created_at IS NOT NULL
      AND cdl.validity_years IS NOT NULL
      AND cdl.validity_years > 0
      AND sou.created_at + make_interval(years => cdl.validity_years) <= now()
    THEN TRUE
    ELSE FALSE
  END
FROM compliance_documents_list cdl
WHERE cdl.id = sou.document_list_id;

DROP INDEX IF EXISTS idx_seller_compliance_documents_seller_document_current;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_compliance_documents_seller_document_current
  ON seller_compliance_documents (seller_id, document_list_id)
  WHERE is_current = TRUE;
