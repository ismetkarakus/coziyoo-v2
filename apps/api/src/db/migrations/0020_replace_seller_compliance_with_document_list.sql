DROP TABLE IF EXISTS seller_compliance_events;
DROP TABLE IF EXISTS seller_compliance_checks;
DROP TABLE IF EXISTS seller_compliance_profile_documents;
DROP TABLE IF EXISTS seller_compliance_profiles;
DROP TABLE IF EXISTS seller_compliance_documents;

CREATE TABLE IF NOT EXISTS compliance_documents_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  source_info TEXT,
  details TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_required_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_list_id UUID NOT NULL REFERENCES compliance_documents_list(id) ON DELETE RESTRICT,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('requested', 'uploaded', 'approved', 'rejected')),
  file_url TEXT,
  uploaded_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, document_list_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_documents_list_active
  ON compliance_documents_list(is_active);

CREATE INDEX IF NOT EXISTS idx_seller_compliance_documents_seller
  ON seller_compliance_documents(seller_id);

CREATE INDEX IF NOT EXISTS idx_seller_compliance_documents_status
  ON seller_compliance_documents(status);

CREATE INDEX IF NOT EXISTS idx_seller_compliance_documents_list_id
  ON seller_compliance_documents(document_list_id);

CREATE OR REPLACE FUNCTION seed_seller_compliance_documents_on_user_upsert()
RETURNS trigger AS $$
BEGIN
  IF NEW.user_type IN ('seller', 'both') THEN
    INSERT INTO seller_compliance_documents (
      seller_id,
      document_list_id,
      is_required,
      status,
      created_at,
      updated_at
    )
    SELECT
      NEW.id,
      cdl.id,
      cdl.is_required_default,
      'requested',
      now(),
      now()
    FROM compliance_documents_list cdl
    WHERE cdl.is_active = TRUE
    ON CONFLICT (seller_id, document_list_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_seller_compliance_documents_on_users ON users;
CREATE TRIGGER trg_seed_seller_compliance_documents_on_users
AFTER INSERT OR UPDATE OF user_type ON users
FOR EACH ROW
EXECUTE FUNCTION seed_seller_compliance_documents_on_user_upsert();
