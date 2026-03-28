-- v1 menu items for single-food single-lot publishing
-- keeps existing lot schema unchanged; extends foods metadata only.

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS menu_items_json jsonb;

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS secondary_category_ids_json jsonb;

UPDATE foods
SET menu_items_json = '[]'::jsonb
WHERE menu_items_json IS NULL;

UPDATE foods
SET secondary_category_ids_json = '[]'::jsonb
WHERE secondary_category_ids_json IS NULL;
