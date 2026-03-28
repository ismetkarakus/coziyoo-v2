ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'complaints_ticket_no_seq'
      AND relkind = 'S'
  ) THEN
    CREATE SEQUENCE public.complaints_ticket_no_seq START 1000;
  END IF;
END $$;

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS ticket_no integer;

ALTER TABLE public.complaints
  ALTER COLUMN ticket_no SET DEFAULT nextval('public.complaints_ticket_no_seq');

UPDATE public.complaints
SET ticket_no = COALESCE(ticket_no, nextval('public.complaints_ticket_no_seq'))
WHERE ticket_no IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complaints_ticket_no_unique'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_ticket_no_unique UNIQUE (ticket_no);
  END IF;
END $$;

ALTER TABLE public.complaints
  ALTER COLUMN ticket_no SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  complaint_id uuid NOT NULL,
  sender_user_id uuid,
  sender_role text NOT NULL,
  sender_name text,
  message text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT ticket_messages_pkey PRIMARY KEY (id),
  CONSTRAINT ticket_messages_complaint_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE,
  CONSTRAINT ticket_messages_sender_role_check CHECK (sender_role = ANY (ARRAY['buyer'::text, 'admin'::text])),
  CONSTRAINT ticket_messages_message_check CHECK (length(trim(message)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_complaint_created
  ON public.ticket_messages USING btree (complaint_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_complaints_ticket_no
  ON public.complaints USING btree (ticket_no);
