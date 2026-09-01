-- Ajustes do proprietário são versões completas e append-only. As fontes importadas permanecem intactas.
CREATE TABLE owner_activity_revision (
  id uuid PRIMARY KEY,
  activity_id text NOT NULL REFERENCES bm_activity(id),
  revision bigint NOT NULL CHECK (revision > 0),
  operation text NOT NULL CHECK (operation IN ('adjust', 'restore')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  before_state jsonb NOT NULL,
  duration_seconds bigint CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  measured_value numeric(30,16),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, revision)
);
CREATE INDEX owner_activity_revision_latest_idx ON owner_activity_revision(activity_id, revision DESC);

CREATE TABLE owner_fiscal_note_revision (
  id uuid PRIMARY KEY,
  fiscal_note_id text NOT NULL REFERENCES fiscal_note(id),
  revision bigint NOT NULL CHECK (revision > 0),
  operation text NOT NULL CHECK (operation IN ('adjust', 'restore')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  before_state jsonb NOT NULL,
  issue_year smallint NOT NULL CHECK (issue_year BETWEEN 1900 AND 2200),
  note_number text NOT NULL CHECK (char_length(btrim(note_number)) BETWEEN 1 AND 100),
  issue_date date NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount >= 0),
  category text CHECK (category IS NULL OR char_length(category) <= 200),
  declared_project_id text REFERENCES project(id),
  candidate_project_id text REFERENCES project(id),
  strength text NOT NULL CHECK (char_length(btrim(strength)) BETWEEN 1 AND 100),
  relation_state text NOT NULL CHECK (char_length(btrim(relation_state)) BETWEEN 1 AND 100),
  criterion text CHECK (criterion IS NULL OR char_length(criterion) <= 500),
  full_value_eligible boolean,
  verified_related_value numeric(20,2) CHECK (verified_related_value IS NULL OR verified_related_value >= 0),
  duplicate_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(year FROM issue_date)::smallint = issue_year),
  UNIQUE (fiscal_note_id, revision)
);
CREATE INDEX owner_fiscal_note_revision_latest_idx ON owner_fiscal_note_revision(fiscal_note_id, revision DESC);
CREATE INDEX owner_fiscal_note_revision_declared_idx ON owner_fiscal_note_revision(declared_project_id);
CREATE INDEX owner_fiscal_note_revision_candidate_idx ON owner_fiscal_note_revision(candidate_project_id);

CREATE OR REPLACE FUNCTION prevent_owner_revision_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'owner adjustment revisions are append-only';
END;
$$;
CREATE TRIGGER owner_activity_revision_append_only
  BEFORE UPDATE OR DELETE ON owner_activity_revision
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_revision_mutation();
CREATE TRIGGER owner_fiscal_note_revision_append_only
  BEFORE UPDATE OR DELETE ON owner_fiscal_note_revision
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_revision_mutation();
CREATE TRIGGER owner_activity_revision_no_truncate BEFORE TRUNCATE ON owner_activity_revision
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_owner_revision_mutation();
CREATE TRIGGER owner_fiscal_note_revision_no_truncate BEFORE TRUNCATE ON owner_fiscal_note_revision
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_owner_revision_mutation();

CREATE VIEW effective_bm_activity WITH (security_barrier = true) AS
SELECT a.id, a.project_id, a.bm_code, a.activity_date, a.functionality, a.activity,
  a.duration_seconds AS source_duration_seconds,
  a.measured_value AS source_measured_value,
  CASE WHEN r.id IS NULL THEN a.duration_seconds ELSE r.duration_seconds END AS effective_duration_seconds,
  CASE WHEN r.id IS NULL THEN a.measured_value ELSE r.measured_value END AS effective_measured_value,
  coalesce(r.revision, 0::bigint) AS adjustment_revision,
  r.operation AS adjustment_operation,
  r.reason AS adjustment_reason,
  r.actor AS adjusted_by,
  r.created_at AS adjusted_at,
  (r.id IS NOT NULL) AS adjusted
