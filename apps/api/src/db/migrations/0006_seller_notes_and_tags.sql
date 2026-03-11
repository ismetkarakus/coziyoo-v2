-- seller_notes and seller_tags tables (mirrors buyer_notes/buyer_tags for sellers)

CREATE TABLE public.seller_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.seller_notes
    ADD CONSTRAINT seller_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.seller_notes
    ADD CONSTRAINT seller_notes_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.seller_notes
    ADD CONSTRAINT seller_notes_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;

CREATE INDEX idx_seller_notes_seller_created ON public.seller_notes USING btree (seller_id, created_at DESC);


CREATE TABLE public.seller_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    tag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.seller_tags
    ADD CONSTRAINT seller_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.seller_tags
    ADD CONSTRAINT seller_tags_seller_id_tag_key UNIQUE (seller_id, tag);

ALTER TABLE ONLY public.seller_tags
    ADD CONSTRAINT seller_tags_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX idx_seller_tags_seller ON public.seller_tags USING btree (seller_id);
