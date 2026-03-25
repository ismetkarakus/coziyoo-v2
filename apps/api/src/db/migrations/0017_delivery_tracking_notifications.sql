CREATE TABLE IF NOT EXISTS public.user_device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    app_version text,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_device_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
    CONSTRAINT user_device_tokens_token_key UNIQUE (token),
    CONSTRAINT user_device_tokens_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_user_device_tokens_user_active
    ON public.user_device_tokens USING btree (user_id, is_active, last_seen_at DESC);

ALTER TABLE IF EXISTS ONLY public.user_device_tokens
    ADD CONSTRAINT user_device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.order_delivery_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_user_id uuid NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    accuracy_m integer,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_delivery_tracking_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_tracking_order_captured
    ON public.order_delivery_tracking USING btree (order_id, captured_at DESC);

ALTER TABLE IF EXISTS ONLY public.order_delivery_tracking
    ADD CONSTRAINT order_delivery_tracking_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS ONLY public.order_delivery_tracking
    ADD CONSTRAINT order_delivery_tracking_seller_user_id_fkey FOREIGN KEY (seller_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.order_notification_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    milestone_type text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_notification_milestones_type_check CHECK (
      milestone_type = ANY (
        ARRAY[
          'order_received'::text,
          'order_preparing'::text,
          'order_in_delivery'::text,
          'eta_10m'::text,
          'eta_5m'::text,
          'eta_2m'::text,
          'at_door'::text,
          'profile_long'::text
        ]
      )
    ),
    CONSTRAINT order_notification_milestones_order_type_key UNIQUE (order_id, milestone_type),
    CONSTRAINT order_notification_milestones_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_order_notification_milestones_order
    ON public.order_notification_milestones USING btree (order_id, sent_at DESC);

ALTER TABLE IF EXISTS ONLY public.order_notification_milestones
    ADD CONSTRAINT order_notification_milestones_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
