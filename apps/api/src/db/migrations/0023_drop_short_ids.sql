DROP INDEX IF EXISTS idx_users_short_id;
DROP INDEX IF EXISTS idx_foods_short_id;
DROP INDEX IF EXISTS idx_orders_short_id;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_short_id_unique;
ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_short_id_unique;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_short_id_unique;

ALTER TABLE users DROP COLUMN IF EXISTS short_id;
ALTER TABLE foods DROP COLUMN IF EXISTS short_id;
ALTER TABLE orders DROP COLUMN IF EXISTS short_id;
