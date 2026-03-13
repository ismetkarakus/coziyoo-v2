ALTER TABLE seller_compliance_documents
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT FALSE;

ALTER TABLE seller_optional_uploads
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT FALSE;

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
