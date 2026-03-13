ALTER TABLE compliance_documents_list
  ADD COLUMN IF NOT EXISTS validity_years integer;

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
)
UPDATE seller_compliance_documents scd
SET
  version = ranked.total_count - ranked.row_rank + 1,
  is_current = (ranked.row_rank = 1)
FROM ranked
WHERE ranked.id = scd.id;

DROP INDEX IF EXISTS idx_seller_compliance_documents_seller_document_current;

CREATE UNIQUE INDEX idx_seller_compliance_documents_seller_document_current
  ON seller_compliance_documents (seller_id, document_list_id)
  WHERE is_current = TRUE;
