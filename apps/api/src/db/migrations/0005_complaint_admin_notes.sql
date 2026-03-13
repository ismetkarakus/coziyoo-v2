CREATE TABLE IF NOT EXISTS public.complaint_admin_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_id uuid NOT NULL,
    note text NOT NULL,
    created_by_admin_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT complaint_admin_notes_pkey PRIMARY KEY (id),
    CONSTRAINT complaint_admin_notes_note_check CHECK (length(trim(note)) > 0),
    CONSTRAINT complaint_admin_notes_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE,
    CONSTRAINT complaint_admin_notes_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_complaint_admin_notes_complaint_created_at
    ON public.complaint_admin_notes USING btree (complaint_id, created_at DESC);
