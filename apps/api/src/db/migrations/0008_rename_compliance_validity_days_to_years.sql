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
  DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_days_check;

ALTER TABLE compliance_documents_list
  DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_years_check;

ALTER TABLE compliance_documents_list
  ADD CONSTRAINT compliance_documents_list_validity_years_check
  CHECK (validity_years IS NULL OR validity_years > 0);
