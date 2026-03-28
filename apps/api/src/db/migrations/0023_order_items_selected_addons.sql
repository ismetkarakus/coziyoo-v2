ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS selected_addons_json jsonb;

UPDATE order_items
SET selected_addons_json = '{"free":[],"paid":[]}'::jsonb
WHERE selected_addons_json IS NULL;
