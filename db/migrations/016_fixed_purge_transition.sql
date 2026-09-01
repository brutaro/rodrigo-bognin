-- Limita o papel runtime a uma transição fixa para concluir expurgos já marcados.
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
BEGIN
  SELECT project_id INTO target_project FROM public.file_document
    WHERE id = p_document_id AND status = 'purging' FOR UPDATE;
  IF target_project IS NULL THEN RAISE EXCEPTION 'purging document not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.file_version WHERE document_id = p_document_id AND status <> 'purging') THEN
    RAISE EXCEPTION 'document versions are not all purging';
  END IF;
  SELECT count(*)::integer, coalesce(sum(size_bytes), 0)::bigint INTO removed_versions, total_bytes
    FROM public.file_version WHERE document_id = p_document_id;
  SELECT min(p.version)::integer INTO first_publication
    FROM public.publication p JOIN public.publication_file pf ON pf.publication_id = p.id
    JOIN public.file_version fv ON fv.id = pf.file_version_id
    WHERE fv.document_id = p_document_id;
  removed_publications := 0;
  IF first_publication IS NOT NULL THEN
    PERFORM set_config('tria.purge_authorized', 'on', true);
    WITH removed AS (
      DELETE FROM public.publication WHERE project_id = target_project AND version >= first_publication RETURNING id
    ) SELECT count(*)::integer INTO removed_publications FROM removed;
  END IF;
  DELETE FROM public.file_document WHERE id = p_document_id;
  UPDATE public.file_store_counter SET used_bytes = used_bytes - total_bytes WHERE singleton;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION complete_file_purge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_file_purge(uuid) TO tria_app;
REVOKE DELETE ON publication, file_document, file_version, publication_file FROM tria_app;
