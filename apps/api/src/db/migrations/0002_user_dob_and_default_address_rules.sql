ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dob date;

CREATE OR REPLACE FUNCTION ensure_user_default_address_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE user_addresses
       SET is_default = FALSE,
           updated_at = now()
     WHERE user_id = NEW.user_id
       AND id IS DISTINCT FROM NEW.id
       AND is_default = TRUE;
  ELSE
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1
          FROM user_addresses
         WHERE user_id = NEW.user_id
           AND is_default = TRUE
      ) THEN
        NEW.is_default := TRUE;
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
          FROM user_addresses
         WHERE user_id = NEW.user_id
           AND is_default = TRUE
           AND id <> NEW.id
      ) THEN
        NEW.is_default := TRUE;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_user_has_default_address(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM user_addresses WHERE user_id = p_user_id)
     AND NOT EXISTS (SELECT 1 FROM user_addresses WHERE user_id = p_user_id AND is_default = TRUE) THEN
    UPDATE user_addresses
       SET is_default = TRUE,
           updated_at = now()
     WHERE id = (
       SELECT id
         FROM user_addresses
        WHERE user_id = p_user_id
        ORDER BY created_at ASC, id ASC
        LIMIT 1
     );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_user_default_address_after_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM ensure_user_has_default_address(OLD.user_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM ensure_user_has_default_address(OLD.user_id);
      PERFORM ensure_user_has_default_address(NEW.user_id);
    ELSIF OLD.is_default = TRUE AND NEW.is_default = FALSE THEN
      PERFORM ensure_user_has_default_address(NEW.user_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_addresses_default_before_write ON user_addresses;
CREATE TRIGGER trg_user_addresses_default_before_write
BEFORE INSERT OR UPDATE OF user_id, is_default ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION ensure_user_default_address_before_write();

DROP TRIGGER IF EXISTS trg_user_addresses_default_after_write ON user_addresses;
CREATE TRIGGER trg_user_addresses_default_after_write
AFTER UPDATE OF user_id, is_default OR DELETE ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION ensure_user_default_address_after_write();

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn,
    bool_or(is_default) OVER (PARTITION BY user_id) AS has_default
  FROM user_addresses
)
UPDATE user_addresses ua
   SET is_default = TRUE,
       updated_at = now()
  FROM ranked r
 WHERE ua.id = r.id
   AND r.rn = 1
   AND r.has_default = FALSE;
