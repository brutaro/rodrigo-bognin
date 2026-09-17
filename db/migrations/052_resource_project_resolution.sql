-- Current titles take precedence over immutable historical aliases. Ambiguous
-- identities remain unresolved; archival alone never changes ownership.
CREATE FUNCTION resource_project_id(p_title text) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH candidates AS (
  SELECT id,CASE WHEN title=p_title THEN 0 ELSE 1 END priority
  FROM project WHERE title=p_title OR coalesce(nullif(resource_source_title,''),title)=p_title
 ), preferred AS (
  SELECT id FROM candidates WHERE priority=(SELECT min(priority) FROM candidates)
 ) SELECT CASE WHEN count(*)=1 THEN min(id) ELSE NULL END FROM preferred
$$;
REVOKE ALL ON FUNCTION resource_project_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resource_project_id(text) TO tria_app;
CREATE OR REPLACE FUNCTION apply_resource_activities(p_import uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE preview resource_import%ROWTYPE; item jsonb; link resource_activity_link%ROWTYPE;
 batch uuid; n integer:=0; target text; touched text[]:='{}'; project_key text;
BEGIN
 IF session_user<>'tria_app' THEN RAISE EXCEPTION 'activity import unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(7824031);
 SELECT * INTO preview FROM resource_import WHERE id=p_import;
 IF preview.applied_at IS NULL OR preview.activity_plan IS NULL OR jsonb_array_length(preview.errors)>0
 OR NOT EXISTS(SELECT 1 FROM resource_import_current WHERE import_id=p_import) THEN
  RAISE EXCEPTION 'A prévia de atividades precisa estar aplicada e vigente.';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(preview.activity_plan->'items') ORDER BY value->>'activityId' LOOP
  target:=item->>'activityId';
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-activity:'||target,23001));
  SELECT * INTO link FROM resource_activity_link WHERE resource_id=item->>'resourceId';
  IF link.latest_import_id=p_import THEN CONTINUE; END IF;
  IF link.latest_import_id IS DISTINCT FROM (item->>'expectedImport')::uuid THEN
   RAISE EXCEPTION 'As atividades mudaram desde a prévia. Prepare uma nova prévia.';
  END IF;
  IF NOT (item->>'changed')::boolean THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM resource_activity_legacy WHERE resource_id=item->>'resourceId') THEN
   RAISE EXCEPTION 'A atividade original está protegida.';
  END IF;
  SELECT coalesce(nullif(resource_source_title,''),title) INTO project_key FROM project WHERE id=item->>'projectId';
  IF project_key IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(preview.rows) r
    WHERE r->>'id'=item->>'resourceId' AND resource_project_id(r->>'project')=item->>'projectId' AND r->>'activity'=item->>'description'
      AND (r->>'amount')::numeric=(item->>'amount')::numeric) THEN
   RAISE EXCEPTION 'O projeto ou os dados da atividade mudaram. Prepare uma nova prévia.';
  END IF;
  IF link.activity_id IS NOT NULL AND (link.activity_id<>target OR NOT EXISTS
    (SELECT 1 FROM bm_activity WHERE id=target AND project_id=item->>'projectId')) THEN
   RAISE EXCEPTION 'A atividade pertence a outro projeto.';
  END IF;
  IF batch IS NULL THEN
   batch:=gen_random_uuid();
   INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status)
    VALUES(batch,'resource-activities','source://resource-import/'||p_import,
      encode(sha256(convert_to(p_import::text,'UTF8')),'hex'),jsonb_array_length(preview.activity_plan->'items'),'completed');
  END IF;
  IF link.activity_id IS NULL THEN
   INSERT INTO bm_activity(id,batch_id,project_id,source_id,source_sheet,source_excel_row,bm_code,
     activity_date,activity,duration_seconds,measured_value,quality_status)
    VALUES(target,batch,item->>'projectId',p_import::text,preview.sheet_name,(item->>'sourceRow')::integer,item->>'bm',
     (item->>'date')::timestamp AT TIME ZONE 'UTC',item->>'description',(item->>'seconds')::bigint,
     (item->>'amount')::numeric,jsonb_build_object('resourceId',item->>'resourceId','importId',p_import));
   INSERT INTO resource_activity_link VALUES(item->>'resourceId',target,p_import);
  ELSE
   UPDATE bm_activity SET batch_id=batch,source_id=p_import::text,source_sheet=preview.sheet_name,
     source_excel_row=(item->>'sourceRow')::integer,bm_code=item->>'bm',activity_date=(item->>'date')::timestamp AT TIME ZONE 'UTC',
     activity=item->>'description',duration_seconds=(item->>'seconds')::bigint,measured_value=(item->>'amount')::numeric,
     quality_status=jsonb_build_object('resourceId',item->>'resourceId','importId',p_import)
     WHERE id=target;
   UPDATE resource_activity_link SET latest_import_id=p_import WHERE resource_id=item->>'resourceId';
  END IF;
  n:=n+1;touched:=array_append(touched,item->>'projectId');
 END LOOP;
 FOR target IN SELECT DISTINCT unnest(touched) LOOP
  UPDATE project SET activity_count=(SELECT count(*) FROM bm_activity WHERE project_id=target),
    bm_count=(SELECT count(DISTINCT bm_code) FROM bm_activity WHERE project_id=target),
    hours_total=(SELECT sum(effective_duration_seconds)::numeric/3600 FROM effective_bm_activity WHERE project_id=target),
    value_total=(SELECT sum(effective_measured_value) FROM effective_bm_activity WHERE project_id=target) WHERE id=target;
  INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at)
   VALUES(md5(p_import::text||':activities:'||target)::uuid,target,'Atividades importadas',
    'Planilha conferida. Ajustes manuais e atividades ausentes foram preservados.','Rodrigo',now());
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION apply_resource_activities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_resource_activities(uuid) TO tria_app;

