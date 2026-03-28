-- Guard migration: safely ensures all food and seller profile columns exist.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Required because the migration bootstrap may have marked earlier migrations
-- as applied without actually executing them on legacy databases.

-- Foods: cuisine (added in 0013)
ALTER TABLE foods ADD COLUMN IF NOT EXISTS cuisine TEXT;

-- Foods: image_urls_json (added in 0014)
ALTER TABLE foods ADD COLUMN IF NOT EXISTS image_urls_json jsonb;

-- Backfill image_urls_json from image_url for any rows where it is still NULL
UPDATE foods
SET image_urls_json = CASE
  WHEN image_url IS NOT NULL AND btrim(image_url) <> '' THEN jsonb_build_array(image_url)
  ELSE '[]'::jsonb
END
WHERE image_urls_json IS NULL;

-- Foods: delivery_fee (in initial schema but guard anyway)
ALTER TABLE foods ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2) DEFAULT 0;

-- Foods: delivery_options_json (in initial schema but guard anyway)
ALTER TABLE foods ADD COLUMN IF NOT EXISTS delivery_options_json jsonb;

-- Users: seller profile fields (added in 0018)
ALTER TABLE users ADD COLUMN IF NOT EXISTS kitchen_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kitchen_description text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_radius_km numeric(8,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS working_hours_json jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_profile_status text DEFAULT 'incomplete' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'users'
      AND constraint_name = 'users_seller_profile_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_seller_profile_status_check
      CHECK (seller_profile_status IN ('incomplete', 'pending_review', 'active'));
  END IF;
END $$;

-- Users: kitchen_specialties (added in 0019)
ALTER TABLE users ADD COLUMN IF NOT EXISTS kitchen_specialties jsonb DEFAULT '[]'::jsonb;

-- Users: username (added in 0020)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON users (username)
  WHERE username IS NOT NULL;
