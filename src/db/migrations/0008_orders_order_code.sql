ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code_unique
ON orders(order_code)
WHERE order_code IS NOT NULL;
