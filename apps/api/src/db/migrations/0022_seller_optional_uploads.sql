CREATE TABLE IF NOT EXISTS seller_optional_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_list_id UUID REFERENCES compliance_documents_list(id) ON DELETE SET NULL,
  custom_title TEXT,
  custom_description TEXT,
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'approved', 'rejected', 'archived')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    document_list_id IS NOT NULL
    OR (custom_title IS NOT NULL AND length(trim(custom_title)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_seller_optional_uploads_seller
  ON seller_optional_uploads(seller_id);

CREATE INDEX IF NOT EXISTS idx_seller_optional_uploads_status
  ON seller_optional_uploads(status);

CREATE INDEX IF NOT EXISTS idx_seller_optional_uploads_document_list_id
  ON seller_optional_uploads(document_list_id);

CREATE INDEX IF NOT EXISTS idx_seller_optional_uploads_created_at
  ON seller_optional_uploads(created_at DESC);
