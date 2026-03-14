ALTER TABLE public.complaints
    ADD COLUMN IF NOT EXISTS complainant_type text,
    ADD COLUMN IF NOT EXISTS complainant_user_id uuid;

UPDATE public.complaints
SET complainant_type = 'buyer'
WHERE complainant_type IS NULL
  AND complainant_buyer_id IS NOT NULL;

UPDATE public.complaints
SET complainant_user_id = complainant_buyer_id
WHERE complainant_user_id IS NULL
  AND complainant_buyer_id IS NOT NULL;

ALTER TABLE public.complaints
    ALTER COLUMN complainant_buyer_id DROP NOT NULL,
    ALTER COLUMN complainant_type SET NOT NULL,
    ALTER COLUMN complainant_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complaints_complainant_type_check'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_complainant_type_check
      CHECK (complainant_type = ANY (ARRAY['buyer'::text, 'seller'::text]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complaints_complainant_user_id_fkey'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_complainant_user_id_fkey
      FOREIGN KEY (complainant_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_complaints_complainant_actor
    ON public.complaints USING btree (complainant_type, complainant_user_id);
