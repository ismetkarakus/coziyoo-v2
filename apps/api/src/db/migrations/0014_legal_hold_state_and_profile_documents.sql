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

-- Backfill profile-document status rows from existing seller_compliance_documents.
INSERT INTO seller_compliance_profile_documents (seller_id, doc_type, latest_document_id, status, required, updated_at)
SELECT
  latest.seller_id,
  latest.doc_type,
  latest.id,
  latest.status,
  TRUE,
  NOW()
FROM (
  SELECT DISTINCT ON (d.seller_id, d.doc_type)
    d.id,
    d.seller_id,
    d.doc_type,
    d.status,
    d.uploaded_at
  FROM seller_compliance_documents d
  JOIN seller_compliance_profiles p ON p.seller_id = d.seller_id
  ORDER BY d.seller_id, d.doc_type, d.uploaded_at DESC, d.id DESC
) latest
ON CONFLICT (seller_id, doc_type)
DO UPDATE SET
  latest_document_id = EXCLUDED.latest_document_id,
  status = EXCLUDED.status,
  required = EXCLUDED.required,
  updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'legal_holds'
  ) THEN
    UPDATE users u
    SET legal_hold_state = TRUE,
        updated_at = NOW()
    FROM legal_holds lh
    WHERE lh.entity_id = u.id
      AND lh.active = TRUE
      AND lower(lh.entity_type) IN ('user', 'users', 'app_user');

    DROP TABLE legal_holds;
  END IF;
END $$;

