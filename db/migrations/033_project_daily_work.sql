-- Keep spreadsheet linkage stable when the owner changes a project title.
ALTER TABLE project ADD COLUMN resource_source_title text;
UPDATE project SET resource_source_title=title;
ALTER TABLE project ALTER COLUMN resource_source_title SET NOT NULL;
ALTER TABLE project ALTER COLUMN resource_source_title SET DEFAULT '';
ALTER TABLE project ADD COLUMN metadata_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE project ADD COLUMN archived_at timestamptz;
ALTER TABLE project ADD COLUMN last_opened_at timestamptz;
GRANT SELECT(resource_source_title,archived_at,last_opened_at,metadata_revision) ON project TO tria_app;
GRANT UPDATE(last_opened_at) ON project TO tria_app;
CREATE FUNCTION edit_owner_project(p_id text,p_title text,p_start date,p_end date,p_archived boolean,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous project%ROWTYPE;
BEGIN
 IF session_user <> 'tria_app' OR length(trim(p_title)) NOT BETWEEN 3 AND 200 OR p_start>p_end THEN RAISE EXCEPTION 'Dados do projeto inválidos'; END IF;
 PERFORM 1 FROM project WHERE id=p_id AND metadata_revision=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'O projeto mudou. Recarregue antes de editar.'; END IF;
 SELECT * INTO STRICT previous FROM project WHERE id=p_id FOR UPDATE;
 IF (previous.title,previous.date_start,previous.date_end,previous.archived_at IS NOT NULL) IS NOT DISTINCT FROM (trim(p_title),p_start,p_end,p_archived) THEN RETURN; END IF;
 UPDATE project SET title=trim(p_title),date_start=p_start,date_end=p_end,metadata_revision=metadata_revision+1,
   resource_source_title=CASE WHEN resource_source_title='' THEN previous.title ELSE resource_source_title END,
   archived_at=CASE WHEN p_archived THEN coalesce(archived_at,now()) END WHERE id=p_id;
 UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=p_id;
 INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at)
 VALUES(gen_random_uuid(),p_id,CASE WHEN p_archived AND previous.archived_at IS NULL THEN 'Projeto arquivado' WHEN NOT p_archived AND previous.archived_at IS NOT NULL THEN 'Projeto reativado' ELSE 'Projeto editado' END,
   'Nome: '||previous.title||' → '||trim(p_title)||'. Período: '||coalesce(previous.date_start::text,'—')||' / '||coalesce(previous.date_end::text,'—')||' → '||coalesce(p_start::text,'—')||' / '||coalesce(p_end::text,'—')||'.','Rodrigo',now());
END $$;
REVOKE ALL ON FUNCTION edit_owner_project(text,text,date,date,boolean,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edit_owner_project(text,text,date,date,boolean,bigint) TO tria_app;
