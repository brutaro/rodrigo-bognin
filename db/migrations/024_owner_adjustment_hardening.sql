-- Endurece ajustes já instalados sem reescrever a migração 023.
CREATE TABLE runtime_instance_marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z0-9][a-z0-9_-]{2,100}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owner_activity_revision
  ADD CONSTRAINT owner_activity_measured_not_nan CHECK (measured_value IS NULL OR measured_value <> 'NaN'::numeric) NOT VALID;
ALTER TABLE owner_fiscal_note_revision
  ADD COLUMN detected_duplicate_fiscal_note_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN duplicate_confirmation_requested boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT owner_fiscal_amount_not_nan CHECK (amount <> 'NaN'::numeric) NOT VALID,
  ADD CONSTRAINT owner_fiscal_related_not_nan CHECK (verified_related_value IS NULL OR verified_related_value <> 'NaN'::numeric) NOT VALID,
  ADD CONSTRAINT owner_fiscal_duplicate_audit CHECK (
    duplicate_confirmed = (cardinality(detected_duplicate_fiscal_note_ids) > 0 AND duplicate_confirmation_requested)
  ) NOT VALID;

DROP VIEW owner_fiscal_note_adjustment_history;
CREATE VIEW owner_fiscal_note_adjustment_history WITH (security_barrier = true) AS
SELECT id, fiscal_note_id, revision, operation, reason, actor, before_state,
  issue_year, note_number, issue_date, amount, category, declared_project_id,
  candidate_project_id, strength, relation_state, criterion, full_value_eligible,
  verified_related_value, detected_duplicate_fiscal_note_ids, duplicate_confirmation_requested,
  duplicate_confirmed, created_at
FROM owner_fiscal_note_revision;

