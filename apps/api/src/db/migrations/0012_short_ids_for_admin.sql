ALTER TABLE users
ADD COLUMN IF NOT EXISTS short_id TEXT;

ALTER TABLE foods
ADD COLUMN IF NOT EXISTS short_id TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS short_id TEXT;

UPDATE users
SET short_id = substr(encode(gen_random_bytes(8), 'hex'), 1, 12)
WHERE short_id IS NULL OR short_id = '';

UPDATE foods
SET short_id = substr(encode(gen_random_bytes(8), 'hex'), 1, 12)
WHERE short_id IS NULL OR short_id = '';

UPDATE orders
SET short_id = substr(encode(gen_random_bytes(8), 'hex'), 1, 12)
WHERE short_id IS NULL OR short_id = '';

ALTER TABLE users
ALTER COLUMN short_id SET DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12);

ALTER TABLE foods
ALTER COLUMN short_id SET DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12);

ALTER TABLE orders
ALTER COLUMN short_id SET DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12);

ALTER TABLE users
ALTER COLUMN short_id SET NOT NULL;

ALTER TABLE foods
ALTER COLUMN short_id SET NOT NULL;

ALTER TABLE orders
ALTER COLUMN short_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_short_id_unique'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_short_id_unique UNIQUE (short_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'foods_short_id_unique'
  ) THEN
    ALTER TABLE foods
      ADD CONSTRAINT foods_short_id_unique UNIQUE (short_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_short_id_unique'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_short_id_unique UNIQUE (short_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_short_id ON users(short_id);
CREATE INDEX IF NOT EXISTS idx_foods_short_id ON foods(short_id);
CREATE INDEX IF NOT EXISTS idx_orders_short_id ON orders(short_id);
