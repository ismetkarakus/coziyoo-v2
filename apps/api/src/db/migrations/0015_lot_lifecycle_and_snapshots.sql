ALTER TABLE production_lots
ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS recipe_snapshot TEXT,
ADD COLUMN IF NOT EXISTS ingredients_snapshot_json JSONB,
ADD COLUMN IF NOT EXISTS allergens_snapshot_json JSONB;

UPDATE production_lots
SET sale_starts_at = COALESCE(sale_starts_at, NOW()),
    sale_ends_at = COALESCE(sale_ends_at, use_by, best_before, NOW() + INTERVAL '7 days')
WHERE sale_starts_at IS NULL
   OR sale_ends_at IS NULL;

ALTER TABLE production_lots
ALTER COLUMN sale_starts_at SET NOT NULL,
ALTER COLUMN sale_ends_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_lots_sale_window_check'
  ) THEN
    ALTER TABLE production_lots
    ADD CONSTRAINT production_lots_sale_window_check
    CHECK (sale_starts_at <= sale_ends_at);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_lots_produced_before_sale_start_check'
  ) THEN
    ALTER TABLE production_lots
    ADD CONSTRAINT production_lots_produced_before_sale_start_check
    CHECK (produced_at <= sale_starts_at);
  END IF;
END
$$;

ALTER TABLE production_lots
DROP CONSTRAINT IF EXISTS production_lots_status_check;

ALTER TABLE production_lots
ADD CONSTRAINT production_lots_status_check
CHECK (status IN ('open', 'locked', 'depleted', 'recalled', 'discarded', 'expired'));
