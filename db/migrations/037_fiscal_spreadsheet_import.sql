CREATE TABLE fiscal_import (
 id uuid PRIMARY KEY,
 source_file_id uuid NOT NULL REFERENCES source_file(id),
 content_hash char(64) NOT NULL,
 sheet_name text NOT NULL,
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 errors jsonb NOT NULL CHECK(jsonb_typeof(errors)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 applied_at timestamptz,
 inserted_count integer
);
GRANT SELECT,INSERT ON fiscal_import TO tria_app;
CREATE FUNCTION apply_fiscal_import(p_id uuid,p_hash text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE preview fiscal_import%ROWTYPE; item jsonb; existing fiscal_note%ROWTYPE; note_id text; batch uuid; inserted integer:=0; digest text;
BEGIN
 IF session_user<>'tria_app' THEN RAISE EXCEPTION 'Acesso inválido'; END IF;
 PERFORM pg_advisory_xact_lock(23003);
 SELECT * INTO STRICT preview FROM fiscal_import WHERE id=p_id AND content_hash=p_hash FOR UPDATE;
 IF preview.applied_at IS NOT NULL THEN RETURN preview.inserted_count; END IF;
 IF jsonb_array_length(preview.errors)>0 OR jsonb_array_length(preview.rows)=0 THEN RAISE EXCEPTION 'Prévia inválida'; END IF;
 batch:=gen_random_uuid();
 FOR item IN SELECT value FROM jsonb_array_elements(preview.rows) LOOP
  note_id:=item->>'id';
  SELECT * INTO existing FROM fiscal_note WHERE id=note_id;
  IF FOUND THEN
   IF (existing.note_number,existing.issue_date,existing.amount,existing.category,existing.declared_project_id)
     IS DISTINCT FROM (item->>'number',(item->>'date')::date,(item->>'amount')::numeric,nullif(item->>'category',''),nullif(item->>'projectId','')) THEN
    RAISE EXCEPTION 'Uma nota existente diverge. Confira a prévia e use o ajuste da nota.';
   END IF;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM effective_fiscal_note WHERE issue_year=(item->>'year')::int AND lower(trim(note_number))=lower(trim(item->>'number')))
    OR EXISTS(SELECT 1 FROM fiscal_note WHERE issue_year=(item->>'year')::int AND lower(trim(note_number))=lower(trim(item->>'number'))) THEN
    RAISE EXCEPTION 'Número e ano já cadastrados. Confira a nota antes de importar.';
  END IF;
  IF inserted=0 THEN
   digest:=encode(sha256(convert_to(p_id::text,'UTF8')),'hex');
   INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status)
    VALUES(batch,'fiscal_notes','cofre:'||preview.source_file_id::text,digest,jsonb_array_length(preview.rows),'completed');
  END IF;
  INSERT INTO fiscal_note(id,batch_id,source_note_id,issue_year,note_number,issue_date,amount,category,declared_project_id)
    VALUES(note_id,batch,item->>'sourceId',(item->>'year')::smallint,item->>'number',(item->>'date')::date,(item->>'amount')::numeric,nullif(item->>'category',''),nullif(item->>'projectId',''));
  inserted:=inserted+1;
  IF nullif(item->>'projectId','') IS NOT NULL THEN
   UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=item->>'projectId';
   INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at)
    VALUES(gen_random_uuid(),item->>'projectId','Nota fiscal importada',item->>'number','Rodrigo',now());
  END IF;
 END LOOP;
 UPDATE fiscal_import SET applied_at=now(),inserted_count=inserted WHERE id=p_id;
 RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION apply_fiscal_import(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_fiscal_import(uuid,text) TO tria_app;
