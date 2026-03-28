ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS image_urls_json jsonb;

UPDATE foods
SET image_urls_json = CASE
  WHEN image_url IS NOT NULL AND btrim(image_url) <> '' THEN jsonb_build_array(image_url)
  ELSE '[]'::jsonb
END
WHERE image_urls_json IS NULL;

UPDATE foods
SET image_urls_json = '[]'::jsonb
WHERE image_urls_json IS NULL;
