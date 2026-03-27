ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS kitchen_specialties jsonb;
