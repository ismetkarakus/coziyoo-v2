-- Add sequential human-readable order number to orders table
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1001;

ALTER TABLE public.orders
  ADD COLUMN order_number text;

-- Backfill existing orders with generated numbers
UPDATE public.orders
SET order_number = 'CZY-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' || LPAD(nextval('order_number_seq')::text, 4, '0')
WHERE order_number IS NULL;

-- Make it NOT NULL with a default for future orders
ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT 'CZY-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('order_number_seq')::text, 4, '0');

ALTER TABLE public.orders
  ALTER COLUMN order_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders (order_number);
