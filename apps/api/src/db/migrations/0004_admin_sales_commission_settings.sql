CREATE TABLE IF NOT EXISTS public.admin_sales_commission_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    commission_rate_percent numeric(5,2) NOT NULL,
    created_by_admin_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_sales_commission_settings_pkey PRIMARY KEY (id),
    CONSTRAINT admin_sales_commission_settings_rate_check CHECK (((commission_rate_percent >= (0)::numeric) AND (commission_rate_percent <= (100)::numeric))),
    CONSTRAINT admin_sales_commission_settings_created_by_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_admin_sales_commission_settings_created_at
    ON public.admin_sales_commission_settings USING btree (created_at DESC);
