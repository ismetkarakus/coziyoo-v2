ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS kitchen_title text,
  ADD COLUMN IF NOT EXISTS kitchen_description text,
  ADD COLUMN IF NOT EXISTS delivery_radius_km numeric(8,2),
  ADD COLUMN IF NOT EXISTS working_hours_json jsonb,
  ADD COLUMN IF NOT EXISTS seller_profile_status text DEFAULT 'incomplete' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'users'
      AND constraint_name = 'users_seller_profile_status_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_seller_profile_status_check
      CHECK (seller_profile_status IN ('incomplete', 'pending_review', 'active'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_seller_profile_status
  ON public.users (seller_profile_status)
  WHERE user_type IN ('seller', 'both');
