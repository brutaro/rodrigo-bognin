-- Prévia privada e versões integrais da base: a confirmação troca a referência,
-- sem sobrescrever originais, medições legadas, ajustes ou publicações.
CREATE TABLE resource_import (
  id uuid PRIMARY KEY,
  source_file_id uuid NOT NULL REFERENCES source_file(id),
  content_hash char(64) NOT NULL,
  sheet_name text NOT NULL,
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  errors jsonb NOT NULL CHECK (jsonb_typeof(errors) = 'array'),
  base_id uuid REFERENCES resource_import(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  CHECK (applied_at IS NULL OR jsonb_array_length(errors) = 0)
);
CREATE TABLE resource_import_current (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  import_id uuid NOT NULL REFERENCES resource_import(id)
);
GRANT SELECT, INSERT ON resource_import TO tria_app;
GRANT UPDATE (applied_at) ON resource_import TO tria_app;
GRANT SELECT, INSERT, UPDATE ON resource_import_current TO tria_app;
CREATE FUNCTION protect_resource_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD.applied_at IS NOT NULL OR
    (to_jsonb(NEW) - 'applied_at') IS DISTINCT FROM (to_jsonb(OLD) - 'applied_at') THEN
   RAISE EXCEPTION 'importações preservam sua prévia e conteúdo';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resource_import_immutable BEFORE UPDATE OR DELETE ON resource_import FOR EACH ROW EXECUTE FUNCTION protect_resource_import();
