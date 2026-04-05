ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS delivery_terms text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS requested_delivery_type text,
  ADD COLUMN IF NOT EXISTS active_delivery_type text,
  ADD COLUMN IF NOT EXISTS seller_decision_state text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS seller_eta_minutes integer,
  ADD COLUMN IF NOT EXISTS seller_promised_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS seller_delivery_note text,
  ADD COLUMN IF NOT EXISTS seller_delivery_terms_snapshot text,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payment_captured_at timestamp with time zone;

UPDATE public.orders
SET requested_delivery_type = COALESCE(requested_delivery_type, delivery_type),
    active_delivery_type = COALESCE(active_delivery_type, delivery_type)
WHERE requested_delivery_type IS NULL
   OR active_delivery_type IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN requested_delivery_type SET NOT NULL,
  ALTER COLUMN active_delivery_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND constraint_name = 'orders_requested_delivery_type_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_requested_delivery_type_check
      CHECK (requested_delivery_type IN ('pickup', 'delivery'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND constraint_name = 'orders_active_delivery_type_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_active_delivery_type_check
      CHECK (active_delivery_type IN ('pickup', 'delivery'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND constraint_name = 'orders_seller_decision_state_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_seller_decision_state_check
      CHECK (seller_decision_state IN ('pending', 'revised', 'approved', 'rejected'));
  END IF;
END $$;
