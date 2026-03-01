ALTER TABLE users
ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_latitude_range_check'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_latitude_range_check CHECK (latitude BETWEEN -90 AND 90);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_longitude_range_check'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_longitude_range_check CHECK (longitude BETWEEN -180 AND 180);
  END IF;
END $$;
