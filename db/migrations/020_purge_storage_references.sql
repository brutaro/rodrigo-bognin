-- O expurgo também remove a referência interna de reserva ao objeto físico.
DELETE FROM file_reservation r
WHERE r.status <> 'reserved' AND r.object_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM file_version v WHERE v.object_key = r.object_key);

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
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION complete_file_purge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_file_purge(uuid) TO tria_app;
