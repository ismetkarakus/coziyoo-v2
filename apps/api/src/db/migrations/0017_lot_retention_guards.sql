DO $$
DECLARE
  fk_name text;
BEGIN
  FOR fk_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'production_lots'
      AND att.attname = 'food_id'
  LOOP
    EXECUTE format('ALTER TABLE production_lots DROP CONSTRAINT IF EXISTS %I', fk_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION prevent_production_lot_mutating_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'production_lots records are immutable and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_production_lot_delete ON production_lots;
CREATE TRIGGER trg_prevent_production_lot_delete
BEFORE DELETE ON production_lots
FOR EACH ROW
EXECUTE FUNCTION prevent_production_lot_mutating_delete();

DROP TRIGGER IF EXISTS trg_prevent_production_lot_truncate ON production_lots;
CREATE TRIGGER trg_prevent_production_lot_truncate
BEFORE TRUNCATE ON production_lots
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_production_lot_mutating_delete();
