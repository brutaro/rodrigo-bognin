CREATE FUNCTION create_owner_project(p_id text, p_title text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE batch uuid:=gen_random_uuid();
BEGIN
 IF session_user <> 'tria_app' OR length(trim(p_title)) NOT BETWEEN 3 AND 200 OR p_id !~ '^manual-[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'projeto inválido'; END IF;
 INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES (batch,'owner-project','cadastro-local',encode(sha256(convert_to(p_id,'UTF8')),'hex'),1,'completed');
 INSERT INTO project(id,source_project_id,title,evidence_status,import_batch_id) VALUES(p_id,p_id,trim(p_title),'Não informado',batch);
 INSERT INTO project_draft(project_id) VALUES(p_id);
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION create_owner_project(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_owner_project(text,text) TO tria_app;
