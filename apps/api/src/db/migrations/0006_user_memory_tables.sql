CREATE TABLE IF NOT EXISTS public.session_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id text NOT NULL,
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_memory_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_memory_room_id
    ON public.session_memory USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_session_memory_user_id
    ON public.session_memory USING btree (user_id);

CREATE TABLE IF NOT EXISTS public.long_term_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    dietary_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    personal_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    order_history_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    conversation_style jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT long_term_memory_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_long_term_memory_user_id
    ON public.long_term_memory USING btree (user_id);
