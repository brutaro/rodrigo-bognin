-- Fonte consolidada opaca, isolada de projetos, evidências e publicações.
ALTER TABLE file_document DROP CONSTRAINT file_document_document_kind_check;
ALTER TABLE file_document ADD CONSTRAINT file_document_document_kind_check
  CHECK (document_kind IN ('project', 'evidence', 'source'));
ALTER TABLE file_document DROP CONSTRAINT file_document_owner_shape;
ALTER TABLE file_document ADD CONSTRAINT file_document_owner_shape CHECK (
  (document_kind = 'project' AND project_id IS NOT NULL) OR
  (document_kind IN ('evidence', 'source') AND project_id IS NULL AND include_in_publication = false)
);
ALTER TABLE file_document ADD CONSTRAINT file_document_source_title CHECK (
  document_kind <> 'source' OR title = 'Base consolidada de aplicação de recursos'
);

CREATE TABLE source_file (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL UNIQUE REFERENCES file_document(id) ON DELETE RESTRICT,
  file_version_id uuid NOT NULL UNIQUE REFERENCES file_version(id) ON DELETE RESTRICT,
  source_format text NOT NULL CHECK (source_format IN ('xls', 'xlsx', 'csv')),
  received_by text NOT NULL CHECK (received_by = 'Rodrigo'),
  received_at timestamptz NOT NULL
);

CREATE TABLE source_file_event (
  id uuid PRIMARY KEY,
  source_file_id uuid NOT NULL REFERENCES source_file(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation = 'source.file.received.v1'),
  byte_count bigint NOT NULL CHECK (byte_count > 0 AND byte_count <= 52428800),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  occurred_at timestamptz NOT NULL
);
ALTER TABLE source_file_event ADD CONSTRAINT source_file_event_single_receipt UNIQUE (source_file_id);
CREATE INDEX source_file_event_source_idx ON source_file_event(source_file_id, occurred_at, id);

CREATE OR REPLACE FUNCTION assert_file_document_version_shape(target_document_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  kind text;
  evidence_versions integer;
  total_versions integer;
  source_links integer;
  matching_source_links integer;
  receipt_events integer;
  source_consistent boolean;
BEGIN
  SELECT document_kind INTO kind FROM file_document WHERE id = target_document_id;
  IF kind IS NULL THEN RETURN; END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE evidence_asset_id IS NOT NULL)::int
    INTO total_versions, evidence_versions FROM file_version WHERE document_id = target_document_id;
  SELECT count(*)::int INTO source_links FROM source_file WHERE document_id = target_document_id;
  SELECT count(*)::int INTO matching_source_links FROM source_file sf
    JOIN file_version fv ON fv.id = sf.file_version_id AND fv.document_id = sf.document_id
    WHERE sf.document_id = target_document_id;
  IF kind = 'project' AND (evidence_versions <> 0 OR source_links <> 0) THEN
    RAISE EXCEPTION 'project document cannot own canonical evidence or source';
  END IF;
  IF kind = 'evidence' AND (total_versions <> 1 OR evidence_versions <> 1 OR source_links <> 0) THEN
    RAISE EXCEPTION 'evidence document must own exactly one canonical evidence version';
  END IF;
  IF kind = 'source' THEN
    SELECT count(*)::int,
      coalesce(bool_and(
        fv.version = 1 AND fv.status = 'active' AND d.status = 'active' AND
        sf.source_format = lower(substring(fv.original_name FROM '\.([^.]+)$')) AND
        sf.received_at = fv.created_at AND sf.received_at = d.created_at AND d.created_at = d.updated_at
      ), false)
      INTO matching_source_links, source_consistent
      FROM source_file sf
      JOIN file_version fv ON fv.id = sf.file_version_id AND fv.document_id = sf.document_id
      JOIN file_document d ON d.id = sf.document_id
      WHERE sf.document_id = target_document_id;
    SELECT count(*)::int INTO receipt_events
      FROM source_file_event e
      JOIN source_file sf ON sf.id = e.source_file_id
      JOIN file_version fv ON fv.id = sf.file_version_id
      WHERE sf.document_id = target_document_id AND e.byte_count = fv.size_bytes AND
        e.actor = sf.received_by AND e.occurred_at = sf.received_at;
  END IF;
  IF kind = 'source' AND (total_versions <> 1 OR evidence_versions <> 0 OR source_links <> 1 OR
      matching_source_links <> 1 OR receipt_events <> 1 OR NOT source_consistent) THEN
    RAISE EXCEPTION 'source document must own exactly one isolated source version';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_file_document_shape_from_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM assert_file_document_version_shape(NEW.document_id); END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.document_id <> NEW.document_id) THEN
    PERFORM assert_file_document_version_shape(OLD.document_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER file_document_version_shape_source
AFTER INSERT OR UPDATE OR DELETE ON source_file
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_file_document_shape_from_source();
REVOKE ALL ON FUNCTION enforce_file_document_shape_from_source() FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_source_file_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'source files are append-only';
END;
$$;
CREATE TRIGGER source_file_immutable BEFORE UPDATE OR DELETE ON source_file
FOR EACH ROW EXECUTE FUNCTION prevent_source_file_mutation();
CREATE TRIGGER source_file_event_immutable BEFORE UPDATE OR DELETE ON source_file_event
FOR EACH ROW EXECUTE FUNCTION prevent_source_file_mutation();
REVOKE ALL ON FUNCTION prevent_source_file_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_source_parent_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF (TG_TABLE_NAME = 'file_document' AND OLD.document_kind = 'source') OR
      (TG_TABLE_NAME = 'file_version' AND EXISTS (
        SELECT 1 FROM source_file sf WHERE sf.file_version_id = OLD.id
      )) THEN
    RAISE EXCEPTION 'source file parents are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_file_document_immutable BEFORE UPDATE OR DELETE ON file_document
FOR EACH ROW EXECUTE FUNCTION prevent_source_parent_mutation();
CREATE TRIGGER source_file_version_immutable BEFORE UPDATE OR DELETE ON file_version
FOR EACH ROW EXECUTE FUNCTION prevent_source_parent_mutation();
REVOKE ALL ON FUNCTION prevent_source_parent_mutation() FROM PUBLIC;

REVOKE INSERT ON file_document FROM tria_app;
GRANT INSERT (id, project_id, title, status, created_at, updated_at, include_in_publication, document_kind)
  ON file_document TO tria_app;
REVOKE ALL PRIVILEGES ON source_file, source_file_event FROM PUBLIC, tria_app;
GRANT SELECT, INSERT ON source_file, source_file_event TO tria_app;
REVOKE UPDATE, DELETE, TRUNCATE ON source_file, source_file_event FROM tria_app;
