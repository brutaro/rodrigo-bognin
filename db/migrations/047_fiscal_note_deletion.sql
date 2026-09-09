-- Uma marca imutável remove a contribuição somente das consultas vigentes.
CREATE TABLE fiscal_note_deletion (
 fiscal_note_id text PRIMARY KEY REFERENCES fiscal_note(id),
 request_id uuid NOT NULL UNIQUE,
 expected_revision bigint NOT NULL CHECK(expected_revision>=0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 before_state jsonb NOT NULL,
 actor text NOT NULL DEFAULT 'Rodrigo' CHECK(actor='Rodrigo'),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON fiscal_note_deletion FROM PUBLIC,tria_app,tria_importer;
GRANT SELECT ON fiscal_note_deletion TO tria_app;
CREATE OR REPLACE VIEW effective_fiscal_note WITH (security_barrier = true) AS
SELECT n.id,
  n.issue_year AS source_issue_year, n.note_number AS source_note_number,
  n.issue_date AS source_issue_date, n.amount AS source_amount,
  n.category AS source_category, n.declared_project_id AS source_declared_project_id,
  fr.candidate_project_id AS source_candidate_project_id,
  fr.strength AS source_strength, fr.state AS source_relation_state,
  fr.criterion AS source_criterion, fr.full_value_eligible AS source_full_value_eligible,
  fr.verified_related_value AS source_verified_related_value,
  coalesce(r.issue_year, n.issue_year) AS issue_year,
  coalesce(r.note_number, n.note_number) AS note_number,
  coalesce(r.issue_date, n.issue_date) AS issue_date,
  coalesce(r.amount, n.amount) AS amount,
  CASE WHEN r.id IS NULL THEN n.category ELSE r.category END AS category,
  CASE WHEN r.id IS NULL THEN n.declared_project_id ELSE r.declared_project_id END AS declared_project_id,
  CASE WHEN r.id IS NULL THEN fr.candidate_project_id ELSE r.candidate_project_id END AS candidate_project_id,
  CASE WHEN r.id IS NULL THEN coalesce(fr.strength, 'Sem relação verificável') ELSE r.strength END AS strength,
  CASE WHEN r.id IS NULL THEN coalesce(fr.state, 'Não informado') ELSE r.relation_state END AS relation_state,
  CASE WHEN r.id IS NULL THEN fr.criterion ELSE r.criterion END AS criterion,
  CASE WHEN r.id IS NULL THEN fr.full_value_eligible ELSE r.full_value_eligible END AS full_value_eligible,
  CASE WHEN r.id IS NULL THEN fr.verified_related_value ELSE r.verified_related_value END AS verified_related_value,
  coalesce(r.revision, 0::bigint) AS adjustment_revision,
  r.operation AS adjustment_operation,
  r.reason AS adjustment_reason,
  r.actor AS adjusted_by,
  r.created_at AS adjusted_at,
  (r.id IS NOT NULL) AS adjusted
FROM fiscal_note n
LEFT JOIN financial_relation fr ON fr.fiscal_note_id = n.id
LEFT JOIN LATERAL (
  SELECT nr.* FROM owner_fiscal_note_revision nr
  WHERE nr.fiscal_note_id = n.id ORDER BY nr.revision DESC LIMIT 1
) r ON true
WHERE NOT EXISTS(SELECT 1 FROM fiscal_note_deletion d WHERE d.fiscal_note_id=n.id);
CREATE FUNCTION delete_owner_fiscal_note(p_id text,p_revision bigint,p_request uuid,p_reason text) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous fiscal_note_deletion%ROWTYPE; current_revision bigint; affected text[]; snapshot jsonb;
BEGIN
 IF p_request IS NULL OR p_revision IS NULL OR p_revision<0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid fiscal deletion';
 END IF;
 PERFORM pg_advisory_xact_lock(23003);
 PERFORM pg_advisory_xact_lock(hashtextextended('owner-fiscal-request:'||p_request::text,23005));
 PERFORM pg_advisory_xact_lock(hashtextextended('owner-fiscal:'||p_id,23002));
 SELECT * INTO previous FROM fiscal_note_deletion WHERE request_id=p_request;
 IF FOUND AND (previous.fiscal_note_id<>p_id OR previous.expected_revision<>p_revision OR previous.reason<>btrim(p_reason)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='request id reused with different deletion payload';
 END IF;
 IF EXISTS(SELECT 1 FROM owner_fiscal_note_revision WHERE id=p_request) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='request id already used for fiscal adjustment';
 END IF;
 IF EXISTS(SELECT 1 FROM fiscal_note_deletion WHERE fiscal_note_id=p_id) THEN RETURN '{}'::text[]; END IF;
 SELECT max(adjustment_revision),jsonb_agg(to_jsonb(n)) INTO current_revision,snapshot FROM effective_fiscal_note n WHERE id=p_id;
 IF current_revision IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='fiscal note not found'; END IF;
 IF current_revision<>p_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='owner fiscal note revision conflict'; END IF;
 SELECT coalesce(array_agg(DISTINCT project_id ORDER BY project_id),'{}'::text[]) INTO affected FROM (
  SELECT declared_project_id project_id FROM effective_fiscal_note WHERE id=p_id
  UNION SELECT candidate_project_id FROM effective_fiscal_note WHERE id=p_id
  UNION SELECT declared_project_id FROM fiscal_note WHERE id=p_id
  UNION SELECT candidate_project_id FROM financial_relation WHERE fiscal_note_id=p_id
 ) projects WHERE project_id IS NOT NULL;
 INSERT INTO fiscal_note_deletion(fiscal_note_id,request_id,expected_revision,reason,before_state)
 VALUES(p_id,p_request,p_revision,btrim(p_reason),snapshot);
 PERFORM invalidate_adjusted_projects(affected,p_request,'fiscal_note',p_id,'NFS-e excluída',btrim(p_reason)||' · Fontes, vínculos e pagamentos preservados.');
 RETURN affected;
END $$;
REVOKE ALL ON FUNCTION delete_owner_fiscal_note(text,bigint,uuid,text) FROM PUBLIC,tria_importer;
GRANT EXECUTE ON FUNCTION delete_owner_fiscal_note(text,bigint,uuid,text) TO tria_app;
CREATE FUNCTION guard_deleted_fiscal_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(23003);
 IF EXISTS(SELECT 1 FROM fiscal_note_deletion WHERE fiscal_note_id=NEW.fiscal_note_id OR request_id=NEW.id) THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='fiscal note deleted';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_deleted_fiscal_revision() FROM PUBLIC,tria_app,tria_importer;
CREATE TRIGGER deleted_fiscal_revision_guard BEFORE INSERT ON owner_fiscal_note_revision FOR EACH ROW EXECUTE FUNCTION guard_deleted_fiscal_revision();
