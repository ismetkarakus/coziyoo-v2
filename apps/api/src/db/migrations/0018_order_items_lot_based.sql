ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS lot_id UUID;

ALTER TABLE order_items
DROP CONSTRAINT IF EXISTS order_items_food_id_fkey;

ALTER TABLE order_items
DROP CONSTRAINT IF EXISTS order_items_order_id_food_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_lot_id_fkey'
  ) THEN
    ALTER TABLE order_items
    ADD CONSTRAINT order_items_lot_id_fkey
    FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_order_id_lot_id_key'
  ) THEN
    ALTER TABLE order_items
    ADD CONSTRAINT order_items_order_id_lot_id_key UNIQUE (order_id, lot_id);
  END IF;
END
$$;
