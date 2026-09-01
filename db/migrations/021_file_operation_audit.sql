-- Trilha genérica e imutável, sem nome, hash, object key ou identificador do arquivo.
CREATE TABLE file_operation_event (
  id uuid PRIMARY KEY,
  project_id text REFERENCES project(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('upload_version', 'publication_include', 'publication_exclude', 'download', 'backup_prepared', 'purge')),
  byte_count bigint NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  version_count integer NOT NULL DEFAULT 0 CHECK (version_count >= 0),
  publication_count integer NOT NULL DEFAULT 0 CHECK (publication_count >= 0),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  occurred_at timestamptz NOT NULL,
  CHECK (project_id IS NOT NULL OR operation = 'backup_prepared')
);
CREATE INDEX file_operation_event_project_idx ON file_operation_event(project_id, occurred_at, id);

CREATE OR REPLACE FUNCTION prevent_file_operation_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'tria_admin' AND current_setting('tria.validation_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'file operation events are append-only';
END;
$$;
CREATE TRIGGER file_operation_event_immutable
BEFORE UPDATE OR DELETE ON file_operation_event
FOR EACH ROW EXECUTE FUNCTION prevent_file_operation_event_mutation();

GRANT SELECT, INSERT ON file_operation_event TO tria_app;
REVOKE UPDATE, DELETE, TRUNCATE ON file_operation_event FROM tria_app;

CREATE OR REPLACE FUNCTION complete_file_purge(p_document_id uuid)
RETURNS TABLE (removed_versions integer, removed_publications integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_project text;
  first_publication integer;
  total_bytes bigint;
  target_objects uuid[];
BEGIN
  SELECT project_id INTO target_project FROM public.file_document
    WHERE id = p_document_id AND status = 'purging' FOR UPDATE;
  IF target_project IS NULL THEN RAISE EXCEPTION 'purging document not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.file_version WHERE document_id = p_document_id AND status <> 'purging') THEN
    RAISE EXCEPTION 'document versions are not all purging';
  END IF;
  SELECT count(*)::integer, coalesce(sum(size_bytes), 0)::bigint, coalesce(array_agg(object_key), ARRAY[]::uuid[])
    INTO removed_versions, total_bytes, target_objects
    FROM public.file_version WHERE document_id = p_document_id;
  SELECT min(p.version)::integer INTO first_publication
    FROM public.publication p
    WHERE p.project_id = target_project AND (
      EXISTS (
        SELECT 1 FROM public.publication_file pf JOIN public.file_version fv ON fv.id = pf.file_version_id
        WHERE pf.publication_id = p.id AND fv.document_id = p_document_id
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.snapshot->'files') = 'array' THEN p.snapshot->'files' ELSE '[]'::jsonb END) item
        JOIN public.file_version fv ON fv.id::text = item->>'versionId'
        WHERE fv.document_id = p_document_id
      )
    );
  removed_publications := 0;
  IF first_publication IS NOT NULL THEN
    PERFORM set_config('tria.purge_authorized', 'on', true);
    WITH removed AS (
      DELETE FROM public.publication WHERE project_id = target_project AND version >= first_publication RETURNING id
    ) SELECT count(*)::integer INTO removed_publications FROM removed;
  END IF;
  DELETE FROM public.file_reservation WHERE object_key = ANY(target_objects);
  DELETE FROM public.file_document WHERE id = p_document_id;
  UPDATE public.file_store_counter SET used_bytes = used_bytes - total_bytes WHERE singleton;
  INSERT INTO public.file_operation_event
    (id, project_id, operation, byte_count, version_count, publication_count, actor, occurred_at)
    VALUES (gen_random_uuid(), target_project, 'purge', total_bytes, removed_versions, removed_publications, 'Rodrigo', now());
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION complete_file_purge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_file_purge(uuid) TO tria_app;
