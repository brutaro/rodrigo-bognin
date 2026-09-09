-- Contexto usa o mesmo expurgo com recuperação e contador do cofre.
ALTER TABLE file_operation_event DROP CONSTRAINT file_operation_event_check;
ALTER TABLE file_operation_event ADD CONSTRAINT file_operation_event_check
 CHECK(project_id IS NOT NULL OR operation IN ('backup_prepared','download','upload_version','purge'));

CREATE OR REPLACE FUNCTION complete_file_purge(p_document_id uuid)
RETURNS TABLE (removed_versions integer, removed_publications integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_project text;
  target_kind text;
  first_publication integer;
  total_bytes bigint;
  target_objects uuid[];
BEGIN
  SELECT project_id, document_kind INTO target_project, target_kind FROM public.file_document
    WHERE id = p_document_id AND status = 'purging' FOR UPDATE;
  IF NOT FOUND OR target_kind NOT IN ('project','context') THEN RAISE EXCEPTION 'purging document not found'; END IF;
  IF target_kind = 'context' AND (
    target_project IS NOT NULL OR
    EXISTS (SELECT 1 FROM public.source_file WHERE document_id=p_document_id) OR
    EXISTS (SELECT 1 FROM public.file_version WHERE document_id=p_document_id AND evidence_asset_id IS NOT NULL) OR
    EXISTS (SELECT 1 FROM public.publication_file pf JOIN public.file_version fv ON fv.id=pf.file_version_id WHERE fv.document_id=p_document_id) OR
    EXISTS (SELECT 1 FROM public.financial_entry_proof fp JOIN public.file_version fv ON fv.id=fp.file_version_id WHERE fv.document_id=p_document_id) OR
    EXISTS (SELECT 1 FROM public.publication p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.snapshot->'files')='array' THEN p.snapshot->'files' ELSE '[]'::jsonb END) item
      JOIN public.file_version fv ON fv.id::text=item->>'versionId' WHERE fv.document_id=p_document_id)
  ) THEN RAISE EXCEPTION 'context file has protected references'; END IF;
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

-- The trigger runs on two tables; only documents have document_kind.
CREATE OR REPLACE FUNCTION prevent_source_parent_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='file_document' THEN
  IF OLD.document_kind='source' THEN RAISE EXCEPTION 'source file parents are immutable'; END IF;
 ELSIF TG_TABLE_NAME='file_version' THEN
  IF EXISTS(SELECT 1 FROM source_file WHERE file_version_id=OLD.id) THEN
   RAISE EXCEPTION 'source file parents are immutable';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION prevent_source_parent_mutation() FROM PUBLIC;
