ALTER TABLE compliance_documents_list
ADD COLUMN IF NOT EXISTS is_required_default BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE compliance_documents_list
SET is_required_default = TRUE
WHERE is_required_default IS NULL;

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