CREATE OR REPLACE FUNCTION increment_owner_revision(p_revision bigint) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_revision = 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'owner revision overflow';
  END IF;
  RETURN p_revision + 1;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_adjusted_projects(
  p_project_ids text[], p_request_id uuid, p_entity_kind text, p_entity_id text, p_action text, p_detail text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_project_id text;
  v_draft_revision bigint;
BEGIN
  IF p_entity_kind NOT IN ('activity', 'fiscal_note') OR p_entity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid adjustment history entity';
  END IF;
  FOR v_project_id IN
    SELECT DISTINCT value FROM unnest(p_project_ids) value WHERE value IS NOT NULL ORDER BY value
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('owner-project:' || v_project_id, 23004));
    SELECT revision INTO v_draft_revision FROM project_draft WHERE project_id = v_project_id FOR UPDATE;
    IF FOUND AND v_draft_revision = 9223372036854775807 THEN
      RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'project draft revision overflow';
    END IF;
    INSERT INTO project_draft (project_id, narrative, revision, updated_at)
      VALUES (v_project_id, '', 1, statement_timestamp())
      ON CONFLICT (project_id) DO UPDATE
      SET revision = increment_owner_revision(project_draft.revision), updated_at = excluded.updated_at;
    INSERT INTO history_event (id, project_id, action, detail, actor, occurred_at)
      VALUES (md5(p_request_id::text || ':' || p_entity_kind || ':' || p_entity_id || ':' || v_project_id)::uuid,
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
     (p_duration_seconds IS NOT NULL AND p_duration_seconds < 0) OR
     (p_measured_value IS NOT NULL AND p_measured_value::text = 'NaN') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner activity adjustment';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('owner-activity-request:' || p_request_id::text, 23000));
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-activity:' || p_activity_id, 23001));
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

  SELECT * INTO v_activity FROM bm_activity WHERE id = p_activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'activity not found'; END IF;
  SELECT * INTO v_latest FROM owner_activity_revision
    WHERE activity_id = p_activity_id ORDER BY revision DESC LIMIT 1;
  v_current_revision := coalesce(v_latest.revision, 0);
  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'owner activity revision conflict',
      DETAIL = 'expected=' || p_expected_revision || ',current=' || v_current_revision;
  END IF;
  IF v_current_revision = 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'owner activity revision overflow';
  END IF;
  v_before_duration := CASE WHEN v_latest.id IS NULL THEN v_activity.duration_seconds ELSE v_latest.duration_seconds END;
  v_before_value := CASE WHEN v_latest.id IS NULL THEN v_activity.measured_value ELSE v_latest.measured_value END;
  IF v_before_duration IS NOT DISTINCT FROM p_duration_seconds AND v_before_value IS NOT DISTINCT FROM p_measured_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'owner activity adjustment has no changes';
  END IF;
  IF p_operation = 'restore' AND (p_duration_seconds IS DISTINCT FROM v_activity.duration_seconds OR
      p_measured_value IS DISTINCT FROM v_activity.measured_value) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity restore payload differs from source';
  END IF;

  INSERT INTO owner_activity_revision
    (id, activity_id, revision, operation, reason, actor, before_state, duration_seconds, measured_value, created_at)
  VALUES (p_request_id, p_activity_id, v_current_revision + 1, p_operation, btrim(p_reason), 'Rodrigo',
    jsonb_build_object('durationSeconds', v_before_duration, 'measuredValue', v_before_value),
    p_duration_seconds, p_measured_value, statement_timestamp())
  RETURNING owner_activity_revision.revision, owner_activity_revision.created_at
    INTO revision, created_at;

  PERFORM invalidate_adjusted_projects(ARRAY[v_activity.project_id], p_request_id, 'activity', p_activity_id,
    CASE WHEN p_operation = 'restore' THEN 'Atividade restaurada' ELSE 'Atividade ajustada' END,
    'Revisão ' || revision || ' registrada com motivo e valores antes/depois preservados.');
  RETURN NEXT;
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
  v_duplicate_ids text[];
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_operation NOT IN ('adjust', 'restore') OR
     char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 OR
     p_issue_year NOT BETWEEN 1900 AND 2200 OR p_issue_date IS NULL OR
     extract(year FROM p_issue_date)::smallint <> p_issue_year OR
     char_length(btrim(coalesce(p_note_number, ''))) NOT BETWEEN 1 AND 100 OR
     p_amount IS NULL OR p_amount::text = 'NaN' OR p_amount < 0 OR
     char_length(coalesce(p_category, '')) > 200 OR
     char_length(btrim(coalesce(p_strength, ''))) NOT BETWEEN 1 AND 100 OR
     char_length(btrim(coalesce(p_relation_state, ''))) NOT BETWEEN 1 AND 100 OR
     char_length(coalesce(p_criterion, '')) > 500 OR
     (p_verified_related_value IS NOT NULL AND (p_verified_related_value::text = 'NaN' OR p_verified_related_value < 0)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner fiscal note adjustment';
  END IF;
  IF p_operation = 'adjust' AND (
      (p_candidate_project_id IS NULL AND (btrim(p_strength) <> 'Sem relação verificável' OR
        btrim(p_relation_state) <> 'Não informado' OR nullif(btrim(coalesce(p_criterion, '')), '') IS NOT NULL OR
        p_full_value_eligible IS NOT NULL OR p_verified_related_value IS NOT NULL)) OR
      p_verified_related_value > p_amount OR
      (p_full_value_eligible IS NULL AND p_verified_related_value IS NOT NULL) OR
      (p_full_value_eligible IS TRUE AND p_verified_related_value IS DISTINCT FROM p_amount) OR
      (p_full_value_eligible IS FALSE AND p_verified_related_value IS NOT NULL AND p_verified_related_value = p_amount)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'incoherent owner fiscal relation tuple';
  END IF;

  -- Ordem única: universo fiscal, UUID da tentativa e, por fim, a nota.
  PERFORM pg_advisory_xact_lock(23003);
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-fiscal-request:' || p_request_id::text, 23005));
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-fiscal:' || p_fiscal_note_id, 23002));
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
       v_latest.duplicate_confirmation_requested IS DISTINCT FROM p_confirm_duplicate THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'request id reused with different fiscal payload';
    END IF;
    RETURN QUERY SELECT v_latest.revision, v_latest.created_at;
    RETURN;
  END IF;

  SELECT * INTO v_note FROM fiscal_note WHERE id = p_fiscal_note_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'fiscal note not found'; END IF;
  SELECT * INTO v_relation FROM financial_relation WHERE fiscal_note_id = p_fiscal_note_id;
  SELECT * INTO v_current FROM effective_fiscal_note WHERE id = p_fiscal_note_id;
  v_current_revision := v_current.adjustment_revision;
  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'owner fiscal note revision conflict',
      DETAIL = 'expected=' || p_expected_revision || ',current=' || v_current_revision;
  END IF;
  IF v_current_revision = 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'owner fiscal note revision overflow';
  END IF;
  IF v_current.issue_year IS NOT DISTINCT FROM p_issue_year AND v_current.note_number IS NOT DISTINCT FROM btrim(p_note_number) AND
      v_current.issue_date IS NOT DISTINCT FROM p_issue_date AND v_current.amount IS NOT DISTINCT FROM p_amount AND
      v_current.category IS NOT DISTINCT FROM nullif(btrim(coalesce(p_category, '')), '') AND
      v_current.declared_project_id IS NOT DISTINCT FROM p_declared_project_id AND
      v_current.candidate_project_id IS NOT DISTINCT FROM p_candidate_project_id AND
      v_current.strength IS NOT DISTINCT FROM btrim(p_strength) AND v_current.relation_state IS NOT DISTINCT FROM btrim(p_relation_state) AND
      v_current.criterion IS NOT DISTINCT FROM nullif(btrim(coalesce(p_criterion, '')), '') AND
      v_current.full_value_eligible IS NOT DISTINCT FROM p_full_value_eligible AND
      v_current.verified_related_value IS NOT DISTINCT FROM p_verified_related_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'owner fiscal note adjustment has no changes';
  END IF;
  IF p_operation = 'restore' AND (
      p_issue_year IS DISTINCT FROM v_note.issue_year OR btrim(p_note_number) IS DISTINCT FROM v_note.note_number OR
      p_issue_date IS DISTINCT FROM v_note.issue_date OR p_amount IS DISTINCT FROM v_note.amount OR
      nullif(btrim(coalesce(p_category, '')), '') IS DISTINCT FROM v_note.category OR
      p_declared_project_id IS DISTINCT FROM v_note.declared_project_id OR
      p_candidate_project_id IS DISTINCT FROM v_relation.candidate_project_id OR
      btrim(p_strength) IS DISTINCT FROM coalesce(v_relation.strength, 'Sem relação verificável') OR
      btrim(p_relation_state) IS DISTINCT FROM coalesce(v_relation.state, 'Não informado') OR
      nullif(btrim(coalesce(p_criterion, '')), '') IS DISTINCT FROM v_relation.criterion OR
      p_full_value_eligible IS DISTINCT FROM v_relation.full_value_eligible OR
      p_verified_related_value IS DISTINCT FROM v_relation.verified_related_value) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'fiscal restore payload differs from source';
  END IF;

  SELECT coalesce(array_agg(other.id ORDER BY other.id), '{}'::text[]) INTO v_duplicate_ids
    FROM effective_fiscal_note other
    WHERE other.id <> p_fiscal_note_id AND other.issue_year = p_issue_year
      AND btrim(other.note_number) = btrim(p_note_number);
  IF cardinality(v_duplicate_ids) > 0 AND NOT p_confirm_duplicate THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'duplicate fiscal note requires confirmation',
      DETAIL = 'detected_ids=' || array_to_string(v_duplicate_ids, ',');
  END IF;

  INSERT INTO owner_fiscal_note_revision
    (id, fiscal_note_id, revision, operation, reason, actor, before_state,
     issue_year, note_number, issue_date, amount, category, declared_project_id,
     candidate_project_id, strength, relation_state, criterion, full_value_eligible,
     verified_related_value, detected_duplicate_fiscal_note_ids, duplicate_confirmation_requested, duplicate_confirmed, created_at)
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
    v_duplicate_ids, p_confirm_duplicate, cardinality(v_duplicate_ids) > 0 AND p_confirm_duplicate, statement_timestamp())
  RETURNING owner_fiscal_note_revision.revision, owner_fiscal_note_revision.created_at
    INTO revision, created_at;

  PERFORM invalidate_adjusted_projects(
    ARRAY[v_current.declared_project_id, v_current.candidate_project_id,
      p_declared_project_id, p_candidate_project_id], p_request_id, 'fiscal_note', p_fiscal_note_id,
    CASE WHEN p_operation = 'restore' THEN 'NFS-e restaurada' ELSE 'NFS-e ajustada' END,
    'Revisão ' || revision || ' registrada atomicamente com motivo e valores antes/depois preservados.');
  RETURN NEXT;
END;
$$;


DROP FUNCTION invalidate_adjusted_projects(text[], uuid, text, text);

REVOKE ALL ON runtime_instance_marker FROM PUBLIC, tria_app;
GRANT SELECT ON runtime_instance_marker TO tria_app;
GRANT SELECT ON owner_fiscal_note_adjustment_history TO tria_app;
REVOKE ALL ON FUNCTION increment_owner_revision(bigint) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION invalidate_adjusted_projects(text[], uuid, text, text, text, text) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION write_owner_activity_revision(text, bigint, uuid, text, bigint, numeric, text) FROM PUBLIC, tria_app;
REVOKE ALL ON FUNCTION write_owner_fiscal_note_revision(text, bigint, uuid, text, smallint, text, date, numeric, text, text, text, text, text, text, boolean, numeric, boolean, text) FROM PUBLIC, tria_app;