FROM bm_activity a
LEFT JOIN LATERAL (
  SELECT ar.* FROM owner_activity_revision ar
  WHERE ar.activity_id = a.id ORDER BY ar.revision DESC LIMIT 1
) r ON true;

CREATE VIEW effective_fiscal_note WITH (security_barrier = true) AS
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
) r ON true;


CREATE VIEW owner_activity_adjustment_history WITH (security_barrier = true) AS
SELECT id, activity_id, revision, operation, reason, actor, before_state,
  duration_seconds, measured_value, created_at
FROM owner_activity_revision;

CREATE VIEW owner_fiscal_note_adjustment_history WITH (security_barrier = true) AS
SELECT id, fiscal_note_id, revision, operation, reason, actor, before_state,
  issue_year, note_number, issue_date, amount, category, declared_project_id,
  candidate_project_id, strength, relation_state, criterion, full_value_eligible,
  verified_related_value, duplicate_confirmed, created_at
FROM owner_fiscal_note_revision;

CREATE OR REPLACE FUNCTION invalidate_adjusted_projects(
  p_project_ids text[], p_request_id uuid, p_action text, p_detail text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_project_id text;
BEGIN
  FOR v_project_id IN
    SELECT DISTINCT value FROM unnest(p_project_ids) value WHERE value IS NOT NULL ORDER BY value
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_project_id));
    UPDATE project_draft SET revision = revision + 1, updated_at = statement_timestamp()
      WHERE project_id = v_project_id;
    INSERT INTO history_event (id, project_id, action, detail, actor, occurred_at)
      VALUES (md5(p_request_id::text || ':' || v_project_id)::uuid,
        v_project_id, p_action, p_detail, 'Rodrigo', statement_timestamp())
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION write_owner_activity_revision(
  p_activity_id text, p_expected_revision bigint, p_request_id uuid, p_reason text,
  p_duration_seconds bigint, p_measured_value numeric, p_operation text
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_activity bm_activity%ROWTYPE;
  v_latest owner_activity_revision%ROWTYPE;
  v_current_revision bigint;
  v_before_duration bigint;
  v_before_value numeric(30,16);
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_operation NOT IN ('adjust', 'restore') OR
     char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 OR
     (p_duration_seconds IS NOT NULL AND p_duration_seconds < 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner activity adjustment';
  END IF;

  SELECT * INTO v_latest FROM owner_activity_revision WHERE id = p_request_id;
  IF FOUND THEN
    IF v_latest.activity_id <> p_activity_id OR v_latest.revision - 1 <> p_expected_revision OR
       v_latest.operation <> p_operation OR v_latest.reason <> btrim(p_reason) OR
       v_latest.duration_seconds IS DISTINCT FROM p_duration_seconds OR
       v_latest.measured_value IS DISTINCT FROM p_measured_value THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'request id reused with different activity payload';
    END IF;
    RETURN QUERY SELECT v_latest.revision, v_latest.created_at;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('owner-activity:' || p_activity_id, 23001));
  SELECT * INTO v_activity FROM bm_activity WHERE id = p_activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'activity not found'; END IF;
  SELECT * INTO v_latest FROM owner_activity_revision
    WHERE activity_id = p_activity_id ORDER BY revision DESC LIMIT 1;
  v_current_revision := coalesce(v_latest.revision, 0);
  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'owner activity revision conflict',
      DETAIL = 'expected=' || p_expected_revision || ',current=' || v_current_revision;
  END IF;
  v_before_duration := CASE WHEN v_latest.id IS NULL THEN v_activity.duration_seconds ELSE v_latest.duration_seconds END;
  v_before_value := CASE WHEN v_latest.id IS NULL THEN v_activity.measured_value ELSE v_latest.measured_value END;

  INSERT INTO owner_activity_revision
    (id, activity_id, revision, operation, reason, actor, before_state, duration_seconds, measured_value, created_at)
  VALUES (p_request_id, p_activity_id, v_current_revision + 1, p_operation, btrim(p_reason), 'Rodrigo',
    jsonb_build_object('durationSeconds', v_before_duration, 'measuredValue', v_before_value),
    p_duration_seconds, p_measured_value, statement_timestamp())
  RETURNING owner_activity_revision.revision, owner_activity_revision.created_at
    INTO revision, created_at;

  PERFORM invalidate_adjusted_projects(ARRAY[v_activity.project_id], p_request_id,
    CASE WHEN p_operation = 'restore' THEN 'Atividade restaurada' ELSE 'Atividade ajustada' END,
    'Revisão ' || revision || ' registrada com motivo e valores antes/depois preservados.');
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION apply_owner_activity_adjustment(
  p_activity_id text, p_expected_revision bigint, p_request_id uuid, p_reason text,
  p_duration_seconds bigint, p_measured_value numeric
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM write_owner_activity_revision(p_activity_id, p_expected_revision, p_request_id,
    p_reason, p_duration_seconds, p_measured_value, 'adjust');
$$;

CREATE OR REPLACE FUNCTION restore_owner_activity(
  p_activity_id text, p_expected_revision bigint, p_request_id uuid, p_reason text
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_source bm_activity%ROWTYPE;
BEGIN
  SELECT * INTO v_source FROM bm_activity WHERE id = p_activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'activity not found'; END IF;
  RETURN QUERY SELECT * FROM write_owner_activity_revision(p_activity_id, p_expected_revision,
    p_request_id, p_reason, v_source.duration_seconds, v_source.measured_value, 'restore');
END;
$$;

CREATE OR REPLACE FUNCTION write_owner_fiscal_note_revision(
  p_fiscal_note_id text, p_expected_revision bigint, p_request_id uuid, p_reason text,
  p_issue_year smallint, p_note_number text, p_issue_date date, p_amount numeric,
  p_category text, p_declared_project_id text, p_candidate_project_id text,
  p_strength text, p_relation_state text, p_criterion text, p_full_value_eligible boolean,
  p_verified_related_value numeric, p_confirm_duplicate boolean, p_operation text
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_note fiscal_note%ROWTYPE;
  v_relation financial_relation%ROWTYPE;
  v_latest owner_fiscal_note_revision%ROWTYPE;
  v_current effective_fiscal_note%ROWTYPE;
  v_current_revision bigint;
  v_duplicate boolean;
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_operation NOT IN ('adjust', 'restore') OR
     char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 OR
     p_issue_year NOT BETWEEN 1900 AND 2200 OR p_issue_date IS NULL OR
     extract(year FROM p_issue_date)::smallint <> p_issue_year OR
     char_length(btrim(coalesce(p_note_number, ''))) NOT BETWEEN 1 AND 100 OR
     p_amount IS NULL OR p_amount < 0 OR
     char_length(coalesce(p_category, '')) > 200 OR
     char_length(btrim(coalesce(p_strength, ''))) NOT BETWEEN 1 AND 100 OR
     char_length(btrim(coalesce(p_relation_state, ''))) NOT BETWEEN 1 AND 100 OR
     char_length(coalesce(p_criterion, '')) > 500 OR
     (p_verified_related_value IS NOT NULL AND p_verified_related_value < 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner fiscal note adjustment';
  END IF;

  SELECT * INTO v_latest FROM owner_fiscal_note_revision WHERE id = p_request_id;
  IF FOUND THEN
    IF v_latest.fiscal_note_id <> p_fiscal_note_id OR v_latest.revision - 1 <> p_expected_revision OR
       v_latest.operation <> p_operation OR v_latest.reason <> btrim(p_reason) OR
       v_latest.issue_year IS DISTINCT FROM p_issue_year OR v_latest.note_number IS DISTINCT FROM btrim(p_note_number) OR
       v_latest.issue_date IS DISTINCT FROM p_issue_date OR v_latest.amount IS DISTINCT FROM p_amount OR
       v_latest.category IS DISTINCT FROM nullif(btrim(coalesce(p_category, '')), '') OR
       v_latest.declared_project_id IS DISTINCT FROM p_declared_project_id OR
       v_latest.candidate_project_id IS DISTINCT FROM p_candidate_project_id OR
       v_latest.strength IS DISTINCT FROM btrim(p_strength) OR v_latest.relation_state IS DISTINCT FROM btrim(p_relation_state) OR
       v_latest.criterion IS DISTINCT FROM nullif(btrim(coalesce(p_criterion, '')), '') OR
       v_latest.full_value_eligible IS DISTINCT FROM p_full_value_eligible OR
       v_latest.verified_related_value IS DISTINCT FROM p_verified_related_value OR
       v_latest.duplicate_confirmed IS DISTINCT FROM p_confirm_duplicate THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'request id reused with different fiscal payload';
    END IF;
    RETURN QUERY SELECT v_latest.revision, v_latest.created_at;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('owner-fiscal:' || p_fiscal_note_id, 23002));
  SELECT * INTO v_note FROM fiscal_note WHERE id = p_fiscal_note_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'fiscal note not found'; END IF;
  SELECT * INTO v_current FROM effective_fiscal_note WHERE id = p_fiscal_note_id;
  v_current_revision := v_current.adjustment_revision;
  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'owner fiscal note revision conflict',
      DETAIL = 'expected=' || p_expected_revision || ',current=' || v_current_revision;
  END IF;

  PERFORM pg_advisory_xact_lock(23003);
  SELECT EXISTS(
    SELECT 1 FROM effective_fiscal_note other
    WHERE other.id <> p_fiscal_note_id AND other.issue_year = p_issue_year
      AND btrim(other.note_number) = btrim(p_note_number)
  ) INTO v_duplicate;
  IF v_duplicate AND NOT p_confirm_duplicate THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'duplicate fiscal note requires confirmation';
  END IF;

  INSERT INTO owner_fiscal_note_revision
    (id, fiscal_note_id, revision, operation, reason, actor, before_state,
     issue_year, note_number, issue_date, amount, category, declared_project_id,
     candidate_project_id, strength, relation_state, criterion, full_value_eligible,
     verified_related_value, duplicate_confirmed, created_at)
  VALUES (p_request_id, p_fiscal_note_id, v_current_revision + 1, p_operation, btrim(p_reason), 'Rodrigo',
    jsonb_build_object('issueYear', v_current.issue_year, 'noteNumber', v_current.note_number,
      'issueDate', v_current.issue_date, 'amount', v_current.amount, 'category', v_current.category,
      'declaredProjectId', v_current.declared_project_id, 'candidateProjectId', v_current.candidate_project_id,
      'strength', v_current.strength, 'relationState', v_current.relation_state,
      'criterion', v_current.criterion, 'fullValueEligible', v_current.full_value_eligible,
      'verifiedRelatedValue', v_current.verified_related_value),
    p_issue_year, btrim(p_note_number), p_issue_date, p_amount, nullif(btrim(coalesce(p_category, '')), ''),
    p_declared_project_id, p_candidate_project_id, btrim(p_strength), btrim(p_relation_state),
    nullif(btrim(coalesce(p_criterion, '')), ''), p_full_value_eligible, p_verified_related_value,
    p_confirm_duplicate, statement_timestamp())
  RETURNING owner_fiscal_note_revision.revision, owner_fiscal_note_revision.created_at
    INTO revision, created_at;

  PERFORM invalidate_adjusted_projects(
    ARRAY[v_current.declared_project_id, v_current.candidate_project_id,
      p_declared_project_id, p_candidate_project_id], p_request_id,
    CASE WHEN p_operation = 'restore' THEN 'NFS-e restaurada' ELSE 'NFS-e ajustada' END,
    'Revisão ' || revision || ' registrada atomicamente com motivo e valores antes/depois preservados.');
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION apply_owner_fiscal_note_adjustment(
  p_fiscal_note_id text, p_expected_revision bigint, p_request_id uuid, p_reason text,
  p_issue_year smallint, p_note_number text, p_issue_date date, p_amount numeric,
  p_category text, p_declared_project_id text, p_candidate_project_id text,
  p_strength text, p_relation_state text, p_criterion text, p_full_value_eligible boolean,
  p_verified_related_value numeric, p_confirm_duplicate boolean
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM write_owner_fiscal_note_revision(p_fiscal_note_id, p_expected_revision,
    p_request_id, p_reason, p_issue_year, p_note_number, p_issue_date, p_amount,
    p_category, p_declared_project_id, p_candidate_project_id, p_strength,
    p_relation_state, p_criterion, p_full_value_eligible, p_verified_related_value,
    p_confirm_duplicate, 'adjust');
$$;

CREATE OR REPLACE FUNCTION restore_owner_fiscal_note(
  p_fiscal_note_id text, p_expected_revision bigint, p_request_id uuid, p_reason text,
  p_confirm_duplicate boolean DEFAULT false
) RETURNS TABLE(revision bigint, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_note fiscal_note%ROWTYPE; v_relation financial_relation%ROWTYPE;
BEGIN
  SELECT * INTO v_note FROM fiscal_note WHERE id = p_fiscal_note_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'fiscal note not found'; END IF;
  SELECT * INTO v_relation FROM financial_relation WHERE fiscal_note_id = p_fiscal_note_id;
  RETURN QUERY SELECT * FROM write_owner_fiscal_note_revision(p_fiscal_note_id,
    p_expected_revision, p_request_id, p_reason, v_note.issue_year, v_note.note_number,
    v_note.issue_date, v_note.amount, v_note.category, v_note.declared_project_id,
    v_relation.candidate_project_id, coalesce(v_relation.strength, 'Sem relação verificável'),
    coalesce(v_relation.state, 'Não informado'), v_relation.criterion,
    v_relation.full_value_eligible, v_relation.verified_related_value,
    p_confirm_duplicate, 'restore');
END;
$$;

REVOKE ALL ON owner_activity_revision, owner_fiscal_note_revision FROM PUBLIC, tria_app;
REVOKE ALL ON effective_bm_activity, effective_fiscal_note, owner_activity_adjustment_history, owner_fiscal_note_adjustment_history FROM PUBLIC, tria_app;
GRANT SELECT ON effective_bm_activity, effective_fiscal_note, owner_activity_adjustment_history, owner_fiscal_note_adjustment_history TO tria_app;
REVOKE ALL ON FUNCTION prevent_owner_revision_mutation() FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION invalidate_adjusted_projects(text[], uuid, text, text) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION write_owner_activity_revision(text, bigint, uuid, text, bigint, numeric, text) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION write_owner_fiscal_note_revision(text, bigint, uuid, text, smallint, text, date, numeric, text, text, text, text, text, text, boolean, numeric, boolean, text) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION apply_owner_activity_adjustment(text, bigint, uuid, text, bigint, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_owner_activity(text, bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_owner_fiscal_note_adjustment(text, bigint, uuid, text, smallint, text, date, numeric, text, text, text, text, text, text, boolean, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_owner_fiscal_note(text, bigint, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_owner_activity_adjustment(text, bigint, uuid, text, bigint, numeric) TO tria_app;
GRANT EXECUTE ON FUNCTION restore_owner_activity(text, bigint, uuid, text) TO tria_app;
GRANT EXECUTE ON FUNCTION apply_owner_fiscal_note_adjustment(text, bigint, uuid, text, smallint, text, date, numeric, text, text, text, text, text, text, boolean, numeric, boolean) TO tria_app;
GRANT EXECUTE ON FUNCTION restore_owner_fiscal_note(text, bigint, uuid, text, boolean) TO tria_app;
