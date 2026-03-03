CREATE TABLE IF NOT EXISTS complaint_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES complaint_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complaints_priority_check'
  ) THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_priority_check
      CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_complaint_categories_is_active
  ON complaint_categories(is_active);

CREATE INDEX IF NOT EXISTS idx_complaints_category
  ON complaints(category_id);

CREATE INDEX IF NOT EXISTS idx_complaints_priority
  ON complaints(priority);

CREATE INDEX IF NOT EXISTS idx_complaints_assigned_admin
  ON complaints(assigned_admin_id);
