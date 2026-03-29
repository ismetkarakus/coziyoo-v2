ALTER TABLE IF EXISTS public.order_notification_milestones
  DROP CONSTRAINT IF EXISTS order_notification_milestones_type_check;

ALTER TABLE IF EXISTS public.order_notification_milestones
  ADD CONSTRAINT order_notification_milestones_type_check CHECK (
    milestone_type = ANY (
      ARRAY[
        'order_received'::text,
        'order_preparing'::text,
        'order_in_delivery'::text,
        'order_halfway'::text,
        'eta_10m'::text,
        'eta_5m'::text,
        'eta_2m'::text,
        'at_door'::text,
        'profile_long'::text
      ]
    )
  );
