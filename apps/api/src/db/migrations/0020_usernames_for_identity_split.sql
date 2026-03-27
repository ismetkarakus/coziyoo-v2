ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS username_normalized text;

DO $$
DECLARE
  rec record;
  base text;
  candidate text;
  suffixes text[] := ARRAY['_', '.tr', '.x'];
  suffix text;
  n integer := 0;
BEGIN
  FOR rec IN
    SELECT id, email, display_name
    FROM users
    WHERE username IS NULL OR username_normalized IS NULL OR btrim(username) = '' OR btrim(username_normalized) = ''
    ORDER BY created_at ASC, id ASC
  LOOP
    base := lower(
      translate(
        coalesce(nullif(btrim(rec.display_name), ''), split_part(rec.email, '@', 1), 'kullanici'),
        'ÇĞİIÖŞÜçğıiöşü',
        'CGIIOSUcgiiosu'
      )
    );
    base := regexp_replace(base, '\s+', '.', 'g');
    base := regexp_replace(base, '[^a-z0-9._]', '', 'g');
    base := regexp_replace(base, '[._]{2,}', '.', 'g');
    base := regexp_replace(base, '^[._]+|[._]+$', '', 'g');
    base := left(base, 30);

    IF length(base) < 3 THEN
      base := lower(
        translate(
          coalesce(nullif(split_part(rec.email, '@', 1), ''), 'kullanici'),
          'ÇĞİIÖŞÜçğıiöşü',
          'CGIIOSUcgiiosu'
        )
      );
      base := regexp_replace(base, '\s+', '.', 'g');
      base := regexp_replace(base, '[^a-z0-9._]', '', 'g');
      base := regexp_replace(base, '[._]{2,}', '.', 'g');
      base := regexp_replace(base, '^[._]+|[._]+$', '', 'g');
      base := left(base, 30);
    END IF;

    IF length(base) < 3 THEN
      base := 'kullanici';
    END IF;

    candidate := base;
    IF EXISTS (SELECT 1 FROM users u WHERE u.id <> rec.id AND u.username_normalized = candidate) THEN
      FOREACH suffix IN ARRAY suffixes LOOP
        candidate := left(base, greatest(3, 30 - length(suffix))) || suffix;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users u WHERE u.id <> rec.id AND u.username_normalized = candidate);
      END LOOP;
    END IF;

    WHILE EXISTS (SELECT 1 FROM users u WHERE u.id <> rec.id AND u.username_normalized = candidate) LOOP
      n := n + 1;
      candidate := left(base, 28) || substr(md5(random()::text || n::text), 1, 2);
      IF n > 200 THEN
        candidate := left('kullanici', 24) || substr(md5(rec.id::text || random()::text), 1, 6);
      END IF;
      EXIT WHEN n > 1000;
    END LOOP;

    UPDATE users
    SET username = candidate,
        username_normalized = candidate,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL,
  ALTER COLUMN username_normalized SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_display_name_key,
  DROP CONSTRAINT IF EXISTS users_display_name_normalized_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_normalized_key'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_username_normalized_key UNIQUE (username_normalized);
  END IF;
END $$;
