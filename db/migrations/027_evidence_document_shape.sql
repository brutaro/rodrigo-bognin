-- Enforce the cross-table owner shape at transaction commit.
CREATE OR REPLACE FUNCTION assert_file_document_version_shape(target_document_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE kind text; evidence_versions integer; total_versions integer;
BEGIN
  SELECT document_kind INTO kind FROM file_document WHERE id = target_document_id;
  IF kind IS NULL THEN RETURN; END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE evidence_asset_id IS NOT NULL)::int
    INTO total_versions, evidence_versions FROM file_version WHERE document_id = target_document_id;
  IF kind = 'project' AND evidence_versions <> 0 THEN RAISE EXCEPTION 'project document cannot own canonical evidence'; END IF;
  IF kind = 'evidence' AND (total_versions <> 1 OR evidence_versions <> 1) THEN
    RAISE EXCEPTION 'evidence document must own exactly one canonical evidence version';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION enforce_file_document_shape_from_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM assert_file_document_version_shape(OLD.id);
  ELSE PERFORM assert_file_document_version_shape(NEW.id); END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION enforce_file_document_shape_from_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM assert_file_document_version_shape(NEW.document_id); END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.document_id <> NEW.document_id) THEN
    PERFORM assert_file_document_version_shape(OLD.document_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER file_document_version_shape_document AFTER INSERT OR UPDATE ON file_document
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_file_document_shape_from_document();
CREATE CONSTRAINT TRIGGER file_document_version_shape_version AFTER INSERT OR UPDATE OR DELETE ON file_version
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_file_document_shape_from_version();
REVOKE ALL ON FUNCTION assert_file_document_version_shape(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_file_document_shape_from_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_file_document_shape_from_version() FROM PUBLIC;
