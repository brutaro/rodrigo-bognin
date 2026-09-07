-- Source-ledger 3.3: append-only reconciliation and event-derived effective projection.
CREATE OR REPLACE FUNCTION source_reconciliation_has_reserved_key(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(EXISTS (
    SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p_value) = 'object' THEN p_value ELSE '{}'::jsonb END) key
    WHERE lower(key) IN ('curso', 'trilha')
  ), false)
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_valid_decimal_sources(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object' AND NOT source_reconciliation_has_reserved_key(p_value) AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_value) source(field, metadata)
      WHERE jsonb_typeof(metadata) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(metadata)) <> 3
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(metadata) key WHERE key NOT IN ('source_text', 'source_scale', 'normalized_value'))
        OR jsonb_typeof(metadata->'source_text') <> 'string'
        OR jsonb_typeof(metadata->'source_scale') <> 'number'
        OR metadata->>'source_scale' !~ '^(0|[1-9][0-9]*)$'
        OR (metadata->>'source_scale')::numeric > 100
        OR jsonb_typeof(metadata->'normalized_value') NOT IN ('string', 'null')
        OR (jsonb_typeof(metadata->'normalized_value')='string' AND (
          metadata->>'normalized_value' !~ '^-?[0-9]+(?:\.[0-9]+)?$' OR
          CASE WHEN position('.' in metadata->>'normalized_value')>0 THEN length(split_part(metadata->>'normalized_value','.',2)) ELSE 0 END > (metadata->>'source_scale')::integer))
    )
  )
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_valid_duration_sources(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object' AND NOT source_reconciliation_has_reserved_key(p_value) AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_value) source(field, metadata)
      WHERE jsonb_typeof(metadata) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(metadata)) <> 2
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(metadata) key WHERE key NOT IN ('source_text', 'unit'))
        OR jsonb_typeof(metadata->'source_text') <> 'string'
        OR jsonb_typeof(metadata->'unit') <> 'string'
        OR metadata->>'unit' NOT IN ('minutes', 'clock')
        OR (metadata->>'unit'='minutes' AND metadata->>'source_text' !~ '^[0-9]+$')
        OR (metadata->>'unit'='clock' AND metadata->>'source_text' !~ '^[0-9]+:[0-5][0-9](?::[0-5][0-9])?$')
    )
  )
$$;
-- The Story 3.2 migration remains byte-for-byte immutable. These columns are
-- the 3.3 additive extension used to retain typed duration provenance and the
-- explicit stable matching evidence alongside each prepared row.
ALTER TABLE src_import_staging_row
  ADD COLUMN duration_sources jsonb,
  ADD COLUMN matching_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION source_reconciliation_validate_staging_row_json()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $staging_guard$
BEGIN
  IF TG_NAME <> 'src_import_staging_row_story33_validate'
     OR TG_RELID <> 'public.src_import_staging_row'::regclass
     OR TG_OP NOT IN ('INSERT', 'UPDATE') OR TG_WHEN <> 'BEFORE'
     OR TG_LEVEL <> 'ROW' OR TG_NARGS <> 0 OR pg_trigger_depth() <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'staging validator trigger identity is invalid';
  END IF;
  IF public.source_reconciliation_valid_duration_sources(NEW.duration_sources) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_duration_sources_shape', MESSAGE = 'staging duration sources violate the canonical shape';
  END IF;
  IF jsonb_typeof(NEW.matching_attributes) <> 'object'
     OR public.source_reconciliation_has_reserved_key(NEW.matching_attributes) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_matching_attributes_shape', MESSAGE = 'staging matching attributes violate the canonical shape';
  END IF;
  IF public.source_reconciliation_valid_decimal_sources(NEW.decimal_sources) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_decimal_sources_canonical', MESSAGE = 'staging decimal sources violate the canonical shape';
  END IF;
  IF public.source_reconciliation_has_reserved_key(NEW.normalized_payload)
     OR public.source_reconciliation_has_reserved_key(NEW.source_values) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_payload_reserved_keys', MESSAGE = 'staging payload contains a reserved key';
  END IF;
  RETURN NEW;
END;
$staging_guard$;

-- Migration 030 is local and may see rows written by 029. Validate them with
-- migration-owner rights before the private trigger becomes authoritative.
DO $validate_existing_story33_staging$
BEGIN
  IF EXISTS (SELECT 1 FROM public.src_import_staging_row WHERE public.source_reconciliation_valid_duration_sources(duration_sources) IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_duration_sources_shape', MESSAGE = 'existing staging duration sources violate the canonical shape';
  END IF;
  IF EXISTS (SELECT 1 FROM public.src_import_staging_row WHERE jsonb_typeof(matching_attributes) <> 'object' OR public.source_reconciliation_has_reserved_key(matching_attributes)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_matching_attributes_shape', MESSAGE = 'existing staging matching attributes violate the canonical shape';
  END IF;
  IF EXISTS (SELECT 1 FROM public.src_import_staging_row WHERE public.source_reconciliation_valid_decimal_sources(decimal_sources) IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_decimal_sources_canonical', MESSAGE = 'existing staging decimal sources violate the canonical shape';
  END IF;
  IF EXISTS (SELECT 1 FROM public.src_import_staging_row WHERE public.source_reconciliation_has_reserved_key(normalized_payload) OR public.source_reconciliation_has_reserved_key(source_values)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', SCHEMA = 'public', TABLE = 'src_import_staging_row', CONSTRAINT = 'src_import_staging_row_payload_reserved_keys', MESSAGE = 'existing staging payload contains a reserved key';
  END IF;
END;
$validate_existing_story33_staging$;

CREATE TRIGGER src_import_staging_row_story33_validate
BEFORE INSERT OR UPDATE OF duration_sources, matching_attributes, decimal_sources, normalized_payload, source_values
ON src_import_staging_row FOR EACH ROW EXECUTE FUNCTION source_reconciliation_validate_staging_row_json();

-- Story 3.3 extends the synthetic registry with the optional `referencia`
-- field. Keep the 3.2 migration immutable and replace only its deferred
-- graph validator after the additive columns exist. `referencia` is emitted
-- by the synthetic registry; `stable_key` and `case_key` are explicit keys
-- used by the 3.3 reconciliation fixtures. No arbitrary browser key becomes
-- staging data or matching evidence.
CREATE OR REPLACE FUNCTION validate_import_graph() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b public.src_import_batch; p public.src_import_preview; c public.src_import_preview_confirmation; contract public.src_import_contract; n integer; v integer; r integer;
BEGIN
  SELECT * INTO b FROM public.src_import_batch WHERE id=CASE WHEN TG_TABLE_NAME='src_import_batch' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'batch_id')::uuid END;
  IF TG_TABLE_NAME='src_import_staging_row' THEN
    IF b.status <> 'Validado' OR NEW.retain_until <> b.retain_until OR
       jsonb_typeof(NEW.field_errors)<>'array' OR (NEW.status='valid' AND jsonb_array_length(NEW.field_errors)<>0) OR (NEW.status='rejected' AND jsonb_array_length(NEW.field_errors)=0) OR
       EXISTS (SELECT 1 FROM jsonb_each(NEW.normalized_payload) j WHERE j.key NOT IN ('codigo','referencia','data','valor','duracao') OR jsonb_typeof(j.value) NOT IN ('string','null')) OR
       EXISTS (SELECT 1 FROM jsonb_each(NEW.source_values) j WHERE j.key NOT IN ('codigo','referencia','data','valor','duracao') OR jsonb_typeof(j.value)<>'string') OR
       EXISTS (SELECT 1 FROM jsonb_each(NEW.matching_attributes) j WHERE j.key NOT IN ('referencia', 'stable_key', 'case_key') OR jsonb_typeof(j.value)<>'string' OR btrim(j.value #>> '{}') = '') OR
       jsonb_typeof(NEW.duration_sources)<>'object' OR NEW.source_values ?| ARRAY['curso','trilha'] OR NEW.decimal_sources ?| ARRAY['curso','trilha'] THEN RAISE EXCEPTION 'invalid staging graph'; END IF;
  END IF;
  SELECT * INTO p FROM public.src_import_preview WHERE batch_id=b.id;
  SELECT * INTO contract FROM public.src_import_contract WHERE id=p.contract_id;
  SELECT count(*), count(*) FILTER (WHERE status='valid'), count(*) FILTER (WHERE status='rejected') INTO n,v,r FROM public.src_import_staging_row WHERE batch_id=b.id;
  IF b.status='Rejeitado' THEN
    IF NOT EXISTS (SELECT 1 FROM public.src_import_event WHERE batch_id=b.id AND event_type='source.import.preview_rejected.v1') THEN RAISE EXCEPTION 'rejection event missing'; END IF;
    IF n<>0 OR p.id IS NOT NULL OR b.found_count<>0 OR b.valid_count<>0 OR b.error_count<>0 OR b.rejected_count<>0 THEN RAISE EXCEPTION 'rejected batch has results'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.src_import_event WHERE batch_id=b.id AND event_type='source.import.preview_prepared.v1') THEN RAISE EXCEPTION 'preparation event missing'; END IF;
    IF p.id IS NULL OR n<>b.found_count OR v<>b.valid_count OR r<>b.rejected_count OR r<>b.error_count OR b.found_count<>b.valid_count+b.rejected_count THEN RAISE EXCEPTION 'invalid batch counts'; END IF;
    IF p.retain_until<>b.retain_until OR p.prepared_at<>b.prepared_at OR
       p.manifest->>'actor' IS DISTINCT FROM b.actor OR p.manifest->>'status' IS DISTINCT FROM b.status OR
       (p.manifest->>'preparedAt')::timestamptz IS DISTINCT FROM p.prepared_at OR
       p.manifest->'contract' IS DISTINCT FROM contract.contract_payload OR
       p.manifest->'registry' IS DISTINCT FROM jsonb_build_object('schemaId',contract.schema_id,'parserProfileId',contract.parser_profile_id,'transformationId',contract.transformation_id,'limitsProfileId',contract.limits_profile_id) OR
       p.manifest->>'schemaVersion' IS DISTINCT FROM contract.schema_version OR
       p.manifest->>'parserVersion' IS DISTINCT FROM contract.parser_version OR
       p.manifest->>'transformationVersion' IS DISTINCT FROM contract.transformation_version OR
       p.manifest->'csvParseOptions' IS DISTINCT FROM contract.contract_payload->'csvParseOptions' OR
       p.manifest->'sheetSelection' IS DISTINCT FROM contract.contract_payload->'sheetSelection' OR
       p.manifest->>'previewId' IS DISTINCT FROM p.id::text OR p.manifest->>'batchId' IS DISTINCT FROM b.id::text OR
       p.manifest->>'sourceFileId' IS DISTINCT FROM p.source_file_id::text OR p.manifest->>'fileVersionId' IS DISTINCT FROM p.file_version_id::text OR
       p.manifest->>'sourceSha256' IS DISTINCT FROM p.source_sha256::text OR p.manifest->>'sourceFormat' IS DISTINCT FROM p.source_format OR
       p.manifest->>'contractHash' IS DISTINCT FROM p.contract_hash::text OR p.manifest->>'transformationHash' IS DISTINCT FROM p.transformation_hash::text OR
       p.manifest->>'contentHash' IS DISTINCT FROM p.content_hash::text OR p.manifest->>'rowResultHash' IS DISTINCT FROM p.row_result_hash::text OR p.manifest->>'previewHash' IS DISTINCT FROM p.preview_hash::text OR
       (p.manifest->>'retainUntil')::timestamptz IS DISTINCT FROM p.retain_until OR p.manifest->'summary' IS DISTINCT FROM p.summary OR
       (p.summary->>'found')::integer IS DISTINCT FROM n OR (p.summary->>'valid')::integer IS DISTINCT FROM v OR
       (p.summary->>'rejected')::integer IS DISTINCT FROM r OR (p.summary->>'withError')::integer IS DISTINCT FROM r OR p.summary->>'rowResultHash' IS DISTINCT FROM p.row_result_hash::text
    THEN RAISE EXCEPTION 'invalid preview manifest'; END IF;
    IF EXISTS (SELECT 1 FROM public.src_import_staging_row st WHERE st.batch_id=b.id AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.manifest->'rows') row WHERE row->>'locator'=st.locator AND row->>'sourceRowHash'=st.source_row_hash AND row->'normalizedPayload'=st.normalized_payload AND row->'sourceValues'=st.source_values AND row->'decimalSources'=st.decimal_sources AND (CASE WHEN row ? 'durationSources' THEN row->'durationSources' ELSE NULL END) IS NOT DISTINCT FROM st.duration_sources AND coalesce(row->'matchingAttributes', '{}'::jsonb)=st.matching_attributes AND row->'fieldErrors'=st.field_errors AND row->>'status'=st.status)) OR jsonb_array_length(p.manifest->'rows')<>n THEN RAISE EXCEPTION 'invalid row manifest'; END IF;
  END IF;
  IF TG_TABLE_NAME='src_import_preview_confirmation' THEN
    c:=NEW;
    IF NOT EXISTS(SELECT 1 FROM public.src_import_event WHERE preview_id=p.id AND event_type='source.import.preview_confirmed.v1') THEN RAISE EXCEPTION 'confirmation event missing'; END IF;
    IF c.confirmed_at>=p.retain_until OR c.confirmation_payload IS DISTINCT FROM jsonb_build_object(
      'confirmationId',c.id,'previewId',c.preview_id,'batchId',c.batch_id,'sourceFileId',c.source_file_id,'fileVersionId',c.file_version_id,
      'sourceSha256',c.source_sha256,'sourceFormat',c.source_format,'contentHash',c.content_hash,'rowResultHash',c.row_result_hash,
      'contractHash',c.contract_hash,'transformationHash',c.transformation_hash,'previewHash',c.preview_hash,
      'confirmedAt',c.confirmation_payload->>'confirmedAt','actor',c.actor,'status','confirmed','reused',false) OR
      (c.confirmation_payload->>'confirmedAt')::timestamptz IS DISTINCT FROM c.confirmed_at THEN RAISE EXCEPTION 'invalid confirmation payload'; END IF;
  END IF;
  IF TG_TABLE_NAME='src_import_event' THEN
    IF (NEW.event_type='source.import.preview_prepared.v1' AND NEW.occurred_at<>p.prepared_at) OR
       (NEW.event_type='source.import.preview_confirmed.v1' AND NEW.occurred_at IS DISTINCT FROM (SELECT confirmed_at FROM public.src_import_preview_confirmation WHERE preview_id=p.id)) OR NEW.actor<>b.actor OR (NEW.event_type='source.import.preview_rejected.v1' AND (b.status<>'Rejeitado' OR NEW.entity_id<>b.id OR NEW.payload<>jsonb_build_object('code',b.rejection_code))) OR
      (NEW.event_type<>'source.import.preview_rejected.v1' AND (b.status<>'Validado' OR NEW.entity_id<>p.id OR NEW.preview_id<>p.id)) OR
      (NEW.event_type='source.import.preview_prepared.v1' AND NEW.payload<>jsonb_build_object('contentHash',p.content_hash,'rowResultHash',p.row_result_hash,'previewHash',p.preview_hash)) OR
      (NEW.event_type='source.import.preview_confirmed.v1' AND (NEW.payload<>jsonb_build_object('previewHash',p.preview_hash) OR NOT EXISTS(SELECT 1 FROM public.src_import_preview_confirmation WHERE preview_id=p.id))) THEN RAISE EXCEPTION 'invalid import event'; END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE UNIQUE INDEX src_import_preview_reconciliation_graph_key
  ON src_import_preview(id, batch_id, source_file_id);
CREATE UNIQUE INDEX src_import_preview_confirmation_reconciliation_graph_key
  ON src_import_preview_confirmation(id, preview_id, batch_id, source_file_id, source_sha256, contract_hash, transformation_hash, preview_hash);

CREATE TABLE src_stable_record (
  id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disregarded')),
  matching_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CHECK (jsonb_typeof(matching_attributes) = 'object' AND NOT source_reconciliation_has_reserved_key(matching_attributes))
);
CREATE INDEX src_stable_record_matching_attributes_idx
  ON src_stable_record USING gin (matching_attributes jsonb_path_ops);

CREATE TABLE src_source_observation (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  preview_id uuid NOT NULL REFERENCES src_import_preview(id) ON DELETE RESTRICT,
  source_file_id uuid NOT NULL REFERENCES source_file(id) ON DELETE RESTRICT,
  locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 200),
  source_row_hash char(64) NOT NULL CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  functional_hash char(64) NOT NULL CHECK (functional_hash ~ '^[0-9a-f]{64}$'),
  normalized_payload jsonb NOT NULL,
  source_values jsonb NOT NULL,
  decimal_sources jsonb,
  duration_sources jsonb,
  matching_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(matching_attributes) = 'object' AND NOT source_reconciliation_has_reserved_key(matching_attributes)),
  stable_record_id uuid REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (preview_id, batch_id, source_file_id)
    REFERENCES src_import_preview(id, batch_id, source_file_id) ON DELETE RESTRICT,
  UNIQUE (batch_id, locator),
  UNIQUE (id, preview_id, batch_id, source_file_id),
  CHECK (jsonb_typeof(normalized_payload) = 'object' AND NOT source_reconciliation_has_reserved_key(normalized_payload)),
  CHECK (jsonb_typeof(source_values) = 'object' AND NOT source_reconciliation_has_reserved_key(source_values)),
  CHECK (source_reconciliation_valid_decimal_sources(decimal_sources)),
  CHECK (source_reconciliation_valid_duration_sources(duration_sources))
);
CREATE INDEX src_source_observation_preview_idx ON src_source_observation(preview_id, locator, id);
CREATE INDEX src_source_observation_record_idx ON src_source_observation(stable_record_id, observed_at, id);

CREATE TABLE src_record_match (
  id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 120),
  outcome text NOT NULL CHECK (outcome IN ('unique', 'none', 'multiple')),
  candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_ids) = 'array'),
  matched_record_id uuid REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  UNIQUE (observation_id, policy_version, revision_no),
  CHECK ((outcome = 'unique' AND matched_record_id IS NOT NULL) OR (outcome <> 'unique' AND matched_record_id IS NULL))
);

CREATE TABLE src_reconciliation (
  id uuid PRIMARY KEY,
  confirmation_id uuid NOT NULL REFERENCES src_import_preview_confirmation(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  preview_id uuid NOT NULL REFERENCES src_import_preview(id) ON DELETE RESTRICT,
  source_file_id uuid NOT NULL REFERENCES source_file(id) ON DELETE RESTRICT,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  contract_hash char(64) NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  transformation_hash char(64) NOT NULL CHECK (transformation_hash ~ '^[0-9a-f]{64}$'),
  preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  root_request_hash char(64) NOT NULL CHECK (root_request_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 120),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  base_projection_version bigint NOT NULL CHECK (base_projection_version >= 0),
  parent_reconciliation_id uuid REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  revision_no bigint NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  status text NOT NULL CHECK (status IN ('draft', 'needs-decision', 'ready-to-apply', 'applied')),
  fingerprint char(64) NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  decisions_hash char(64) NOT NULL CHECK (decisions_hash ~ '^[0-9a-f]{64}$'),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  created_at timestamptz NOT NULL,
  UNIQUE (parent_reconciliation_id, revision_no),
  CHECK (policy::text !~* '"(?:curso|trilha)"'),
  FOREIGN KEY (confirmation_id, preview_id, batch_id, source_file_id, source_sha256, contract_hash, transformation_hash, preview_hash)
    REFERENCES src_import_preview_confirmation(id, preview_id, batch_id, source_file_id, source_sha256, contract_hash, transformation_hash, preview_hash) ON DELETE RESTRICT
);
ALTER TABLE src_reconciliation ADD CONSTRAINT src_reconciliation_graph_key UNIQUE (id, preview_id, batch_id, source_file_id);
-- Decision revisions carry one changed line and the derived aggregates. The
-- immutable root keeps the confirmed graph; children do not copy N matches,
-- conflicts, observations, or the full line array for every decision.
ALTER TABLE src_reconciliation
  ADD COLUMN manifest_delta jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(manifest_delta) = 'object'),
  ADD COLUMN lineage_id uuid REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  ADD COLUMN decision_count integer NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  ADD COLUMN metrics jsonb NOT NULL DEFAULT '{"decimalSums":{},"durationSums":{}}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  ADD COLUMN metric_accumulator_hash char(64) NOT NULL DEFAULT repeat('0',64) CHECK (metric_accumulator_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX src_reconciliation_confirmation_idx ON src_reconciliation(confirmation_id, created_at, id);
CREATE INDEX src_reconciliation_lineage_leaf_idx ON src_reconciliation(lineage_id, revision_no DESC, created_at DESC, id DESC);
CREATE UNIQUE INDEX src_reconciliation_one_child_idx ON src_reconciliation(parent_reconciliation_id) WHERE parent_reconciliation_id IS NOT NULL;

CREATE TABLE src_import_conflict (
  id uuid PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  observation_id uuid NOT NULL REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code IN ('NO_CANDIDATE', 'MULTIPLE_CANDIDATES', 'PROTECTED_LAYER', 'DISREGARDED_RECORD', 'DUPLICATE_TARGET')),
  candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_ids) = 'array'),
  current_layer text CHECK (current_layer IS NULL OR current_layer IN ('source', 'adjustment', 'decision')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  UNIQUE (reconciliation_id, observation_id, code)
);

ALTER TABLE src_record_match
  ADD COLUMN preview_id uuid NOT NULL,
  ADD COLUMN batch_id uuid NOT NULL,
  ADD COLUMN source_file_id uuid NOT NULL,
  ADD CONSTRAINT src_record_match_observation_graph_fk
    FOREIGN KEY (observation_id, preview_id, batch_id, source_file_id)
    REFERENCES src_source_observation(id, preview_id, batch_id, source_file_id) ON DELETE RESTRICT;
ALTER TABLE src_import_conflict
  ADD COLUMN preview_id uuid NOT NULL,
  ADD COLUMN batch_id uuid NOT NULL,
  ADD COLUMN source_file_id uuid NOT NULL,
  ADD CONSTRAINT src_import_conflict_reconciliation_graph_fk
    FOREIGN KEY (reconciliation_id, preview_id, batch_id, source_file_id)
    REFERENCES src_reconciliation(id, preview_id, batch_id, source_file_id) ON DELETE RESTRICT,
  ADD CONSTRAINT src_import_conflict_observation_graph_fk
    FOREIGN KEY (observation_id, preview_id, batch_id, source_file_id)
    REFERENCES src_source_observation(id, preview_id, batch_id, source_file_id) ON DELETE RESTRICT;

CREATE TABLE src_reconciliation_decision (
  id uuid PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  observation_id uuid NOT NULL REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 200),
  -- create decisions carry the service allocated UUID before the stable row
  -- exists; application inserts that row atomically after locking the graph.
  stable_record_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('link', 'create', 'keep-current', 'reject')),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  decided_at timestamptz NOT NULL,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 120),
  rationale text NOT NULL CHECK (length(btrim(rationale)) BETWEEN 3 AND 1000),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 120),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  UNIQUE (reconciliation_id, observation_id, revision_no),
  CHECK ((outcome IN ('link', 'keep-current', 'create') AND stable_record_id IS NOT NULL) OR (outcome = 'reject' AND stable_record_id IS NULL))
);
ALTER TABLE src_reconciliation_decision
  ADD COLUMN preview_id uuid NOT NULL,
  ADD COLUMN batch_id uuid NOT NULL,
  ADD COLUMN source_file_id uuid NOT NULL,
  ADD COLUMN lineage_id uuid REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  ADD CONSTRAINT src_reconciliation_decision_reconciliation_graph_fk
    FOREIGN KEY (reconciliation_id, preview_id, batch_id, source_file_id)
    REFERENCES src_reconciliation(id, preview_id, batch_id, source_file_id) ON DELETE RESTRICT,
  ADD CONSTRAINT src_reconciliation_decision_observation_graph_fk
    FOREIGN KEY (observation_id, preview_id, batch_id, source_file_id)
    REFERENCES src_source_observation(id, preview_id, batch_id, source_file_id) ON DELETE RESTRICT;
CREATE INDEX src_reconciliation_decision_line_idx
  ON src_reconciliation_decision(lineage_id, observation_id, locator, revision_no DESC);

CREATE TABLE src_reconciliation_line_state (
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  reconciliation_revision bigint NOT NULL CHECK (reconciliation_revision > 0),
  observation_id uuid NOT NULL REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 200),
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  line jsonb NOT NULL CHECK (jsonb_typeof(line) = 'object'),
  target_id uuid,
  accepted_target_id uuid,
  absence_target_id uuid,
  pending_decision boolean NOT NULL,
  category text NOT NULL CHECK (category IN ('inserted', 'updated', 'unchanged', 'rejected', 'conflict')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (reconciliation_id, observation_id, locator),
  UNIQUE (lineage_id, observation_id, locator, reconciliation_revision)
);
CREATE INDEX src_reconciliation_line_latest_idx
  ON src_reconciliation_line_state(lineage_id, observation_id, locator, reconciliation_revision DESC);
CREATE INDEX src_reconciliation_line_target_idx
  ON src_reconciliation_line_state(lineage_id, target_id, reconciliation_revision DESC) WHERE target_id IS NOT NULL;
CREATE INDEX src_reconciliation_line_absence_target_idx
  ON src_reconciliation_line_state(lineage_id, absence_target_id, reconciliation_revision DESC) WHERE absence_target_id IS NOT NULL;

CREATE TABLE src_reconciliation_head (
  lineage_id uuid PRIMARY KEY REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  leaf_reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  revision_no bigint NOT NULL CHECK (revision_no > 0),
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX src_reconciliation_head_leaf_idx ON src_reconciliation_head(leaf_reconciliation_id);
CREATE TABLE src_reconciliation_line_head (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  observation_id uuid NOT NULL REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  locator text NOT NULL,
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  reconciliation_revision bigint NOT NULL,
  ordinal bigint NOT NULL,
  line jsonb NOT NULL CHECK (jsonb_typeof(line) = 'object'),
  target_id uuid,
  accepted_target_id uuid,
  absence_target_id uuid,
  pending_decision boolean NOT NULL,
  category text NOT NULL,
  PRIMARY KEY (lineage_id, observation_id, locator)
);
CREATE INDEX src_reconciliation_line_head_target_idx ON src_reconciliation_line_head(lineage_id, target_id) WHERE target_id IS NOT NULL;
CREATE INDEX src_reconciliation_line_head_accepted_target_idx ON src_reconciliation_line_head(lineage_id, accepted_target_id) WHERE accepted_target_id IS NOT NULL;
CREATE INDEX src_reconciliation_line_head_absence_idx ON src_reconciliation_line_head(lineage_id, absence_target_id) WHERE absence_target_id IS NOT NULL;
CREATE TABLE src_reconciliation_observed_target_head (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL,
  reference_count integer NOT NULL CHECK (reference_count >= 0),
  PRIMARY KEY (lineage_id, stable_record_id)
);
CREATE TABLE src_reconciliation_target_bucket_head (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL,
  reference_count integer NOT NULL CHECK(reference_count>0),
  PRIMARY KEY(lineage_id,stable_record_id)
);
CREATE TABLE src_reconciliation_target_bucket_transition (
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL,
  reference_delta integer NOT NULL,
  reference_count integer NOT NULL CHECK(reference_count>=0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(reconciliation_id,stable_record_id)
);
CREATE INDEX src_reconciliation_target_bucket_transition_latest_idx ON src_reconciliation_target_bucket_transition(lineage_id,stable_record_id,created_at DESC,reconciliation_id);

CREATE TABLE src_reconciliation_absence_head (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status = 'not_observed_this_batch'),
  label text NOT NULL,
  effective_payload jsonb NOT NULL,
  effective_version text,
  PRIMARY KEY (lineage_id, stable_record_id)
);
CREATE INDEX src_reconciliation_absence_head_page_idx ON src_reconciliation_absence_head(lineage_id, stable_record_id);
-- Rebuildable temporal index over the append-only absence transition ledger.
CREATE TABLE src_reconciliation_absence_span (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  valid_from_revision bigint NOT NULL,
  valid_to_revision bigint,
  status text NOT NULL CHECK (status='not_observed_this_batch'),
  label text NOT NULL,
  effective_payload jsonb NOT NULL,
  effective_version text,
  PRIMARY KEY(lineage_id,stable_record_id,valid_from_revision),
  CHECK(valid_to_revision IS NULL OR valid_to_revision>valid_from_revision)
);
CREATE INDEX src_reconciliation_absence_span_page_idx ON src_reconciliation_absence_span(lineage_id,stable_record_id,valid_from_revision DESC,valid_to_revision);
CREATE UNIQUE INDEX src_reconciliation_absence_span_one_open_idx ON src_reconciliation_absence_span(lineage_id,stable_record_id) WHERE valid_to_revision IS NULL;
CREATE OR REPLACE FUNCTION validate_source_reconciliation_absence_span() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior_tid tid;
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Only the application may close an open derived span. Immutable absence
    -- transitions authenticate every business field and both revision bounds.
    IF session_user <> 'tria_app' OR OLD.valid_to_revision IS NOT NULL OR NEW.valid_to_revision IS NULL OR
       NEW.lineage_id IS DISTINCT FROM OLD.lineage_id OR NEW.stable_record_id IS DISTINCT FROM OLD.stable_record_id OR
       NEW.valid_from_revision IS DISTINCT FROM OLD.valid_from_revision OR NEW.status IS DISTINCT FROM OLD.status OR
       NEW.label IS DISTINCT FROM OLD.label OR NEW.effective_payload IS DISTINCT FROM OLD.effective_payload OR
       NEW.effective_version IS DISTINCT FROM OLD.effective_version THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='reconciliation absence span is append-only except for system closure';
    END IF;
    prior_tid:=OLD.ctid;
  END IF;
  IF EXISTS(SELECT 1 FROM public.src_reconciliation_absence_span s WHERE s.lineage_id=NEW.lineage_id AND s.stable_record_id=NEW.stable_record_id
    AND (prior_tid IS NULL OR s.ctid<>prior_tid) AND int8range(s.valid_from_revision,s.valid_to_revision,'[)') && int8range(NEW.valid_from_revision,NEW.valid_to_revision,'[)')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='reconciliation absence spans overlap';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER src_reconciliation_absence_span_guard BEFORE INSERT OR UPDATE ON src_reconciliation_absence_span
  FOR EACH ROW EXECUTE FUNCTION validate_source_reconciliation_absence_span();
CREATE TABLE src_reconciliation_metric_head (
  lineage_id uuid PRIMARY KEY REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  accumulator jsonb NOT NULL CHECK (jsonb_typeof(accumulator) = 'object'),
  updated_at timestamptz NOT NULL
);

CREATE TABLE src_effective_record_event (
  id uuid PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  observation_id uuid REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('record.inserted', 'observation.accepted', 'adjustment.revised', 'decision.audit')),
  layer text NOT NULL CHECK (layer IN ('source', 'adjustment', 'decision')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disregarded')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND NOT source_reconciliation_has_reserved_key(payload)),
  decimal_sources jsonb CHECK (source_reconciliation_valid_decimal_sources(decimal_sources)),
  duration_sources jsonb CHECK (source_reconciliation_valid_duration_sources(duration_sources)),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  occurred_at timestamptz NOT NULL,
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 200),
  decision_id uuid REFERENCES src_reconciliation_decision(id) ON DELETE RESTRICT,
  decision_rationale text,
  decision_version text,
  decision_decided_at timestamptz,
  CHECK ((event_type = 'decision.audit' AND decision_id IS NOT NULL AND decision_rationale IS NOT NULL AND decision_version IS NOT NULL AND decision_decided_at IS NOT NULL) OR event_type <> 'decision.audit'),
  UNIQUE (reconciliation_id, observation_id, event_type)
);
CREATE INDEX src_effective_record_event_record_idx ON src_effective_record_event(record_id, occurred_at, id);
CREATE INDEX src_effective_record_event_source_lookup_idx
  ON src_effective_record_event(record_id, observation_id, occurred_at DESC, id DESC)
  INCLUDE (payload, decimal_sources, duration_sources)
  WHERE layer = 'source' AND event_type IN ('record.inserted', 'observation.accepted');

CREATE TABLE src_projection_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL CHECK (version >= 0)
);
INSERT INTO src_projection_version (singleton, version) VALUES (true, 0);

CREATE TABLE src_effective_record_projection (
  record_id uuid PRIMARY KEY REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND NOT source_reconciliation_has_reserved_key(payload)),
  decimal_sources jsonb CHECK (source_reconciliation_valid_decimal_sources(decimal_sources)),
  duration_sources jsonb CHECK (source_reconciliation_valid_duration_sources(duration_sources)),
  source_observation_id uuid REFERENCES src_source_observation(id) ON DELETE RESTRICT,
  adjustment_event_id uuid REFERENCES src_effective_record_event(id) ON DELETE RESTRICT,
  decision_event_id uuid REFERENCES src_effective_record_event(id) ON DELETE RESTRICT,
  observed_batch_id uuid REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('active', 'disregarded')),
  version bigint NOT NULL CHECK (version >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE src_reconciliation_application (
  id uuid PRIMARY KEY,
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_id uuid NOT NULL,
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  applied_at timestamptz NOT NULL,
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  event_count integer NOT NULL CHECK (event_count >= 0),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  audit_payload jsonb NOT NULL CHECK (jsonb_typeof(audit_payload) = 'object')
);

-- A confirmation can have many immutable revisions, but only one of them may
-- become an applied result. This narrow registry makes that invariant
-- enforceable in PostgreSQL even when transport idempotency keys differ.
CREATE TABLE src_reconciliation_confirmation_application (
  confirmation_id uuid PRIMARY KEY REFERENCES src_import_preview_confirmation(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  applied_at timestamptz NOT NULL
);

-- Recovery keys are allocated by PostgreSQL, rather than by a process-local
-- map. The row is intentionally tiny and mutable only through the
-- SECURITY DEFINER allocator below; it survives a web restart and is
-- serialized with the confirmation identity.
CREATE TABLE src_reconciliation_recovery_attempt (
  confirmation_id uuid PRIMARY KEY REFERENCES src_import_preview_confirmation(id) ON DELETE RESTRICT,
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  attempt bigint NOT NULL CHECK (attempt > 0),
  allocated_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION next_source_reconciliation_recovery_attempt(
  p_confirmation_id uuid, p_projection_version bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  next_attempt bigint;
  current_projection_version bigint;
BEGIN
  IF session_user <> 'tria_app' OR p_confirmation_id IS NULL OR p_projection_version IS NULL OR p_projection_version < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'recovery allocator is restricted to the application role';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:confirmation:' || p_confirmation_id::text, 7824001));
  IF NOT EXISTS (SELECT 1 FROM public.src_import_preview_confirmation WHERE id = p_confirmation_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'recovery confirmation not found';
  END IF;
  SELECT version INTO current_projection_version
  FROM public.src_projection_version WHERE singleton FOR SHARE;
  IF current_projection_version IS DISTINCT FROM p_projection_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'recovery projection version changed';
  END IF;
  INSERT INTO public.src_reconciliation_recovery_attempt (confirmation_id, projection_version, attempt, allocated_at)
    VALUES (p_confirmation_id, p_projection_version, 1, clock_timestamp())
    ON CONFLICT (confirmation_id) DO UPDATE
      SET projection_version = EXCLUDED.projection_version,
          attempt = public.src_reconciliation_recovery_attempt.attempt + 1,
          allocated_at = EXCLUDED.allocated_at
    RETURNING attempt INTO next_attempt;
  RETURN next_attempt;
END;
$$;

CREATE TABLE src_reconciliation_absence (
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  reconciliation_revision bigint NOT NULL CHECK (reconciliation_revision > 0),
  stable_record_id uuid NOT NULL REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  present boolean NOT NULL,
  ordinal bigint,
  status text CHECK (status IS NULL OR status = 'not_observed_this_batch'),
  label text,
  effective_payload jsonb,
  effective_version text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (reconciliation_id, stable_record_id),
  CHECK ((present AND ordinal IS NOT NULL AND status = 'not_observed_this_batch' AND label IS NOT NULL AND effective_payload IS NOT NULL)
    OR (NOT present AND ordinal IS NULL AND status IS NULL AND label IS NULL AND effective_payload IS NULL AND effective_version IS NULL))
);
CREATE INDEX src_reconciliation_absence_page_idx
  ON src_reconciliation_absence(reconciliation_id, stable_record_id) WHERE present;
CREATE INDEX src_reconciliation_absence_record_idx
  ON src_reconciliation_absence(stable_record_id, reconciliation_id);
CREATE INDEX src_reconciliation_absence_history_idx
  ON src_reconciliation_absence(lineage_id,stable_record_id,reconciliation_revision DESC);
CREATE TABLE src_reconciliation_absence_key (
  lineage_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  stable_record_id uuid NOT NULL REFERENCES src_stable_record(id) ON DELETE RESTRICT,
  PRIMARY KEY(lineage_id,stable_record_id)
);

CREATE TABLE src_reconciliation_absence_node (
  id uuid PRIMARY KEY,
  lineage_id uuid NOT NULL,
  stable_record_id uuid NOT NULL,
  item jsonb NOT NULL,
  left_id uuid,
  right_id uuid,
  height smallint NOT NULL CHECK(height BETWEEN 1 AND 32767),
  subtree_count bigint NOT NULL CHECK(subtree_count>0),
  subtree_min uuid NOT NULL,
  subtree_max uuid NOT NULL,
  node_hash bytea NOT NULL CHECK(octet_length(node_hash)=32),
  created_revision bigint NOT NULL CHECK(created_revision>0),
  UNIQUE(lineage_id,id),
  CHECK(left_id IS NULL OR left_id<>id),CHECK(right_id IS NULL OR right_id<>id),
  CHECK(subtree_min<=stable_record_id AND stable_record_id<=subtree_max),
  CHECK(jsonb_typeof(item)='object' AND item->>'stableRecordId'=stable_record_id::text AND item->>'status'='not_observed_this_batch')
);
ALTER TABLE src_reconciliation_absence_node ADD CONSTRAINT src_reconciliation_absence_node_left_fk FOREIGN KEY(lineage_id,left_id) REFERENCES src_reconciliation_absence_node(lineage_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE src_reconciliation_absence_node ADD CONSTRAINT src_reconciliation_absence_node_right_fk FOREIGN KEY(lineage_id,right_id) REFERENCES src_reconciliation_absence_node(lineage_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX src_reconciliation_absence_node_key_idx ON src_reconciliation_absence_node(lineage_id,stable_record_id,id);
ALTER TABLE src_reconciliation ADD COLUMN absence_root_id uuid;
ALTER TABLE src_reconciliation ADD COLUMN absence_root_hash bytea NOT NULL CHECK(octet_length(absence_root_hash)=32);
ALTER TABLE src_reconciliation ADD COLUMN absence_count bigint NOT NULL CHECK(absence_count>=0);
ALTER TABLE src_reconciliation ADD COLUMN absence_min uuid;
ALTER TABLE src_reconciliation ADD COLUMN absence_max uuid;
ALTER TABLE src_reconciliation ADD COLUMN absence_commitment bytea NOT NULL CHECK(octet_length(absence_commitment)=32);
ALTER TABLE src_reconciliation ADD CONSTRAINT src_reconciliation_absence_root_fk FOREIGN KEY(lineage_id,absence_root_id) REFERENCES src_reconciliation_absence_node(lineage_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE src_reconciliation ADD CONSTRAINT src_reconciliation_absence_shape CHECK ((absence_count=0 AND absence_root_id IS NULL AND absence_min IS NULL AND absence_max IS NULL) OR (absence_count>0 AND absence_root_id IS NOT NULL AND absence_min IS NOT NULL AND absence_max IS NOT NULL AND absence_min<=absence_max));

-- This is the narrow server-side counterpart of the reconciliation fingerprint
-- used by the application.  It serializes only the immutable graph identity
-- (lineage, policy, base version and decisions), so a caller cannot choose an
-- arbitrary fingerprint while retaining a valid-looking graph.
CREATE OR REPLACE FUNCTION source_reconciliation_json_text(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN p_value IS NULL THEN 'null' ELSE to_jsonb(p_value)::text END
$$;

-- The application sends a JSON graph, but JSONB text is not RFC 8785: it
-- contains presentation spaces and its object order is an implementation
-- detail. These small recursive helpers keep the immutable observation
-- identity/hash derivations equal to the TypeScript canonical hash.
CREATE OR REPLACE FUNCTION source_reconciliation_jcs(p_value jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $jcs$
DECLARE
  kind text;
  rendered text;
BEGIN
  IF p_value IS NULL THEN RETURN 'null'; END IF;
  kind := jsonb_typeof(p_value);
  IF kind = 'number' AND (p_value::text !~ '^-?(0|[1-9][0-9]*)$' OR abs((p_value::text)::numeric)>9007199254740991) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='canonical JSON numbers must be safe integers';
  END IF;
  IF kind = 'null' OR kind IN ('string', 'number', 'boolean') THEN RETURN p_value::text; END IF;
  IF kind = 'array' THEN
    SELECT coalesce('[' || string_agg(source_reconciliation_jcs(value), ',' ORDER BY ordinal) || ']', '[]')
      INTO rendered
    FROM jsonb_array_elements(p_value) WITH ORDINALITY items(value, ordinal);
    RETURN rendered;
  END IF;
  IF kind = 'object' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) key WHERE key !~ '^[ -~]+$') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='canonical JSON object keys must be ASCII';
  END IF;
  IF kind = 'object' THEN
    SELECT coalesce('{' || string_agg(to_jsonb(key)::text || ':' || source_reconciliation_jcs(value), ',' ORDER BY key COLLATE "C") || '}', '{}')
      INTO rendered
    FROM jsonb_each(p_value) items(key, value);
    RETURN rendered;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported canonical JSON value';
END;
$jcs$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_empty_hash() RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to('TRIA/source-reconciliation/absence-avl/empty/v1','utf8')) $$;
CREATE OR REPLACE FUNCTION source_reconciliation_avl_node_hash(p_key uuid,p_item jsonb,p_left bytea,p_right bytea,p_height smallint,p_count bigint,p_min uuid,p_max uuid)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT sha256(convert_to('TRIA/source-reconciliation/absence-avl/node/v1','utf8')||uuid_send(p_key)||sha256(convert_to(source_reconciliation_jcs(p_item),'utf8'))||coalesce(p_left,source_reconciliation_avl_empty_hash())||coalesce(p_right,source_reconciliation_avl_empty_hash())||int2send(p_height)||int8send(p_count)||uuid_send(p_min)||uuid_send(p_max)) $$;
CREATE OR REPLACE FUNCTION source_reconciliation_avl_commitment(p_root_hash bytea,p_count bigint,p_min uuid,p_max uuid)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to('TRIA/source-reconciliation/absence-avl/root/v1','utf8')||p_root_hash||int8send(p_count)||CASE WHEN p_min IS NULL THEN decode('00','hex') ELSE decode('01','hex')||uuid_send(p_min) END||CASE WHEN p_max IS NULL THEN decode('00','hex') ELSE decode('01','hex')||uuid_send(p_max) END) $$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_load_verified_node(p_lineage uuid,p_id uuid)
RETURNS public.src_reconciliation_absence_node LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $load_verified_node$
DECLARE n public.src_reconciliation_absence_node%ROWTYPE;l public.src_reconciliation_absence_node%ROWTYPE;r public.src_reconciliation_absence_node%ROWTYPE;eh smallint;ec bigint;emin uuid;emax uuid;
BEGIN
 SELECT * INTO n FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='authenticated absence node is missing';END IF;
 IF n.left_id IS NOT NULL THEN SELECT * INTO l FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=n.left_id;IF NOT FOUND OR l.subtree_max>=n.stable_record_id THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='authenticated absence left link is invalid';END IF;END IF;
 IF n.right_id IS NOT NULL THEN SELECT * INTO r FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=n.right_id;IF NOT FOUND OR r.subtree_min<=n.stable_record_id THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='authenticated absence right link is invalid';END IF;END IF;
 eh:=greatest(coalesce(l.height,0),coalesce(r.height,0))+1;ec:=coalesce(l.subtree_count,0)+coalesce(r.subtree_count,0)+1;emin:=coalesce(l.subtree_min,n.stable_record_id);emax:=coalesce(r.subtree_max,n.stable_record_id);
 IF abs(coalesce(l.height,0)-coalesce(r.height,0))>1 OR n.height<>eh OR n.subtree_count<>ec OR n.subtree_min<>emin OR n.subtree_max<>emax OR n.node_hash<>source_reconciliation_avl_node_hash(n.stable_record_id,n.item,l.node_hash,r.node_hash,eh,ec,emin,emax) THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='authenticated absence node is corrupt';END IF;
 RETURN n;
END;$load_verified_node$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_verify_node(p_lineage uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $verify_node$
BEGIN
 PERFORM source_reconciliation_avl_load_verified_node(p_lineage,p_id);RETURN true;
END;$verify_node$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_make_node(p_lineage uuid,p_revision bigint,p_key uuid,p_item jsonb,p_left uuid,p_right uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $make_node$
DECLARE l public.src_reconciliation_absence_node%ROWTYPE;r public.src_reconciliation_absence_node%ROWTYPE;nid uuid:=gen_random_uuid();h smallint;c bigint;mn uuid;mx uuid;
BEGIN
 IF p_left IS NOT NULL THEN PERFORM source_reconciliation_avl_verify_node(p_lineage,p_left);SELECT * INTO l FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_left;END IF;
 IF p_right IS NOT NULL THEN PERFORM source_reconciliation_avl_verify_node(p_lineage,p_right);SELECT * INTO r FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_right;END IF;
 IF (p_left IS NOT NULL AND l.subtree_max>=p_key) OR (p_right IS NOT NULL AND r.subtree_min<=p_key) THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='authenticated absence BST order is invalid';END IF;
 h:=greatest(coalesce(l.height,0),coalesce(r.height,0))+1;c:=coalesce(l.subtree_count,0)+coalesce(r.subtree_count,0)+1;mn:=coalesce(l.subtree_min,p_key);mx:=coalesce(r.subtree_max,p_key);
 INSERT INTO public.src_reconciliation_absence_node(id,lineage_id,stable_record_id,item,left_id,right_id,height,subtree_count,subtree_min,subtree_max,node_hash,created_revision) VALUES(nid,p_lineage,p_key,p_item,p_left,p_right,h,c,mn,mx,source_reconciliation_avl_node_hash(p_key,p_item,l.node_hash,r.node_hash,h,c,mn,mx),p_revision);
 RETURN nid;
END;$make_node$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_build(p_lineage uuid,p_revision bigint,p_items jsonb,p_lo integer,p_hi integer)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $build$
DECLARE mid integer;item jsonb;lid uuid;rid uuid;
BEGIN IF p_lo>p_hi THEN RETURN NULL;END IF;mid:=(p_lo+p_hi)/2;item:=p_items->mid;lid:=source_reconciliation_avl_build(p_lineage,p_revision,p_items,p_lo,mid-1);rid:=source_reconciliation_avl_build(p_lineage,p_revision,p_items,mid+1,p_hi);RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,(item->>'stableRecordId')::uuid,item,lid,rid);END;$build$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_rebalance(p_lineage uuid,p_revision bigint,p_key uuid,p_item jsonb,p_left uuid,p_right uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $rebalance$
DECLARE l public.src_reconciliation_absence_node%ROWTYPE;r public.src_reconciliation_absence_node%ROWTYPE;c public.src_reconciliation_absence_node%ROWTYPE;lh int:=0;rh int:=0;ch1 int;ch2 int;n1 uuid;n2 uuid;
BEGIN
 IF p_left IS NOT NULL THEN PERFORM source_reconciliation_avl_verify_node(p_lineage,p_left);SELECT * INTO l FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_left;lh:=l.height;END IF;
 IF p_right IS NOT NULL THEN PERFORM source_reconciliation_avl_verify_node(p_lineage,p_right);SELECT * INTO r FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_right;rh:=r.height;END IF;
 IF lh-rh>1 THEN
   SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=l.left_id;ch1:=coalesce(c.height,0);
   SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=l.right_id;ch2:=coalesce(c.height,0);
   IF ch1>=ch2 THEN n2:=source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,l.right_id,p_right);RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,l.stable_record_id,l.item,l.left_id,n2);
   ELSE SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=l.right_id;n1:=source_reconciliation_avl_make_node(p_lineage,p_revision,l.stable_record_id,l.item,l.left_id,c.left_id);n2:=source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,c.right_id,p_right);RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,c.stable_record_id,c.item,n1,n2);END IF;
 ELSIF rh-lh>1 THEN
   SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=r.left_id;ch1:=coalesce(c.height,0);
   SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=r.right_id;ch2:=coalesce(c.height,0);
   IF ch2>=ch1 THEN n1:=source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,p_left,r.left_id);RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,r.stable_record_id,r.item,n1,r.right_id);
   ELSE SELECT * INTO c FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=r.left_id;n1:=source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,p_left,c.left_id);n2:=source_reconciliation_avl_make_node(p_lineage,p_revision,r.stable_record_id,r.item,c.right_id,r.right_id);RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,c.stable_record_id,c.item,n1,n2);END IF;
 END IF;
 RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,p_left,p_right);
END;$rebalance$;

CREATE OR REPLACE FUNCTION source_reconciliation_avl_set(p_lineage uuid,p_revision bigint,p_root uuid,p_key uuid,p_item jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $set$
DECLARE n public.src_reconciliation_absence_node%ROWTYPE;s public.src_reconciliation_absence_node%ROWTYPE;child uuid;cursor uuid;
BEGIN
 IF p_root IS NULL THEN IF p_item IS NULL THEN RETURN NULL;END IF;RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,NULL,NULL);END IF;
 PERFORM source_reconciliation_avl_verify_node(p_lineage,p_root);SELECT * INTO n FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=p_root;
 IF p_key<n.stable_record_id THEN child:=source_reconciliation_avl_set(p_lineage,p_revision,n.left_id,p_key,p_item);RETURN source_reconciliation_avl_rebalance(p_lineage,p_revision,n.stable_record_id,n.item,child,n.right_id);
 ELSIF p_key>n.stable_record_id THEN child:=source_reconciliation_avl_set(p_lineage,p_revision,n.right_id,p_key,p_item);RETURN source_reconciliation_avl_rebalance(p_lineage,p_revision,n.stable_record_id,n.item,n.left_id,child);
 ELSIF p_item IS NOT NULL THEN RETURN source_reconciliation_avl_make_node(p_lineage,p_revision,p_key,p_item,n.left_id,n.right_id);
 ELSIF n.left_id IS NULL THEN RETURN n.right_id; ELSIF n.right_id IS NULL THEN RETURN n.left_id;
 ELSE cursor:=n.right_id;LOOP PERFORM source_reconciliation_avl_verify_node(p_lineage,cursor);SELECT * INTO s FROM public.src_reconciliation_absence_node WHERE lineage_id=p_lineage AND id=cursor;EXIT WHEN s.left_id IS NULL;cursor:=s.left_id;END LOOP;child:=source_reconciliation_avl_set(p_lineage,p_revision,n.right_id,s.stable_record_id,NULL);RETURN source_reconciliation_avl_rebalance(p_lineage,p_revision,s.stable_record_id,s.item,n.left_id,child);END IF;
END;$set$;

CREATE OR REPLACE FUNCTION source_reconciliation_verify_absence_anchor(p_reconciliation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $anchor$
DECLARE rec public.src_reconciliation%ROWTYPE;n public.src_reconciliation_absence_node%ROWTYPE;expected bytea;parent public.src_reconciliation%ROWTYPE;d public.src_reconciliation_decision%ROWTYPE;decision_json jsonb;chain jsonb;commitment_json jsonb;
BEGIN SELECT * INTO rec FROM public.src_reconciliation WHERE id=p_reconciliation_id;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='absence anchor revision is missing';END IF;
 IF rec.absence_count=0 THEN IF rec.absence_root_id IS NOT NULL OR rec.absence_root_hash<>source_reconciliation_avl_empty_hash() THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='empty absence anchor is corrupt';END IF;
 ELSE n:=source_reconciliation_avl_load_verified_node(coalesce(rec.lineage_id,rec.id),rec.absence_root_id);IF n.node_hash<>rec.absence_root_hash OR n.subtree_count<>rec.absence_count OR n.subtree_min<>rec.absence_min OR n.subtree_max<>rec.absence_max THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='absence root tuple is corrupt';END IF;END IF;
 expected:=source_reconciliation_avl_commitment(rec.absence_root_hash,rec.absence_count,rec.absence_min,rec.absence_max);IF expected<>rec.absence_commitment THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='absence commitment is corrupt';END IF;
 commitment_json:=jsonb_build_object('rootHash',encode(rec.absence_root_hash,'hex'),'count',rec.absence_count::text,'min',CASE WHEN rec.absence_min IS NULL THEN NULL ELSE rec.absence_min::text END,'max',CASE WHEN rec.absence_max IS NULL THEN NULL ELSE rec.absence_max::text END,'commitment',encode(rec.absence_commitment,'hex'));
 IF rec.parent_reconciliation_id IS NULL THEN
   IF rec.id<>rec.lineage_id OR rec.revision_no<>1 OR rec.decisions_hash<>encode(sha256(convert_to('[]','utf8')),'hex') OR (SELECT count(*) FROM public.src_reconciliation_decision x WHERE x.reconciliation_id=rec.id)<>0 OR rec.manifest->'absenceCommitment' IS DISTINCT FROM commitment_json OR source_reconciliation_fingerprint(jsonb_build_object('reconciliation',jsonb_build_object('confirmationId',rec.confirmation_id::text,'previewId',rec.preview_id::text,'batchId',rec.batch_id::text,'sourceSha256',rec.source_sha256,'contractHash',rec.contract_hash,'transformationHash',rec.transformation_hash,'previewHash',rec.preview_hash,'rootRequestHash',rec.root_request_hash,'absenceCommitment',commitment_json,'policy',rec.policy,'baseProjectionVersion',rec.base_projection_version::text,'decisions','[]'::jsonb)))<>rec.fingerprint THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='base absence anchor is not committed by fingerprint';END IF;
 ELSE
   SELECT * INTO parent FROM public.src_reconciliation WHERE id=rec.parent_reconciliation_id;
   IF (SELECT count(*) FROM public.src_reconciliation_decision x WHERE x.reconciliation_id=rec.id)<>1 THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='child decision cardinality is corrupt';END IF;
   SELECT * INTO STRICT d FROM public.src_reconciliation_decision WHERE reconciliation_id=rec.id;
   IF parent.id IS NULL OR d.id IS NULL OR rec.lineage_id<>coalesce(parent.lineage_id,parent.id) OR rec.revision_no<>parent.revision_no+1 OR rec.root_request_hash<>parent.root_request_hash OR rec.manifest_delta->'absenceCommitment' IS DISTINCT FROM commitment_json THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='child absence anchor lineage is corrupt';END IF;
   SELECT value->'decision' INTO decision_json FROM jsonb_array_elements(coalesce(rec.manifest_delta->'lines','[]'::jsonb)) value WHERE value->'decision'->>'id'=d.id::text;
   IF decision_json IS NULL OR decision_json->>'observationId'<>d.observation_id::text OR decision_json->>'locator' IS DISTINCT FROM d.locator OR nullif(decision_json->>'stableRecordId','')::uuid IS DISTINCT FROM d.stable_record_id OR decision_json->>'outcome'<>d.outcome OR decision_json->>'actor'<>d.actor OR (decision_json->>'decidedAt')::timestamptz IS DISTINCT FROM d.decided_at OR decision_json->>'policyVersion'<>d.policy_version OR decision_json->>'rationale'<>d.rationale OR decision_json->>'version'<>d.version OR (decision_json->>'revisionNo')::integer<>d.revision_no THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='child physical decision is corrupt';END IF;
   decision_json:=jsonb_strip_nulls(jsonb_build_object('id',d.id::text,'observationId',d.observation_id::text,'locator',d.locator,'stableRecordId',d.stable_record_id::text,'outcome',d.outcome,'actor',d.actor,'decidedAt',d.decided_at,'policyVersion',d.policy_version,'rationale',d.rationale,'version',d.version,'revisionNo',d.revision_no));chain:=source_reconciliation_chain_hash(rec.lineage_id,parent.fingerprint,parent.decisions_hash,decision_json,rec.manifest_delta);
   IF chain->>'fingerprint'<>rec.fingerprint OR chain->>'decisionsHash'<>rec.decisions_hash THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='child absence anchor chain is corrupt';END IF;
 END IF;RETURN true;
END;$anchor$;

CREATE OR REPLACE FUNCTION source_reconciliation_absence_rows(p_reconciliation_id uuid)
RETURNS TABLE(stable_record_id uuid, item jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_reconciliation_id, revision_no FROM public.src_reconciliation WHERE id = p_reconciliation_id
    UNION ALL
    SELECT parent.id, parent.parent_reconciliation_id, parent.revision_no
    FROM public.src_reconciliation parent JOIN chain child ON child.parent_reconciliation_id = parent.id
  ), latest AS (
    SELECT DISTINCT ON (absence.stable_record_id)
      absence.stable_record_id, absence.present, absence.status, absence.label,
      absence.effective_payload, absence.effective_version
    FROM chain
    JOIN public.src_reconciliation_absence absence ON absence.reconciliation_id = chain.id
    ORDER BY absence.stable_record_id, chain.revision_no DESC
  )
  SELECT latest.stable_record_id,
    jsonb_build_object(
      'stableRecordId', latest.stable_record_id::text,
      'status', latest.status,
      'label', latest.label,
      'effectivePayload', latest.effective_payload
    ) || CASE WHEN latest.effective_version IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('effectiveVersion', latest.effective_version) END
  FROM latest
  WHERE latest.present
  ORDER BY latest.stable_record_id
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_authenticated_absence_item(
  p_lineage_id uuid,p_stable_record_id uuid,p_valid_from_revision bigint,p_expected_valid_to_revision bigint,
  p_successor_present boolean,p_status text,p_label text,p_effective_payload jsonb,p_effective_version text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE physical public.src_reconciliation_absence_span%ROWTYPE;
BEGIN
  SELECT * INTO physical FROM public.src_reconciliation_absence_span span
  WHERE span.lineage_id=p_lineage_id AND span.stable_record_id=p_stable_record_id
    AND span.valid_from_revision=p_valid_from_revision;
  IF NOT FOUND OR p_successor_present IS TRUE OR
     physical.valid_to_revision IS DISTINCT FROM p_expected_valid_to_revision OR
     physical.status IS DISTINCT FROM p_status OR physical.label IS DISTINCT FROM p_label OR
     physical.effective_payload IS DISTINCT FROM p_effective_payload OR
     physical.effective_version IS DISTINCT FROM p_effective_version THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation absence span authentication failed';
  END IF;
  RETURN jsonb_build_object('stableRecordId',p_stable_record_id::text,'status',p_status,'label',p_label,
    'effectivePayload',p_effective_payload) || CASE WHEN p_effective_version IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('effectiveVersion',p_effective_version) END;
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_absence_rows(p_reconciliation_id uuid,p_after_stable_record_id uuid,p_limit integer)
RETURNS TABLE(stable_record_id uuid,item jsonb,is_diagnostic boolean,ordinal integer,logical_node_visits integer,authenticated_node_row_reads integer,tree_height integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $page$
DECLARE
 rec public.src_reconciliation%ROWTYPE;
 n public.src_reconciliation_absence_node%ROWTYPE;
 stack_keys uuid[]:=ARRAY[]::uuid[];
 stack_items jsonb[]:=ARRAY[]::jsonb[];
 stack_rights uuid[]:=ARRAY[]::uuid[];
 cursor uuid;
 emitted integer:=0;
 logical_visits integer:=0;
 authenticated_reads integer:=0;
 anchor_read_pending boolean:=false;
 loader_reads integer;
 topn integer;
 cursor_found boolean:=false;
 root_height integer:=0;
 lineage uuid;
BEGIN
 IF session_user<>'tria_app' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='absence page is restricted to the application role';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>101 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='absence page limit must be between 1 and 101';END IF;
 SELECT * INTO rec FROM public.src_reconciliation WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='reconciliation not found';END IF;
 PERFORM source_reconciliation_verify_absence_anchor(p_reconciliation_id);
 lineage:=coalesce(rec.lineage_id,rec.id);
 logical_visits:=CASE WHEN rec.absence_root_id IS NULL THEN 0 ELSE 1 END;
 anchor_read_pending:=rec.absence_root_id IS NOT NULL;
 cursor:=rec.absence_root_id;

 IF p_after_stable_record_id IS NULL THEN
  WHILE cursor IS NOT NULL LOOP
   n:=source_reconciliation_avl_load_verified_node(lineage,cursor);
   logical_visits:=logical_visits+1;loader_reads:=1+(n.left_id IS NOT NULL)::integer+(n.right_id IS NOT NULL)::integer;authenticated_reads:=authenticated_reads+loader_reads;
   IF anchor_read_pending THEN authenticated_reads:=authenticated_reads+loader_reads;anchor_read_pending:=false;END IF;
   IF cursor=rec.absence_root_id THEN root_height:=n.height;END IF;
   stack_keys:=array_append(stack_keys,n.stable_record_id);stack_items:=array_append(stack_items,n.item);stack_rights:=array_append(stack_rights,n.right_id);
   cursor:=n.left_id;
  END LOOP;
 ELSE
  WHILE cursor IS NOT NULL LOOP
   n:=source_reconciliation_avl_load_verified_node(lineage,cursor);
   logical_visits:=logical_visits+1;loader_reads:=1+(n.left_id IS NOT NULL)::integer+(n.right_id IS NOT NULL)::integer;authenticated_reads:=authenticated_reads+loader_reads;
   IF anchor_read_pending THEN authenticated_reads:=authenticated_reads+loader_reads;anchor_read_pending:=false;END IF;
   IF cursor=rec.absence_root_id THEN root_height:=n.height;END IF;
   IF p_after_stable_record_id=n.stable_record_id THEN cursor_found:=true;cursor:=n.right_id;EXIT;
   ELSIF p_after_stable_record_id<n.stable_record_id THEN
    stack_keys:=array_append(stack_keys,n.stable_record_id);stack_items:=array_append(stack_items,n.item);stack_rights:=array_append(stack_rights,n.right_id);cursor:=n.left_id;
   ELSE cursor:=n.right_id;
   END IF;
  END LOOP;
  IF NOT cursor_found THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='absence cursor is not a member of the committed root';END IF;
  WHILE cursor IS NOT NULL LOOP
   n:=source_reconciliation_avl_load_verified_node(lineage,cursor);
   logical_visits:=logical_visits+1;loader_reads:=1+(n.left_id IS NOT NULL)::integer+(n.right_id IS NOT NULL)::integer;authenticated_reads:=authenticated_reads+loader_reads;
   stack_keys:=array_append(stack_keys,n.stable_record_id);stack_items:=array_append(stack_items,n.item);stack_rights:=array_append(stack_rights,n.right_id);cursor:=n.left_id;
  END LOOP;
 END IF;

 WHILE coalesce(array_length(stack_keys,1),0)>0 AND emitted<p_limit LOOP
  topn:=array_length(stack_keys,1);
  stable_record_id:=stack_keys[topn];item:=stack_items[topn];cursor:=stack_rights[topn];
  IF topn=1 THEN stack_keys:=ARRAY[]::uuid[];stack_items:=ARRAY[]::jsonb[];stack_rights:=ARRAY[]::uuid[];
  ELSE stack_keys:=stack_keys[1:topn-1];stack_items:=stack_items[1:topn-1];stack_rights:=stack_rights[1:topn-1];END IF;
  emitted:=emitted+1;is_diagnostic:=false;ordinal:=emitted;logical_node_visits:=NULL;authenticated_node_row_reads:=NULL;tree_height:=NULL;RETURN NEXT;
  IF emitted>=p_limit THEN EXIT;END IF;
  WHILE cursor IS NOT NULL LOOP
   n:=source_reconciliation_avl_load_verified_node(lineage,cursor);
   logical_visits:=logical_visits+1;loader_reads:=1+(n.left_id IS NOT NULL)::integer+(n.right_id IS NOT NULL)::integer;authenticated_reads:=authenticated_reads+loader_reads;
   stack_keys:=array_append(stack_keys,n.stable_record_id);stack_items:=array_append(stack_items,n.item);stack_rights:=array_append(stack_rights,n.right_id);cursor:=n.left_id;
  END LOOP;
 END LOOP;
 stable_record_id:=NULL;item:=NULL;is_diagnostic:=true;ordinal:=NULL;logical_node_visits:=logical_visits;authenticated_node_row_reads:=authenticated_reads;tree_height:=root_height;RETURN NEXT;
END;$page$;

CREATE OR REPLACE FUNCTION source_reconciliation_absence_page(p_reconciliation_id uuid,p_after_stable_record_id uuid,p_limit integer)
RETURNS TABLE(items jsonb,total_count text,has_more boolean,logical_node_visits integer,authenticated_node_row_reads integer,tree_height integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $bounded_page$
BEGIN
 IF session_user<>'tria_app' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='absence page is restricted to the application role';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='absence page limit must be between 1 and 100';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation rec WHERE rec.id=p_reconciliation_id) THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='reconciliation not found';END IF;
 RETURN QUERY
 WITH traversal AS MATERIALIZED (SELECT * FROM source_reconciliation_absence_rows(p_reconciliation_id,p_after_stable_record_id,p_limit+1))
 SELECT coalesce(jsonb_agg(traversal.item ORDER BY traversal.ordinal) FILTER(WHERE NOT traversal.is_diagnostic AND traversal.ordinal<=p_limit),'[]'::jsonb),
   rec.absence_count::text,coalesce(bool_or(NOT traversal.is_diagnostic AND traversal.ordinal>p_limit),false),
   max(traversal.logical_node_visits) FILTER(WHERE traversal.is_diagnostic),max(traversal.authenticated_node_row_reads) FILTER(WHERE traversal.is_diagnostic),max(traversal.tree_height) FILTER(WHERE traversal.is_diagnostic)
 FROM public.src_reconciliation rec CROSS JOIN traversal
 WHERE rec.id=p_reconciliation_id GROUP BY rec.absence_count;
END;$bounded_page$;

CREATE TABLE src_effective_snapshot (
  id uuid PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  projection jsonb NOT NULL CHECK (jsonb_typeof(projection) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (reconciliation_id)
);

CREATE TABLE src_reconciliation_request (
  operation text NOT NULL CHECK (operation IN ('reconcile', 'decision', 'apply')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  reconciliation_id uuid NOT NULL REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  root_reconciliation_id uuid REFERENCES src_reconciliation(id) ON DELETE RESTRICT,
  root_request_hash char(64) CHECK (root_request_hash IS NULL OR root_request_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (operation, idempotency_key),
  CHECK ((operation='reconcile' AND root_reconciliation_id=reconciliation_id AND root_request_hash IS NOT NULL) OR (operation<>'reconcile' AND root_reconciliation_id IS NULL AND root_request_hash IS NULL))
);

CREATE OR REPLACE FUNCTION prevent_source_reconciliation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'source reconciliation records are append-only';
END;
$$;

CREATE TRIGGER src_stable_record_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_stable_record FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_source_observation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_source_observation FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_record_match_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_record_match FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_import_conflict_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_import_conflict FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_decision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_decision FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_line_state_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_line_state FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_target_bucket_transition_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_target_bucket_transition FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_absence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_absence FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_absence_key_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_absence_key FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_absence_node_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_absence_node FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_absence_span_immutable BEFORE DELETE OR TRUNCATE ON src_reconciliation_absence_span FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_effective_record_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_effective_record_event FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_effective_record_projection_no_truncate BEFORE TRUNCATE ON src_effective_record_projection FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_application_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_application FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_effective_snapshot_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_effective_snapshot FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();

CREATE OR REPLACE FUNCTION validate_source_reconciliation_projection_pointers() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.source_observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.src_effective_record_event e
    WHERE e.record_id=NEW.record_id AND e.observation_id=NEW.source_observation_id AND e.layer='source' AND e.event_type IN ('record.inserted','observation.accepted')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='source projection pointer is not record-bound';
  END IF;
  IF NEW.adjustment_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.src_effective_record_event e
    WHERE e.id=NEW.adjustment_event_id AND e.record_id=NEW.record_id AND e.layer='adjustment' AND e.event_type='adjustment.revised') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='adjustment projection pointer is not record-bound';
  END IF;
  IF NEW.decision_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.src_effective_record_event e
    WHERE e.id=NEW.decision_event_id AND e.record_id=NEW.record_id AND e.layer='decision' AND e.event_type='decision.audit') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='decision projection pointer is not record-bound';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER src_effective_projection_pointer_guard BEFORE INSERT OR UPDATE OF record_id,source_observation_id,adjustment_event_id,decision_event_id
  ON src_effective_record_projection FOR EACH ROW EXECUTE FUNCTION validate_source_reconciliation_projection_pointers();

-- One private authority resolves the effective record tuple. Event row existence
-- selects the complete tuple, including SQL NULL metadata; individual columns
-- never fall back to stale projection cache bytes.
CREATE OR REPLACE FUNCTION source_reconciliation_effective_record(p_record_id uuid)
RETURNS TABLE(
  stable_record_id uuid,
  stable_exists boolean,
  projection_exists boolean,
  effective_payload jsonb,
  decimal_sources jsonb,
  duration_sources jsonb,
  effective_layer text,
  effective_state text,
  projection_version bigint,
  source_observation_id uuid,
  adjustment_event_id uuid,
  decision_event_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  stable_row public.src_stable_record%ROWTYPE;
  projection_row public.src_effective_record_projection%ROWTYPE;
  has_projection boolean := false;
  decision_found boolean := false;
  adjustment_found boolean := false;
  source_found boolean := false;
  decision_payload jsonb;
  decision_decimal jsonb;
  decision_duration jsonb;
  adjustment_payload jsonb;
  adjustment_decimal jsonb;
  adjustment_duration jsonb;
  source_payload jsonb;
  source_decimal jsonb;
  source_duration jsonb;
BEGIN
  SELECT record.* INTO stable_row FROM public.src_stable_record record WHERE record.id=p_record_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT projection.* INTO projection_row
  FROM public.src_effective_record_projection projection
  WHERE projection.record_id=p_record_id;
  has_projection:=FOUND;

  stable_record_id:=stable_row.id;
  stable_exists:=true;
  projection_exists:=has_projection;
  effective_state:=CASE WHEN has_projection THEN projection_row.state ELSE stable_row.state END;
  projection_version:=CASE WHEN has_projection THEN projection_row.version ELSE NULL END;
  source_observation_id:=CASE WHEN has_projection THEN projection_row.source_observation_id ELSE NULL END;
  adjustment_event_id:=CASE WHEN has_projection THEN projection_row.adjustment_event_id ELSE NULL END;
  decision_event_id:=CASE WHEN has_projection THEN projection_row.decision_event_id ELSE NULL END;

  -- Validate every non-null pointer independently. A valid higher layer must
  -- never mask corruption in a lower physical pointer.
  IF has_projection AND projection_row.decision_event_id IS NOT NULL THEN
    SELECT event.payload,event.decimal_sources,event.duration_sources
      INTO decision_payload,decision_decimal,decision_duration
    FROM public.src_effective_record_event event
    WHERE event.id=projection_row.decision_event_id AND event.record_id=p_record_id
      AND event.layer='decision' AND event.event_type='decision.audit';
    decision_found:=FOUND;
    IF NOT decision_found THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='decision projection pointer is unresolved'; END IF;
  END IF;
  IF has_projection AND projection_row.adjustment_event_id IS NOT NULL THEN
    SELECT event.payload,event.decimal_sources,event.duration_sources
      INTO adjustment_payload,adjustment_decimal,adjustment_duration
    FROM public.src_effective_record_event event
    WHERE event.id=projection_row.adjustment_event_id AND event.record_id=p_record_id
      AND event.layer='adjustment' AND event.event_type='adjustment.revised';
    adjustment_found:=FOUND;
    IF NOT adjustment_found THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='adjustment projection pointer is unresolved'; END IF;
  END IF;
  IF has_projection AND projection_row.source_observation_id IS NOT NULL THEN
    SELECT event.payload,event.decimal_sources,event.duration_sources
      INTO source_payload,source_decimal,source_duration
    FROM public.src_effective_record_event event
    WHERE event.record_id=p_record_id AND event.observation_id=projection_row.source_observation_id
      AND event.layer='source' AND event.event_type IN ('record.inserted','observation.accepted')
    ORDER BY event.occurred_at DESC,event.id DESC LIMIT 1;
    source_found:=FOUND;
    IF NOT source_found THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='source projection pointer is unresolved'; END IF;
  END IF;

  IF decision_found THEN
    effective_payload:=decision_payload; decimal_sources:=decision_decimal; duration_sources:=decision_duration; effective_layer:='decision';
  ELSIF adjustment_found THEN
    effective_payload:=adjustment_payload; decimal_sources:=adjustment_decimal; duration_sources:=adjustment_duration; effective_layer:='adjustment';
  ELSIF source_found THEN
    effective_payload:=source_payload; decimal_sources:=source_decimal; duration_sources:=source_duration; effective_layer:='source';
  ELSIF has_projection THEN
    effective_payload:=projection_row.payload; decimal_sources:=projection_row.decimal_sources; duration_sources:=projection_row.duration_sources; effective_layer:='source';
  ELSE
    effective_payload:='{}'::jsonb; decimal_sources:=NULL; duration_sources:=NULL; effective_layer:='source';
  END IF;
  RETURN NEXT;
END;
$$;

-- The application can page the stable-record picker without receiving direct
-- EXECUTE on the canonical resolver. Materialization resolves every stable row
-- before any filter or limit, so one corrupt physical pointer fails the page.
CREATE OR REPLACE FUNCTION source_reconciliation_stable_record_page(
  p_query text,
  p_after_id uuid,
  p_limit integer
)
RETURNS TABLE(
  stable_record_id uuid,
  matching_attributes jsonb,
  effective_payload jsonb,
  decimal_sources jsonb,
  duration_sources jsonb,
  effective_layer text,
  projection_version bigint,
  total text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE search_pattern text;
BEGIN
  IF session_user<>'tria_app' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='stable record page is restricted to the application role';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>101 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='stable record page limit is invalid';
  END IF;
  IF p_query IS NULL OR p_query<>lower(btrim(p_query)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='stable record page query is not normalized';
  END IF;
  search_pattern:='%'||replace(replace(replace(p_query,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';

  RETURN QUERY
  WITH resolved AS MATERIALIZED (
    SELECT record.id,record.matching_attributes,
      effective.effective_payload,effective.decimal_sources,effective.duration_sources,
      effective.effective_layer,effective.effective_state,effective.projection_version
    FROM public.src_stable_record record
    CROSS JOIN LATERAL public.source_reconciliation_effective_record(record.id) effective
  ), matching AS MATERIALIZED (
    SELECT resolved.id,resolved.matching_attributes,resolved.effective_payload,
      resolved.decimal_sources,resolved.duration_sources,resolved.effective_layer,
      resolved.projection_version
    FROM resolved
    WHERE resolved.effective_state='active'
      AND (p_query=''
        OR lower(resolved.id::text) LIKE search_pattern ESCAPE chr(92)
        OR EXISTS (
          SELECT 1
          FROM jsonb_each_text(coalesce(resolved.matching_attributes,'{}'::jsonb)) attribute(key,value)
          WHERE lower(attribute.key) NOT IN ('curso','trilha')
            AND (lower(attribute.key) LIKE search_pattern ESCAPE chr(92)
              OR lower(attribute.value) LIKE search_pattern ESCAPE chr(92))
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_each_text(coalesce(resolved.effective_payload,'{}'::jsonb)) payload_entry(key,value)
          WHERE payload_entry.key=ANY(ARRAY['codigo','referencia','data','valor','duracao']::text[])
            AND payload_entry.value IS NOT NULL
            AND lower(payload_entry.value) LIKE search_pattern ESCAPE chr(92)
        ))
  ), totals AS (
    SELECT count(*)::text AS total FROM matching
  )
  SELECT page_rows.id,page_rows.matching_attributes,page_rows.effective_payload,
    page_rows.decimal_sources,page_rows.duration_sources,page_rows.effective_layer,
    page_rows.projection_version,totals.total
  FROM totals
  LEFT JOIN LATERAL (
    SELECT candidate.id,candidate.matching_attributes,candidate.effective_payload,
      candidate.decimal_sources,candidate.duration_sources,candidate.effective_layer,
      candidate.projection_version
    FROM matching candidate
    WHERE p_after_id IS NULL OR candidate.id>p_after_id
    ORDER BY candidate.id
    LIMIT p_limit
  ) page_rows ON true
  ORDER BY page_rows.id NULLS LAST;
END;
$$;

CREATE TRIGGER src_reconciliation_request_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_request FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_reconciliation_confirmation_application_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON src_reconciliation_confirmation_application FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();
CREATE TRIGGER src_projection_version_no_truncate BEFORE TRUNCATE ON src_projection_version FOR EACH STATEMENT EXECUTE FUNCTION prevent_source_reconciliation_mutation();

-- Read all decisions in a reconciliation revision chain. Historical acts keep
-- their original IDs and are never copied into a child revision.
CREATE OR REPLACE FUNCTION source_reconciliation_decisions(p_reconciliation_id uuid)
RETURNS SETOF public.src_reconciliation_decision
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE chain(id) AS (
    SELECT p_reconciliation_id
    UNION ALL
    SELECT r.parent_reconciliation_id
    FROM public.src_reconciliation r
    JOIN chain c ON c.id = r.id
    WHERE r.parent_reconciliation_id IS NOT NULL
  )
  SELECT d.*
  FROM public.src_reconciliation_decision d
  JOIN chain c ON c.id = d.reconciliation_id
  ORDER BY d.revision_no, d.decided_at, d.id
$$;

-- Materialize a revision only at a read/apply boundary. Each child stores one
-- changed line in manifest_delta; DISTINCT ON turns the chain into one lookup
-- per observation, so a 10k-line graph with D decisions is O(N + D), rather
-- than rebuilding the complete graph during each decision write.
CREATE OR REPLACE FUNCTION source_reconciliation_materialize_manifest(p_reconciliation_id uuid, p_include_absences boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE chain AS (
    SELECT r.id, r.parent_reconciliation_id, r.revision_no, r.created_at, r.manifest,
      r.manifest_delta, r.status, r.summary, r.fingerprint, r.base_projection_version, r.metrics
    FROM public.src_reconciliation r
    WHERE r.id = p_reconciliation_id
    UNION ALL
    SELECT parent.id, parent.parent_reconciliation_id, parent.revision_no, parent.created_at,
      parent.manifest, parent.manifest_delta, parent.status, parent.summary, parent.fingerprint,
      parent.base_projection_version, parent.metrics
    FROM public.src_reconciliation parent
    JOIN chain child ON child.parent_reconciliation_id = parent.id
  ), root AS (
    SELECT c.* FROM chain c WHERE c.parent_reconciliation_id IS NULL LIMIT 1
  ), current_revision AS (
    SELECT c.* FROM chain c WHERE c.id = p_reconciliation_id LIMIT 1
  ), delta_lines AS (
    SELECT c.revision_no, c.created_at, c.id, value AS line
    FROM chain c
    CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(c.manifest_delta->'lines') = 'array' THEN c.manifest_delta->'lines'
      WHEN jsonb_typeof(c.manifest_delta->'line') = 'object' THEN jsonb_build_array(c.manifest_delta->'line')
      ELSE '[]'::jsonb END) value
  ), changed_lines AS (
    SELECT DISTINCT ON ((line->'observation'->>'id'), (line->'observation'->>'locator')) line
    FROM delta_lines
    ORDER BY line->'observation'->>'id', line->'observation'->>'locator', revision_no DESC, created_at DESC, id DESC
  ), materialized_lines AS (
    SELECT coalesce(jsonb_agg(coalesce(changed.line, source_line.value) ORDER BY source_line.ordinal), '[]'::jsonb) AS value
    FROM root
    CROSS JOIN jsonb_array_elements(coalesce(root.manifest->'lines', '[]'::jsonb))
      WITH ORDINALITY AS source_line(value, ordinal)
    LEFT JOIN changed_lines changed
      ON changed.line->'observation'->>'id' = source_line.value->'observation'->>'id'
     AND changed.line->'observation'->>'locator' = source_line.value->'observation'->>'locator'
  ), decisions AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id::text, 'observationId', d.observation_id::text, 'locator', d.locator,
      'stableRecordId', d.stable_record_id::text, 'outcome', d.outcome, 'actor', d.actor,
      'decidedAt', to_char(d.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'policyVersion', d.policy_version, 'rationale', d.rationale, 'version', d.version,
      'revisionNo', d.revision_no
    ) ORDER BY d.revision_no, d.decided_at, d.id), '[]'::jsonb) AS value
    FROM source_reconciliation_decisions(p_reconciliation_id) d
  ), conflicts AS (
    SELECT coalesce(jsonb_agg(source_line.value->'conflict' ORDER BY source_line.ordinal)
      FILTER (WHERE jsonb_typeof(source_line.value->'conflict') = 'object'), '[]'::jsonb) AS value
    FROM materialized_lines, jsonb_array_elements(materialized_lines.value) WITH ORDINALITY source_line(value, ordinal)
  )
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(root.manifest, '{id}', to_jsonb(current_revision.id::text), true),
              '{parentReconciliationId}', coalesce(to_jsonb(current_revision.parent_reconciliation_id::text), 'null'::jsonb), true),
            '{revisionNo}', to_jsonb(current_revision.revision_no::text), true),
          '{createdAt}', to_jsonb(current_revision.created_at), true),
        '{status}', to_jsonb(current_revision.status), true),
      '{fingerprint}', to_jsonb(current_revision.fingerprint), true),
    '{lines}', materialized_lines.value, true)
    || jsonb_build_object(
      'decisions', decisions.value,
      'conflicts', conflicts.value,
      'summary', current_revision.summary,
      'metrics', current_revision.metrics,
      'absences', CASE WHEN NOT p_include_absences THEN '[]'::jsonb
        WHEN current_revision.parent_reconciliation_id IS NULL THEN coalesce(root.manifest->'absences', '[]'::jsonb)
        ELSE coalesce((SELECT jsonb_agg(absence.item ORDER BY absence.stable_record_id)
          FROM source_reconciliation_absence_rows(p_reconciliation_id) absence), '[]'::jsonb) END
    )
  FROM root, current_revision, materialized_lines, decisions, conflicts
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_materialize_manifest(p_reconciliation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT source_reconciliation_materialize_manifest(p_reconciliation_id,true)
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_ordered_root_tree(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $ordered$
DECLARE kind text; result jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN 'null'::jsonb; END IF;
  kind:=jsonb_typeof(p_value);
  IF kind='array' THEN
    SELECT jsonb_build_object('t','a','v',coalesce(jsonb_object_agg(lpad((ordinal-1)::text,12,'0'),source_reconciliation_ordered_root_tree(value)),'{}'::jsonb)) INTO result
    FROM jsonb_array_elements(p_value) WITH ORDINALITY item(value,ordinal);
    RETURN result;
  ELSIF kind='object' THEN
    SELECT jsonb_build_object('t','o','v',coalesce(jsonb_object_agg(key,source_reconciliation_ordered_root_tree(value)),'{}'::jsonb)) INTO result
    FROM jsonb_each(p_value) item(key,value)
    WHERE lower(key) NOT IN ('curso','trilha');
    RETURN result;
  END IF;
  RETURN p_value;
END;
$ordered$;

CREATE OR REPLACE FUNCTION source_reconciliation_root_request_hash(p_confirmation_id uuid,p_policy jsonb)
RETURNS char(64) LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $root_hash$
DECLARE confirmation_payload jsonb; preview_manifest jsonb;
BEGIN
  SELECT c.confirmation_payload,p.manifest INTO confirmation_payload,preview_manifest
  FROM src_import_preview_confirmation c JOIN src_import_preview p ON p.id=c.preview_id WHERE c.id=p_confirmation_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='root request confirmation is unavailable'; END IF;
  RETURN encode(sha256(convert_to(source_reconciliation_jcs(source_reconciliation_ordered_root_tree(jsonb_build_object(
    'confirmation',confirmation_payload-'confirmedAt'-'reused','preview',preview_manifest-'preparedAt'-'retainUntil','policy',p_policy))), 'utf8')),'hex')::char(64);
END;
$root_hash$;

CREATE OR REPLACE FUNCTION source_reconciliation_observation_id(p_preview_id uuid, p_locator text)
RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-4' || substr(digest, 14, 3) || '-8' || substr(digest, 18, 3) || '-' || substr(digest, 21, 12))::uuid
  FROM (SELECT encode(sha256(convert_to(source_reconciliation_jcs(jsonb_build_object('previewId', p_preview_id::text, 'locator', p_locator)), 'utf8')), 'hex') AS digest) hashed
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_functional_hash(p_normalized_payload jsonb)
RETURNS char(64)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(sha256(convert_to(source_reconciliation_jcs(jsonb_build_object('normalized_payload', p_normalized_payload)), 'utf8')), 'hex')::char(64)
$$;

-- Registry/preview owns the stable evidence. The caller may only submit the
-- same sorted field set (or the empty set, which deliberately disables
-- automatic matching); it cannot introduce a field absent from the
-- confirmed preview. The policy version remains an audit label and never
-- changes the matching inputs.
CREATE OR REPLACE FUNCTION source_reconciliation_canonical_matching_fields(p_manifest jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(key) ORDER BY key), '[]'::jsonb)
  FROM (
    SELECT DISTINCT key
    FROM jsonb_array_elements(coalesce(p_manifest->'rows', '[]'::jsonb)) row
    CROSS JOIN LATERAL jsonb_object_keys(coalesce(row->'matchingAttributes', '{}'::jsonb)) key
  ) fields
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_fingerprint(p_graph jsonb)
RETURNS char(64)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $fingerprint$
DECLARE
  rec jsonb := p_graph->'reconciliation';
  policy_fields text;
  decisions text;
  confirmation text;
  policy text;
  canonical text;
BEGIN
  SELECT coalesce('{' || string_agg(to_jsonb(field)::text || ':true', ',' ORDER BY field) || '}', '{}')
    INTO policy_fields
  FROM jsonb_array_elements_text(rec->'policy'->'fields') field;
  SELECT coalesce('{' || string_agg(
    to_jsonb(key)::text || ':{' ||
      '"actor":' || source_reconciliation_json_text(d->>'actor') || ',' ||
      '"id":' || source_reconciliation_json_text(d->>'id') || ',' ||
      '"locator":' || source_reconciliation_json_text(d->>'locator') || ',' ||
      '"observationId":' || source_reconciliation_json_text(d->>'observationId') || ',' ||
      '"outcome":' || source_reconciliation_json_text(d->>'outcome') || ',' ||
      '"policyVersion":' || source_reconciliation_json_text(d->>'policyVersion') || ',' ||
      '"rationale":' || source_reconciliation_json_text(d->>'rationale') || ',' ||
      '"stableRecordId":' || source_reconciliation_json_text(d->>'stableRecordId') || ',' ||
      '"version":' || source_reconciliation_json_text(d->>'version') || '}',
    ',' ORDER BY key) || '}', '{}')
    INTO decisions
  FROM jsonb_array_elements(coalesce(rec->'decisions', '[]'::jsonb)) d
  CROSS JOIN LATERAL (SELECT (d->>'observationId') || ':' || coalesce(d->>'locator', '') || ':' || (d->>'id') AS key) keyed;
  SELECT '{"batchId":' || source_reconciliation_json_text(rec->>'batchId') ||
    ',"confirmationId":' || source_reconciliation_json_text(rec->>'confirmationId') ||
    ',"contractHash":' || source_reconciliation_json_text(rec->>'contractHash') ||
    ',"previewHash":' || source_reconciliation_json_text(rec->>'previewHash') ||
    ',"previewId":' || source_reconciliation_json_text(rec->>'previewId') ||
    ',"sourceSha256":' || source_reconciliation_json_text(rec->>'sourceSha256') ||
    ',"transformationHash":' || source_reconciliation_json_text(rec->>'transformationHash') || '}'
    INTO confirmation;
  policy := '{"evidence":' || source_reconciliation_json_text(rec->'policy'->>'evidence') ||
    ',"fields":' || policy_fields ||
    ',"version":' || source_reconciliation_json_text(rec->'policy'->>'version') || '}';
  canonical := '{"absenceCommitment":' || source_reconciliation_jcs(rec->'absenceCommitment') || ',"baseProjectionVersion":' || source_reconciliation_json_text(rec->>'baseProjectionVersion') ||
    ',"confirmation":' || confirmation || ',"decisions":' || decisions || ',"policy":' || policy ||
    ',"rootRequestHash":' || source_reconciliation_json_text(rec->>'rootRequestHash') || ',"version":"reconciliation-fingerprint-v4"}';
  RETURN encode(sha256(convert_to(canonical, 'utf8')), 'hex')::char(64);
END;
$fingerprint$;

-- These helpers keep the write boundary on exact, typed values.  In
-- particular, metrics are derived from the metadata that will be persisted,
-- never from a caller supplied total or from a text rendering of JSONB.
CREATE OR REPLACE FUNCTION source_reconciliation_decimal_text(p_total numeric, p_scale integer)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  scaled text;
  absolute text;
  integer_part text;
BEGIN
  IF p_scale IS NULL OR p_scale < 0 OR p_scale > 100 OR p_total IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation decimal metadata is invalid';
  END IF;
  scaled := trunc(p_total * power(10::numeric, p_scale))::text;
  absolute := ltrim(scaled, '-');
  IF p_scale = 0 THEN RETURN scaled; END IF;
  integer_part := CASE WHEN length(absolute) <= p_scale THEN '0' ELSE left(absolute, length(absolute) - p_scale) END;
  RETURN CASE WHEN scaled LIKE '-%' THEN '-' ELSE '' END || integer_part || '.' || right(repeat('0', p_scale) || absolute, p_scale);
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_duration_seconds(p_source_text text, p_unit text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  parts text[];
BEGIN
  p_source_text := btrim(p_source_text);
  IF p_source_text IS NULL OR p_unit NOT IN ('minutes', 'clock') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation duration metadata is invalid';
  END IF;
  IF p_unit = 'minutes' THEN
    IF p_source_text !~ '^\d+$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation duration metadata is invalid';
    END IF;
    RETURN p_source_text::numeric * 60;
  END IF;
  IF p_source_text ~ '^\d+$' THEN RETURN p_source_text::numeric * 60; END IF;
  IF p_source_text !~ '^\d+:[0-5]\d(?::[0-5]\d)?$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation duration metadata is invalid';
  END IF;
  parts := string_to_array(p_source_text, ':');
  IF cardinality(parts) = 2 THEN
    RETURN parts[1]::numeric * 60 + parts[2]::numeric;
  END IF;
  RETURN parts[1]::numeric * 3600 + parts[2]::numeric * 60 + parts[3]::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_metrics(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  inputs jsonb;
  decimal_sums jsonb;
  duration_sums jsonb;
  current_pointers_valid boolean;
BEGIN
  -- Keep the former nullif(line->'observation'->'decimalSources', '{}'::jsonb)
  -- and nullif(line->'observation'->'durationSources', '{}'::jsonb) spellings
  -- documented here while the actual reducer preserves explicit empty objects.
  WITH accepted AS (
    SELECT value AS line, nullif(value->>'stableRecordId', '')::uuid AS record_id,
      value->'decision'->>'outcome' AS decision_outcome
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) value
    WHERE value->>'category' IN ('inserted', 'updated', 'unchanged')
  ), current_inputs AS (
    SELECT effective.stable_record_id AS id,effective.decimal_sources,effective.duration_sources,true AS pointers_valid
    FROM public.src_stable_record record
    CROSS JOIN LATERAL source_reconciliation_effective_record(record.id) effective
    WHERE effective.effective_state='active'
  ), existing_inputs AS (
    SELECT CASE WHEN a.record_id IS NULL OR a.decision_outcome = 'keep-current' THEN coalesce(current_input.decimal_sources, '{}'::jsonb)
                -- An accepted observation is the metric input for its
                -- target. Its empty metadata is meaningful absence and must
                -- not be replaced by the target's older provenance; the
                -- keep-current branch above is the explicit preservation
                -- path for protected metadata (RF122).
                ELSE coalesce(a.line->'observation'->'decimalSources', '{}'::jsonb) END AS decimal_sources,
           CASE WHEN a.record_id IS NULL OR a.decision_outcome = 'keep-current' THEN coalesce(current_input.duration_sources, '{}'::jsonb)
                ELSE coalesce(a.line->'observation'->'durationSources', '{}'::jsonb) END AS duration_sources,
           current_input.pointers_valid
    FROM current_inputs current_input
    LEFT JOIN accepted a ON a.record_id = current_input.id
  ), created_inputs AS (
    SELECT coalesce(nullif(a.line->'observation'->'decimalSources', '{}'::jsonb), '{}'::jsonb) AS decimal_sources,
           coalesce(nullif(a.line->'observation'->'durationSources', '{}'::jsonb), '{}'::jsonb) AS duration_sources,
           true AS pointers_valid
    FROM accepted a
    WHERE NOT EXISTS (SELECT 1 FROM public.src_stable_record r WHERE r.id = a.record_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('decimalSources', decimal_sources, 'durationSources', duration_sources)), '[]'::jsonb),
         coalesce(bool_and(pointers_valid),true)
    INTO inputs,current_pointers_valid
  FROM (SELECT decimal_sources, duration_sources, pointers_valid FROM existing_inputs
        UNION ALL SELECT decimal_sources, duration_sources, pointers_valid FROM created_inputs) all_inputs;

  IF current_pointers_valid IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='metric projection pointer is unresolved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(inputs) input
    LEFT JOIN LATERAL jsonb_each(coalesce(input->'decimalSources', '{}'::jsonb)) source(field, metadata) ON true
    WHERE NOT source_reconciliation_valid_decimal_sources(input->'decimalSources')
      OR jsonb_typeof(source.metadata) <> 'object'
      OR jsonb_typeof(source.metadata->'source_text') <> 'string'
      OR jsonb_typeof(source.metadata->'source_scale') <> 'number'
      OR source.metadata->>'source_scale' !~ '^\d+$'
      OR (source.metadata->>'source_scale')::integer > 100
      OR jsonb_typeof(source.metadata->'normalized_value') NOT IN ('string', 'null')
      OR (source.metadata->>'normalized_value') IS NOT NULL
         AND ((source.metadata->>'normalized_value') !~ '^-?\d+(?:\.\d+)?$'
           OR length(split_part(ltrim(source.metadata->>'normalized_value', '-'), '.', 2)) > (source.metadata->>'source_scale')::integer)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation decimal metadata is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(inputs) input
    LEFT JOIN LATERAL jsonb_each(coalesce(input->'durationSources', '{}'::jsonb)) source(field, metadata) ON true
    WHERE NOT source_reconciliation_valid_duration_sources(input->'durationSources')
      OR jsonb_typeof(source.metadata) <> 'object'
      OR jsonb_typeof(source.metadata->'source_text') <> 'string'
      OR jsonb_typeof(source.metadata->'unit') <> 'string'
      OR source.metadata->>'unit' NOT IN ('minutes', 'clock')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation duration metadata is invalid';
  END IF;

  WITH sources AS (
    SELECT source.field, source.metadata->>'normalized_value' AS normalized_value,
      (source.metadata->>'source_scale')::integer AS source_scale
    FROM jsonb_array_elements(inputs) input
    CROSS JOIN LATERAL jsonb_each(coalesce(input->'decimalSources', '{}'::jsonb)) source(field, metadata)
  ), scales AS (
    SELECT field, coalesce(max(CASE WHEN normalized_value IS NULL THEN 0 ELSE source_scale END), 0)::integer AS scale
    FROM sources GROUP BY field
  ), totals AS (
    SELECT scales.field, scales.scale,
      coalesce(sum(CASE WHEN sources.normalized_value IS NULL THEN 0::numeric
        ELSE sources.normalized_value::numeric END), 0::numeric) AS total
    FROM scales JOIN sources USING (field) GROUP BY scales.field, scales.scale
  )
  SELECT coalesce(jsonb_object_agg(field, source_reconciliation_decimal_text(total, scale) ORDER BY field), '{}'::jsonb)
    INTO decimal_sums
  FROM totals;

  WITH sources AS (
    SELECT source.field, source.metadata->>'source_text' AS source_text, source.metadata->>'unit' AS unit
    FROM jsonb_array_elements(inputs) input
    CROSS JOIN LATERAL jsonb_each(coalesce(input->'durationSources', '{}'::jsonb)) source(field, metadata)
  ), totals AS (
    SELECT field, sum(source_reconciliation_duration_seconds(source_text, unit)) AS total
    FROM sources GROUP BY field
  )
  SELECT coalesce(jsonb_object_agg(field, total::text ORDER BY field), '{}'::jsonb)
    INTO duration_sums
  FROM totals;

  RETURN jsonb_build_object('decimalSums', decimal_sums, 'durationSums', duration_sums);
END;
$$;

-- The application role has no INSERT privilege on the reconciliation graph.
-- This narrow SECURITY DEFINER function is the only write boundary for the
-- comparison and decision revisions; its caller remains the application role.
CREATE OR REPLACE FUNCTION source_reconciliation_metric_accumulator(p_lines jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH accepted AS (
    SELECT DISTINCT ON (nullif(value->>'stableRecordId','')::uuid)
      value AS line, nullif(value->>'stableRecordId','')::uuid AS record_id,
      value->'decision'->>'outcome' AS decision_outcome
    FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) WITH ORDINALITY entry(value,ordinal)
    WHERE value->>'category' IN ('inserted','updated','unchanged')
    ORDER BY nullif(value->>'stableRecordId','')::uuid, ordinal
  ), inputs AS (
    SELECT CASE WHEN a.record_id IS NULL OR a.decision_outcome='keep-current' THEN coalesce(effective.decimal_sources,'{}'::jsonb)
      ELSE coalesce(a.line->'observation'->'decimalSources','{}'::jsonb) END AS decimal_sources,
      CASE WHEN a.record_id IS NULL OR a.decision_outcome='keep-current' THEN coalesce(effective.duration_sources,'{}'::jsonb)
      ELSE coalesce(a.line->'observation'->'durationSources','{}'::jsonb) END AS duration_sources
    FROM public.src_stable_record record
    CROSS JOIN LATERAL source_reconciliation_effective_record(record.id) effective
    LEFT JOIN accepted a ON a.record_id=record.id WHERE effective.effective_state='active'
    UNION ALL
    SELECT coalesce(a.line->'observation'->'decimalSources','{}'::jsonb),coalesce(a.line->'observation'->'durationSources','{}'::jsonb)
    FROM accepted a WHERE NOT EXISTS(SELECT 1 FROM public.src_stable_record r WHERE r.id=a.record_id)
  ), decimal_values AS (
    SELECT field,metadata FROM inputs CROSS JOIN LATERAL jsonb_each(decimal_sources) source(field,metadata)
  ), decimal_fields AS (
    SELECT field, count(*)::integer AS source_count,
      count(*) FILTER(WHERE metadata->'normalized_value' <> 'null'::jsonb)::integer AS nonnull_count,
      coalesce(sum((metadata->>'normalized_value')::numeric) FILTER(WHERE metadata->'normalized_value' <> 'null'::jsonb),0) AS total
    FROM decimal_values GROUP BY field
  ), decimal_acc AS (
    SELECT coalesce(jsonb_object_agg(f.field,jsonb_build_object('total',f.total::text,'sourceCount',f.source_count,
      'nonnullCount',f.nonnull_count,'scaleCounts',coalesce((SELECT jsonb_object_agg(scale,cnt) FROM (
        SELECT metadata->>'source_scale' AS scale,count(*)::integer AS cnt FROM decimal_values v
        WHERE v.field=f.field AND metadata->'normalized_value' <> 'null'::jsonb GROUP BY metadata->>'source_scale') scales),'{}'::jsonb))),'{}'::jsonb) AS value
    FROM decimal_fields f
  ), duration_values AS (
    SELECT field,metadata FROM inputs CROSS JOIN LATERAL jsonb_each(duration_sources) source(field,metadata)
  ), duration_acc AS (
    SELECT coalesce(jsonb_object_agg(field,jsonb_build_object('total',total::text,'sourceCount',source_count)),'{}'::jsonb) AS value
    FROM (SELECT field,sum(source_reconciliation_duration_seconds(metadata->>'source_text',metadata->>'unit')) AS total,
      count(*)::integer AS source_count FROM duration_values GROUP BY field) grouped
  )
  SELECT jsonb_build_object('decimal',decimal_acc.value,'duration',duration_acc.value) FROM decimal_acc,duration_acc
$$;

CREATE OR REPLACE FUNCTION write_source_reconciliation(p_operation text, p_graph jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  rec jsonb := p_graph->'reconciliation';
  confirmation public.src_import_preview_confirmation%ROWTYPE;
  preview public.src_import_preview%ROWTYPE;
  line jsonb;
  canonical_row jsonb;
  conflict jsonb;
  decision jsonb;
  observation jsonb;
  v_observation_id uuid;
  revision integer;
  is_create boolean;
  parent_id uuid;
  parent_revision bigint;
  parent_lineage uuid;
  parent_metrics jsonb;
  rec_id uuid;
  current_projection bigint;
  expected_absent integer;
  expected_decisions_hash char(64);
  parent_decision_count integer;
  canonical_candidates jsonb;
  canonical_outcome text;
  stable_attributes_present boolean;
  parent_line jsonb;
  decision_line jsonb;
  canonical_target uuid;
  canonical_payload jsonb;
  canonical_decimal_sources jsonb;
  canonical_duration_sources jsonb;
  canonical_layer text;
  canonical_state text;
  canonical_pointers_valid boolean;
  expected_layer text;
  expected_field_diffs jsonb;
  expected_absences jsonb;
  line_decision jsonb;
  line_target uuid;
  matched_target uuid;
  expected_category text;
  expected_consequence text;
  expected_conflict jsonb;
  duplicate_target boolean;
  duplicate_targets jsonb;
  canonical_candidates_by_locator jsonb;
  canonical_candidate_counts_by_locator jsonb;
  canonical_rows_by_locator jsonb;
  accepted_target_ids jsonb;
  expected_match_reason text;
  expected_conflicts jsonb;
  expected_summary jsonb;
  expected_metrics jsonb;
  canonical_policy_fields jsonb;
  expected_observation_id uuid;
  existing_observation public.src_source_observation%ROWTYPE;
  canonical_matching_attributes jsonb;
  canonical_policy_version constant text := 'server-owned-preview-matching-v1';
  server_created_at timestamptz := clock_timestamp();
  parent_policy_version text;
  existing_confirmation_reconciliation uuid;
  existing_confirmation_fingerprint char(64);
  existing_confirmation_decisions_hash char(64);
  existing_fingerprint_reconciliation public.src_reconciliation%ROWTYPE;
  effective_reconciliation_id uuid;
  stored_manifest jsonb;
  manifest_delta jsonb;
  new_line_delta jsonb;
  parent_lines_by_key jsonb := '{}'::jsonb;
  decisions_by_line jsonb := '{}'::jsonb;
  absence_items jsonb;
  avl_root_id uuid;
  avl_root public.src_reconciliation_absence_node%ROWTYPE;
  avl_root_hash bytea;
  avl_count bigint;
  avl_min uuid;
  avl_max uuid;
  avl_commitment bytea;
  expected_absence_commitment jsonb;
BEGIN
  IF session_user <> 'tria_app' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'reconciliation writer is restricted to the application role';
  END IF;
  IF p_operation <> 'reconcile' OR jsonb_typeof(p_graph) <> 'object' OR jsonb_typeof(rec) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'full-graph decision writes are disabled; use the atomic intent writer';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_graph) key WHERE key NOT IN ('reconciliation','fingerprint','idempotencyKey','requestId','decisionsHash')) OR
     EXISTS(SELECT 1 FROM jsonb_object_keys(rec) key WHERE key NOT IN ('id','confirmationId','batchId','previewId','sourceFileId','sourceSha256','contractHash','transformationHash','previewHash','rootRequestHash','absenceCommitment','policy','baseProjectionVersion','projectionVersion','status','lines','absences','conflicts','decisions','availableStableRecordIds','availableStableRecords','parentReconciliationId','revisionNo','metrics','summary','fingerprint','createdAt','actor')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unknown reconciliation graph field';
  END IF;
  rec_id := (rec->>'id')::uuid;
  IF rec->>'actor' <> 'Rodrigo' OR rec->>'status' NOT IN ('needs-decision', 'ready-to-apply') OR
     jsonb_typeof(rec->'lines') <> 'array' OR jsonb_typeof(rec->'conflicts') <> 'array' OR
     jsonb_typeof(rec->'decisions') <> 'array' OR jsonb_typeof(rec->'absences') <> 'array' OR
     jsonb_typeof(rec->'summary') <> 'object' OR jsonb_typeof(rec->'metrics') <> 'object' OR
     jsonb_typeof(rec->'policy') <> 'object' OR jsonb_typeof(rec->'policy'->'fields') <> 'array' OR
     nullif(rec->'policy'->>'version', '') IS NULL OR length(rec->'policy'->>'version') > 120 OR
     rec->'policy'->>'evidence' <> 'explicit-stable-attributes' OR length(coalesce(p_graph->>'fingerprint', '')) <> 64 OR
     p_graph->>'fingerprint' <> rec->>'fingerprint' OR length(coalesce(p_graph->>'decisionsHash', '')) <> 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid canonical reconciliation graph';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(rec->'policy'->'fields') field
    WHERE field !~ '^[a-z][a-z0-9_-]{0,63}$' OR field ~* '(?:^|[_-])(id|source.?id|locator|position|ordinal|row.?hash|hash|valor|value|horas|hours|texto|text|descricao|description|codigo|code|data|date)(?:$|[_-])' OR lower(field) IN ('curso', 'trilha')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy is not approved';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(rec->'policy'->'fields') field GROUP BY field HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy is not approved';
  END IF;
  SELECT * INTO confirmation FROM public.src_import_preview_confirmation WHERE id = nullif(rec->>'confirmationId', '')::uuid;
  SELECT * INTO preview FROM public.src_import_preview WHERE id = nullif(rec->>'previewId', '')::uuid;
  IF NOT FOUND OR confirmation.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation lineage is not canonical';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(rec->'policy') key WHERE key NOT IN ('version', 'fields', 'evidence')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy is not server-owned';
  END IF;
  canonical_policy_fields := source_reconciliation_canonical_matching_fields(preview.manifest);
  IF rec->'policy'->'fields' IS DISTINCT FROM canonical_policy_fields AND
     rec->'policy'->'fields' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy fields are not derived from the confirmed preview';
  END IF;
  IF rec->'policy'->>'version' <> canonical_policy_version THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy version is not server-owned';
  END IF;
  IF jsonb_array_length(canonical_policy_fields) > 0 AND rec->'policy'->'fields' IS DISTINCT FROM canonical_policy_fields THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'matching policy cannot be empty when preview evidence exists';
  END IF;
  -- Stable-record context is a read model. It is intentionally removed before
  -- persistence so a browser cannot enlarge or replace the catalog used by a
  -- later decision; the repository hydrates it from the projection on read.
  rec := rec - 'availableStableRecordIds' - 'availableStableRecords';
  IF rec->>'rootRequestHash' IS DISTINCT FROM source_reconciliation_root_request_hash(confirmation.id,rec->'policy')::text THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='root request hash is not independently canonical';
  END IF;
  IF rec->>'confirmationId' <> confirmation.id::text OR rec->>'previewId' <> preview.id::text OR
     rec->>'batchId' <> confirmation.batch_id::text OR rec->>'sourceFileId' <> confirmation.source_file_id::text OR
     rec->>'sourceSha256' <> confirmation.source_sha256::text OR rec->>'contractHash' <> confirmation.contract_hash::text OR
     rec->>'transformationHash' <> confirmation.transformation_hash::text OR rec->>'previewHash' <> confirmation.preview_hash::text OR
     rec->>'batchId' <> preview.batch_id::text OR rec->>'sourceFileId' <> preview.source_file_id::text OR
     rec->>'sourceSha256' <> preview.source_sha256::text OR rec->>'contractHash' <> preview.contract_hash::text OR
     rec->>'transformationHash' <> preview.transformation_hash::text OR rec->>'previewHash' <> preview.preview_hash::text THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation lineage is not canonical';
  END IF;
  -- All mutations for one confirmation use the same lock order:
  -- confirmation -> transport identity -> reconciliation/parent -> projection
  -- -> stable-record identities. This prevents the former decision/apply lock
  -- inversion and keeps a direct application-role caller on the same protocol.
  IF length(coalesce(p_graph->>'idempotencyKey', '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation idempotency key is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:confirmation:' || confirmation.id::text, 7824001));
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:key:' || (p_graph->>'idempotencyKey'), 7824001));
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:fingerprint:' || (p_graph->>'fingerprint'), 7824001));

  IF p_operation = 'reconcile' THEN
    SELECT head.leaf_reconciliation_id INTO effective_reconciliation_id
    FROM public.src_reconciliation_request q
    JOIN public.src_reconciliation root ON root.id=q.root_reconciliation_id
    JOIN public.src_reconciliation_head head ON head.lineage_id=root.id
    WHERE q.operation='reconcile' AND q.idempotency_key=p_graph->>'idempotencyKey'
      AND q.root_request_hash=rec->>'rootRequestHash';
    IF effective_reconciliation_id IS NOT NULL THEN RETURN effective_reconciliation_id; END IF;
    IF EXISTS (SELECT 1 FROM public.src_reconciliation_request q WHERE q.operation='reconcile' AND q.idempotency_key=p_graph->>'idempotencyKey') THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation idempotency conflict';
    END IF;
    SELECT a.reconciliation_id, r.fingerprint, r.decisions_hash
      INTO existing_confirmation_reconciliation, existing_confirmation_fingerprint, existing_confirmation_decisions_hash
    FROM public.src_reconciliation_confirmation_application a
    JOIN public.src_reconciliation r ON r.id = a.reconciliation_id
    WHERE a.confirmation_id = confirmation.id
    FOR SHARE;
    IF existing_confirmation_reconciliation IS NOT NULL THEN
      IF existing_confirmation_fingerprint = p_graph->>'fingerprint'
         AND existing_confirmation_decisions_hash = p_graph->>'decisionsHash' THEN
        IF EXISTS (
          SELECT 1 FROM public.src_reconciliation_request q
          WHERE q.operation = 'reconcile' AND q.idempotency_key = p_graph->>'idempotencyKey'
            AND (q.fingerprint <> existing_confirmation_fingerprint OR q.reconciliation_id <> existing_confirmation_reconciliation)
        ) OR EXISTS (
          SELECT 1 FROM public.src_reconciliation r
          WHERE r.idempotency_key = p_graph->>'idempotencyKey'
            AND (r.fingerprint <> existing_confirmation_fingerprint OR r.id <> existing_confirmation_reconciliation)
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation idempotency conflict';
        END IF;
        INSERT INTO public.src_reconciliation_request(operation, idempotency_key, fingerprint, reconciliation_id, root_reconciliation_id, root_request_hash)
          SELECT 'reconcile',p_graph->>'idempotencyKey',root.fingerprint,root.id,root.id,root.root_request_hash
          FROM public.src_reconciliation root WHERE root.id=coalesce((SELECT lineage_id FROM public.src_reconciliation WHERE id=existing_confirmation_reconciliation),existing_confirmation_reconciliation)
          ON CONFLICT (operation, idempotency_key) DO NOTHING;
        RETURN existing_confirmation_reconciliation;
      END IF;
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation idempotency conflict: confirmation already applied';
    END IF;
  ELSE
    parent_id := nullif(rec->>'parentReconciliationId', '')::uuid;
    IF parent_id IS NULL OR parent_id = rec_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision revision parent is required';
    END IF;
    SELECT revision_no, policy_version, coalesce(lineage_id,id), metrics
      INTO parent_revision, parent_policy_version, parent_lineage, parent_metrics
      FROM public.src_reconciliation WHERE id = parent_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision revision parent is required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.src_reconciliation child WHERE child.parent_reconciliation_id = parent_id) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'decision revision parent is not the current leaf';
    END IF;
    IF EXISTS (SELECT 1 FROM public.src_reconciliation_application a WHERE a.reconciliation_id = parent_id) OR
       EXISTS (SELECT 1 FROM public.src_reconciliation_confirmation_application a WHERE a.confirmation_id = confirmation.id) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'decision revision parent is already applied';
    END IF;
    SELECT count(*)::integer INTO parent_decision_count FROM source_reconciliation_decisions(parent_id);
    IF coalesce(nullif(rec->>'revisionNo', '')::bigint, 1) <> parent_revision + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'decision revision is not the next serialized revision';
    END IF;
    IF rec->'policy'->>'version' <> parent_policy_version THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision policy does not match its parent';
    END IF;
    SELECT coalesce(jsonb_object_agg(
        (value->'observation'->>'id') || ':' || (value->'observation'->>'locator'), value
      ), '{}'::jsonb)
      INTO parent_lines_by_key
    FROM jsonb_array_elements(source_reconciliation_materialize_manifest(parent_id)->'lines') value;
  END IF;

  IF p_operation='reconcile' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'absences') item WHERE jsonb_typeof(item)<>'object' OR item->>'stableRecordId' IS NULL OR item->>'status'<>'not_observed_this_batch' OR item->>'label'<>'Não observado neste lote' OR jsonb_typeof(item->'effectivePayload')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key NOT IN('stableRecordId','status','label','effectivePayload','effectiveVersion'))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='absence item is not canonical';END IF;
    SELECT coalesce(jsonb_agg(value ORDER BY (value->>'stableRecordId')::uuid),'[]'::jsonb) INTO absence_items FROM jsonb_array_elements(rec->'absences') value;
    IF jsonb_array_length(absence_items)<>(SELECT count(DISTINCT (value->>'stableRecordId')::uuid) FROM jsonb_array_elements(absence_items)value) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='absence keys are not unique';END IF;
    avl_count:=jsonb_array_length(absence_items);avl_root_id:=source_reconciliation_avl_build(rec_id,1,absence_items,0,avl_count::integer-1);
    IF avl_root_id IS NULL THEN avl_root_hash:=source_reconciliation_avl_empty_hash();avl_min:=NULL;avl_max:=NULL;ELSE SELECT * INTO avl_root FROM public.src_reconciliation_absence_node WHERE id=avl_root_id;avl_root_hash:=avl_root.node_hash;avl_min:=avl_root.subtree_min;avl_max:=avl_root.subtree_max;END IF;
    avl_commitment:=source_reconciliation_avl_commitment(avl_root_hash,avl_count,avl_min,avl_max);
    expected_absence_commitment:=jsonb_build_object('rootHash',encode(avl_root_hash,'hex'),'count',avl_count::text,'min',CASE WHEN avl_min IS NULL THEN NULL ELSE avl_min::text END,'max',CASE WHEN avl_max IS NULL THEN NULL ELSE avl_max::text END,'commitment',encode(avl_commitment,'hex'));
    IF rec->'absenceCommitment' IS DISTINCT FROM expected_absence_commitment THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='absence commitment is not canonical';END IF;
  END IF;

  IF p_graph->>'fingerprint' <> source_reconciliation_fingerprint(p_graph) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation fingerprint is not canonical';
  END IF;
  SELECT version INTO current_projection FROM public.src_projection_version WHERE singleton FOR SHARE;
  IF (rec->>'baseProjectionVersion')::bigint <> current_projection THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'reconciliation base projection is stale';
  END IF;
  SELECT coalesce(jsonb_object_agg(
      (value->>'observationId') || ':' || coalesce(value->>'locator', ''), value
    ), '{}'::jsonb)
    INTO decisions_by_line
  FROM (
    SELECT DISTINCT ON ((value->>'observationId'), coalesce(value->>'locator', '')) value
    FROM jsonb_array_elements(coalesce(rec->'decisions', '[]'::jsonb)) value
    ORDER BY value->>'observationId', coalesce(value->>'locator', ''),
      coalesce(nullif(value->>'revisionNo', '')::integer, 0) DESC, value->>'id' DESC
  ) latest;
  -- Compare sorted locator sets in one pass per side. The previous nested
  -- anti-join compared every preview row with every submitted line.
  IF jsonb_array_length(rec->'lines') <> jsonb_array_length(preview.manifest->'rows') OR
     (SELECT count(*) FROM jsonb_array_elements(rec->'lines') value) <> (SELECT count(DISTINCT value->'observation'->>'locator') FROM jsonb_array_elements(rec->'lines') value) OR
     (SELECT jsonb_agg(to_jsonb(value->'observation'->>'locator') ORDER BY value->'observation'->>'locator') FROM jsonb_array_elements(rec->'lines') value) IS DISTINCT FROM
     (SELECT jsonb_agg(to_jsonb(value->>'locator') ORDER BY value->>'locator') FROM jsonb_array_elements(preview.manifest->'rows') value)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation lines are not the complete confirmed preview';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(preview.manifest->'rows') WITH ORDINALITY source_rows(value, ordinal)
    JOIN jsonb_array_elements(rec->'lines') WITH ORDINALITY submitted_lines(value, ordinal) USING (ordinal)
    WHERE source_rows.value->>'locator' IS DISTINCT FROM submitted_lines.value->'observation'->>'locator'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation lines are not in confirmed preview order';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rec->'lines') value
    WHERE jsonb_typeof(value->'observation') <> 'object' OR jsonb_typeof(value->'match') <> 'object' OR
      value->'observation'->>'previewId' <> preview.id::text OR value->'observation'->>'batchId' <> preview.batch_id::text OR
      value->'observation'->>'sourceFileId' <> preview.source_file_id::text OR value->'observation'->>'locator' IS NULL OR
      value->'observation'->>'sourceRowHash' IS NULL OR jsonb_typeof(value->'observation'->'normalizedPayload') <> 'object' OR
      jsonb_typeof(value->'observation'->'sourceValues') <> 'object' OR jsonb_typeof(value->'observation'->'decimalSources') <> 'object' OR jsonb_typeof(coalesce(value->'observation'->'durationSources', '{}'::jsonb)) <> 'object' OR
      jsonb_typeof(value->'match'->'candidateIds') <> 'array' OR
      jsonb_typeof(value->'match'->'candidateCount') <> 'number' OR
      (value->'match'->>'candidateCount') !~ '^[0-9]+$' OR
      (value->'match'->>'candidateCount')::integer < jsonb_array_length(value->'match'->'candidateIds') OR
      jsonb_array_length(value->'match'->'candidateIds') > 50 OR
      value->'observation'->>'id' IS NULL OR value->'observation'->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      value->'match'->>'id' IS NULL OR value->'match'->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      EXISTS (SELECT 1 FROM jsonb_object_keys(value) key WHERE key NOT IN ('observation', 'category', 'match', 'stableRecordId', 'fieldDiffs', 'conflict', 'decision', 'consequence')) OR
      EXISTS (SELECT 1 FROM jsonb_object_keys(value->'observation') key WHERE key NOT IN ('id', 'batchId', 'previewId', 'sourceFileId', 'locator', 'sourceRowHash', 'functionalHash', 'normalizedPayload', 'sourceValues', 'decimalSources', 'durationSources', 'matchingAttributes', 'stableRecordId', 'observedAt')) OR
      EXISTS (SELECT 1 FROM jsonb_object_keys(value->'match') key WHERE key NOT IN ('id', 'observationId', 'policyVersion', 'candidateIds', 'candidateCount', 'matchedRecordId', 'outcome', 'reason'))) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation line is not canonical';
  END IF;
  SELECT coalesce(jsonb_object_agg(value->>'locator', value), '{}'::jsonb)
    INTO canonical_rows_by_locator
  FROM jsonb_array_elements(preview.manifest->'rows') value;
  SELECT coalesce(jsonb_object_agg(target, true), '{}'::jsonb)
    INTO accepted_target_ids
  FROM (
    SELECT DISTINCT CASE
      WHEN value->'decision'->>'outcome' IN ('link', 'create', 'keep-current')
        THEN nullif(value->>'stableRecordId', '')
      WHEN value->'match'->>'outcome' = 'unique'
        THEN nullif(value->'match'->>'matchedRecordId', '')
      WHEN value->>'category' IN ('inserted', 'updated', 'unchanged')
        THEN nullif(value->>'stableRecordId', '')
      ELSE NULL
    END AS target
    FROM jsonb_array_elements(rec->'lines') value
  ) observed
  WHERE target IS NOT NULL;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rec->'decisions') value
    WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(value) key
      WHERE key NOT IN ('id', 'observationId', 'locator', 'stableRecordId', 'outcome', 'actor', 'decidedAt', 'policyVersion', 'rationale', 'version', 'revisionNo'))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation decision is not canonical';
  END IF;
  -- Materialize candidate sets once. The old per-line stable-record scan made
  -- a 10k-row preview repeatedly traverse the catalog. Build the policy-key
  -- object per preview row and let the GIN-backed containment join select
  -- candidates; this avoids a preview-row x catalog cross product.
  WITH preview_rows AS MATERIALIZED (
    SELECT preview_row.row_value->>'locator' AS locator, preview_row.row_value->>'status' AS status,
      coalesce(preview_row.row_value->'matchingAttributes', '{}'::jsonb) AS attributes,
      coalesce((
        SELECT jsonb_object_agg(policy_field.field_name, preview_row.row_value->'matchingAttributes'->policy_field.field_name ORDER BY policy_field.field_name)
        FROM jsonb_array_elements_text(rec->'policy'->'fields') AS policy_field(field_name)
        WHERE jsonb_typeof(preview_row.row_value->'matchingAttributes'->policy_field.field_name) = 'string'
          AND btrim(preview_row.row_value->'matchingAttributes'->>policy_field.field_name) <> ''
      ), '{}'::jsonb) AS matching_key
    FROM jsonb_array_elements(preview.manifest->'rows') AS preview_row(row_value)
  ), valid_preview_keys AS MATERIALIZED (
    -- Deduplicate equal policy keys before touching the stable-record index.
    -- A 10k-row preview with one high-multiplicity key therefore evaluates the
    -- catalog match once, then fans the result back out by locator.
    SELECT DISTINCT preview_key.matching_key
    FROM preview_rows AS preview_key
    WHERE preview_key.status = 'valid' AND jsonb_array_length(rec->'policy'->'fields') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(rec->'policy'->'fields') AS policy_field(field_name)
        WHERE jsonb_typeof(preview_key.attributes->policy_field.field_name) IS DISTINCT FROM 'string'
          OR coalesce(btrim(preview_key.attributes->>policy_field.field_name), '') = ''
      )
  ), matched_by_key AS MATERIALIZED (
    SELECT policy_key.matching_key, stable_record.id
    FROM valid_preview_keys AS policy_key
    JOIN public.src_stable_record AS stable_record
      ON stable_record.matching_attributes @> policy_key.matching_key
  ), matched AS (
    SELECT preview_row.locator, matched_key.id
    FROM preview_rows AS preview_row
    JOIN matched_by_key AS matched_key ON matched_key.matching_key = preview_row.matching_key
    WHERE preview_row.status = 'valid'
  ), ranked AS (
    SELECT matched.locator, matched.id,
      row_number() OVER (PARTITION BY matched.locator ORDER BY matched.id::text) AS candidate_ordinal
    FROM matched
  ), grouped AS (
    SELECT rows.locator,
      coalesce(jsonb_agg(to_jsonb(ranked.id::text) ORDER BY ranked.id::text) FILTER (WHERE ranked.candidate_ordinal <= 50), '[]'::jsonb) AS candidates,
      count(ranked.id)::integer AS candidate_count
    FROM preview_rows rows LEFT JOIN ranked ON ranked.locator = rows.locator
    GROUP BY rows.locator
  )
  SELECT coalesce(jsonb_object_agg(locator, candidates), '{}'::jsonb),
    coalesce(jsonb_object_agg(locator, candidate_count), '{}'::jsonb)
    INTO canonical_candidates_by_locator, canonical_candidate_counts_by_locator FROM grouped;
  -- Materialize duplicate target identities once.  The old per-line nested
  -- scan made canonical validation quadratic for a large preview.
  SELECT coalesce(jsonb_object_agg(target, true), '{}'::jsonb)
    INTO duplicate_targets
  FROM (
    SELECT nullif(value->>'stableRecordId', '') AS target
    FROM jsonb_array_elements(rec->'lines') value
    WHERE nullif(value->>'stableRecordId', '') IS NOT NULL
      AND (value->>'category' IN ('inserted', 'updated', 'unchanged') OR value->'conflict'->>'code' = 'DUPLICATE_TARGET')
    GROUP BY nullif(value->>'stableRecordId', '')
    HAVING count(*) > 1
  ) duplicate_ids;
  FOR line IN SELECT value FROM jsonb_array_elements(rec->'lines') value LOOP
    observation := line->'observation';
    canonical_row := canonical_rows_by_locator->(observation->>'locator');
    canonical_matching_attributes := coalesce(canonical_row->'matchingAttributes', '{}'::jsonb);
    expected_observation_id := CASE WHEN canonical_row IS NULL THEN NULL ELSE source_reconciliation_observation_id(preview.id, canonical_row->>'locator') END;
    IF canonical_row IS NULL OR canonical_row->>'status' NOT IN ('valid', 'rejected') OR
       jsonb_typeof(canonical_matching_attributes) <> 'object' OR
       observation->>'id' IS DISTINCT FROM expected_observation_id::text OR
       observation->>'batchId' IS DISTINCT FROM preview.batch_id::text OR
       observation->>'previewId' IS DISTINCT FROM preview.id::text OR
       observation->>'sourceFileId' IS DISTINCT FROM preview.source_file_id::text OR
       observation->>'functionalHash' IS DISTINCT FROM source_reconciliation_functional_hash(canonical_row->'normalizedPayload')::text OR
       (observation->>'observedAt')::timestamptz IS DISTINCT FROM preview.prepared_at OR
       observation->>'sourceRowHash' <> canonical_row->>'sourceRowHash' OR
       observation->'normalizedPayload' IS DISTINCT FROM canonical_row->'normalizedPayload' OR
       observation->'sourceValues' IS DISTINCT FROM canonical_row->'sourceValues' OR
       observation->'decimalSources' IS DISTINCT FROM canonical_row->'decimalSources' OR
       (observation ? 'durationSources') IS DISTINCT FROM (canonical_row ? 'durationSources') OR
       observation->'durationSources' IS DISTINCT FROM canonical_row->'durationSources' OR
       coalesce(observation->'matchingAttributes', '{}'::jsonb) IS DISTINCT FROM canonical_matching_attributes OR
       nullif(observation->>'stableRecordId', '') IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observation immutable fields are not the confirmed preview';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(observation->'normalizedPayload') value WHERE jsonb_typeof(value.value) NOT IN ('string', 'null')) OR
       EXISTS (SELECT 1 FROM jsonb_each(observation->'sourceValues') value WHERE jsonb_typeof(value.value) <> 'string') OR
       source_reconciliation_has_reserved_key(observation->'normalizedPayload') OR
       source_reconciliation_has_reserved_key(observation->'sourceValues') OR
       source_reconciliation_has_reserved_key(coalesce(observation->'matchingAttributes', '{}'::jsonb)) OR
       NOT source_reconciliation_valid_decimal_sources(CASE WHEN observation ? 'decimalSources' THEN observation->'decimalSources' ELSE NULL END) OR
       NOT source_reconciliation_valid_duration_sources(CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observation payload or provenance is not canonical';
    END IF;
    stable_attributes_present := canonical_row->>'status' = 'valid' AND jsonb_array_length(rec->'policy'->'fields') > 0
      AND jsonb_typeof(canonical_matching_attributes) = 'object'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(rec->'policy'->'fields') AS policy_field(field_name)
        WHERE jsonb_typeof(canonical_matching_attributes->policy_field.field_name) IS DISTINCT FROM 'string'
          OR coalesce(btrim(canonical_matching_attributes->>policy_field.field_name), '') = '');
    stable_attributes_present := coalesce(stable_attributes_present, false);
    canonical_candidates := coalesce(canonical_candidates_by_locator->(observation->>'locator'), '[]'::jsonb);
    canonical_outcome := CASE (canonical_candidate_counts_by_locator->>(observation->>'locator'))::integer WHEN 1 THEN 'unique' WHEN 0 THEN 'none' ELSE 'multiple' END;
    matched_target := CASE WHEN canonical_outcome = 'unique' THEN (canonical_candidates->>0)::uuid ELSE NULL END;
    line_decision := CASE WHEN p_operation = 'decision'
      THEN decisions_by_line->((observation->>'id') || ':' || (observation->>'locator'))
      ELSE NULL END;
    IF jsonb_strip_nulls((line->'decision') - 'decidedAt') IS DISTINCT FROM jsonb_strip_nulls(line_decision - 'decidedAt') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation line decision is not canonical';
    END IF;
    line_target := matched_target;
    IF line_decision->>'outcome' IN ('link', 'keep-current', 'create') THEN
      line_target := nullif(line_decision->>'stableRecordId', '')::uuid;
    ELSIF line_decision->>'outcome' = 'reject' THEN
      line_target := NULL;
    END IF;
    canonical_target := CASE WHEN line_decision->>'outcome' IN ('link', 'keep-current') THEN line_target ELSE matched_target END;
    IF line_decision->>'outcome' IN ('create', 'reject') THEN canonical_target := NULL; END IF;
    canonical_payload := NULL;
    canonical_decimal_sources := NULL;
    canonical_duration_sources := NULL;
    canonical_layer := NULL;
    canonical_state := NULL;
    SELECT effective.effective_payload,effective.decimal_sources,effective.duration_sources,
      effective.effective_layer,effective.effective_state,true
      INTO canonical_payload,canonical_decimal_sources,canonical_duration_sources,
        canonical_layer,canonical_state,canonical_pointers_valid
    FROM source_reconciliation_effective_record(canonical_target) effective;
    expected_layer := coalesce(canonical_layer, CASE WHEN canonical_target IS NULL THEN 'none' ELSE 'source' END);
    IF canonical_row->>'status' = 'rejected' THEN
      expected_category := 'rejected';
      expected_consequence := 'Esta linha não será incluída.';
      expected_match_reason := 'A linha foi rejeitada na validação da prévia.';
    ELSIF line_decision->>'outcome' = 'reject' THEN
      expected_category := 'rejected';
      expected_consequence := 'A decisão registrada rejeita esta observação.';
      expected_match_reason := CASE WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.' WHEN canonical_outcome = 'unique' THEN 'Atributos estáveis comprovam um candidato único.' WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.' ELSE 'Nenhum registro possui os atributos estáveis.' END;
    ELSIF line_decision->>'outcome' = 'create' THEN
      expected_category := 'inserted';
      expected_consequence := 'A decisão cria uma identidade interna opaca durante a aplicação.';
      expected_match_reason := CASE WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.' WHEN canonical_outcome = 'unique' THEN 'Atributos estáveis comprovam um candidato único.' WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.' ELSE 'Nenhum registro possui os atributos estáveis.' END;
    ELSIF line_decision->>'outcome' = 'keep-current' THEN
      expected_category := 'unchanged';
      expected_consequence := 'A decisão mantém a camada vigente.';
      expected_match_reason := CASE WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.' WHEN canonical_outcome = 'unique' THEN 'Atributos estáveis comprovam um candidato único.' WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.' ELSE 'Nenhum registro possui os atributos estáveis.' END;
    ELSIF line_decision->>'outcome' = 'link' THEN
      expected_category := CASE WHEN coalesce(canonical_payload, '{}'::jsonb) IS NOT DISTINCT FROM observation->'normalizedPayload'
          AND canonical_decimal_sources IS NOT DISTINCT FROM observation->'decimalSources'
          AND canonical_duration_sources IS NOT DISTINCT FROM CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END
        THEN 'unchanged' ELSE 'updated' END;
      expected_consequence := CASE WHEN expected_layer IN ('adjustment', 'decision') THEN 'A decisão auditada autoriza o novo resultado.' ELSE 'A observação aceita atualiza a projeção vigente.' END;
      expected_match_reason := CASE WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.' WHEN canonical_outcome = 'unique' THEN 'Atributos estáveis comprovam um candidato único.' WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.' ELSE 'Nenhum registro possui os atributos estáveis.' END;
    ELSIF canonical_outcome <> 'unique' THEN
      expected_category := 'conflict';
      expected_consequence := 'Esta observação aguarda uma decisão explícita.';
      expected_match_reason := CASE WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.' WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.' ELSE 'Nenhum registro possui os atributos estáveis.' END;
    ELSIF canonical_state = 'disregarded' THEN
      expected_category := 'conflict';
      expected_consequence := 'Registro desconsiderado não é reativado automaticamente.';
      expected_match_reason := 'Atributos estáveis comprovam um candidato único.';
    ELSIF expected_layer IN ('adjustment', 'decision') AND (
      coalesce(canonical_payload, '{}'::jsonb) IS DISTINCT FROM observation->'normalizedPayload' OR
      canonical_decimal_sources IS DISTINCT FROM observation->'decimalSources' OR
      canonical_duration_sources IS DISTINCT FROM CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END
    ) THEN
      expected_category := 'conflict';
      expected_consequence := 'A observação diverge de uma camada protegida e exige decisão.';
      expected_match_reason := 'Atributos estáveis comprovam um candidato único.';
    ELSE
      expected_category := CASE WHEN coalesce(canonical_payload, '{}'::jsonb) IS NOT DISTINCT FROM observation->'normalizedPayload'
          AND canonical_decimal_sources IS NOT DISTINCT FROM observation->'decimalSources'
          AND canonical_duration_sources IS NOT DISTINCT FROM CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END
        THEN 'unchanged' ELSE 'updated' END;
      expected_consequence := CASE WHEN expected_layer IN ('adjustment', 'decision') THEN 'A decisão auditada autoriza o novo resultado.' ELSE 'A observação aceita atualiza a projeção vigente.' END;
      expected_match_reason := 'Atributos estáveis comprovam um candidato único.';
    END IF;
    duplicate_target := line_target IS NOT NULL AND expected_category IN ('inserted', 'updated', 'unchanged') AND duplicate_targets ? line_target::text;
    IF duplicate_target THEN
      expected_category := 'conflict';
      expected_consequence := 'Duas observações aceitas apontam para o mesmo registro estável; resolva explicitamente.';
    END IF;
    expected_match_reason := CASE
      WHEN canonical_row->>'status' = 'rejected' THEN 'A linha foi rejeitada na validação da prévia.'
      WHEN NOT stable_attributes_present THEN 'A observação não trouxe evidência estável suficiente.'
      WHEN canonical_outcome = 'unique' THEN 'Atributos estáveis comprovam um candidato único.'
      WHEN canonical_outcome = 'multiple' THEN 'Mais de um registro possui os atributos estáveis.'
      ELSE 'Nenhum registro possui os atributos estáveis.'
    END;
    IF canonical_row->>'status' = 'rejected' AND line_decision IS NULL THEN
      expected_field_diffs := '[]'::jsonb;
    ELSE
      WITH payload_fields AS (
        SELECT key FROM jsonb_object_keys(coalesce(canonical_payload, '{}'::jsonb)) key
        UNION
        SELECT key FROM jsonb_object_keys(observation->'normalizedPayload') key
      ), payload_diffs AS (
        SELECT key AS field, NULL::text AS provenance_kind,
          coalesce(canonical_payload->key, 'null'::jsonb) AS original,
          coalesce(observation->'normalizedPayload'->key, 'null'::jsonb) AS proposed,
          coalesce(canonical_payload, '{}'::jsonb) ? key AS original_present,
          observation->'normalizedPayload' ? key AS proposed_present
        FROM payload_fields
        WHERE (coalesce(canonical_payload, '{}'::jsonb) ? key) IS DISTINCT FROM (observation->'normalizedPayload' ? key)
          OR (coalesce(canonical_payload, '{}'::jsonb)->key) IS DISTINCT FROM (observation->'normalizedPayload'->key)
      ), decimal_fields AS (
        SELECT key FROM jsonb_object_keys(coalesce(canonical_decimal_sources, '{}'::jsonb)) key
        UNION
        SELECT key FROM jsonb_object_keys(coalesce(observation->'decimalSources', '{}'::jsonb)) key
      ), decimal_diffs AS (
        SELECT key AS field, 'decimal-source'::text AS provenance_kind,
          CASE WHEN coalesce(canonical_decimal_sources, '{}'::jsonb) ? key
            THEN to_jsonb(source_reconciliation_jcs(canonical_decimal_sources->key)) ELSE 'null'::jsonb END AS original,
          CASE WHEN coalesce(observation->'decimalSources', '{}'::jsonb) ? key
            THEN to_jsonb(source_reconciliation_jcs(observation->'decimalSources'->key)) ELSE 'null'::jsonb END AS proposed,
          coalesce(canonical_decimal_sources, '{}'::jsonb) ? key AS original_present,
          coalesce(observation->'decimalSources', '{}'::jsonb) ? key AS proposed_present
        FROM decimal_fields
        WHERE (coalesce(canonical_decimal_sources, '{}'::jsonb) ? key) IS DISTINCT FROM (coalesce(observation->'decimalSources', '{}'::jsonb) ? key)
          OR (coalesce(canonical_decimal_sources, '{}'::jsonb)->key) IS DISTINCT FROM (coalesce(observation->'decimalSources', '{}'::jsonb)->key)
      ), decimal_map_diff AS (
        SELECT '*'::text AS field, 'decimal-source'::text AS provenance_kind,
          CASE WHEN canonical_decimal_sources IS NOT NULL
            THEN to_jsonb(source_reconciliation_jcs(canonical_decimal_sources)) ELSE 'null'::jsonb END AS original,
          CASE WHEN observation ? 'decimalSources'
            THEN to_jsonb(source_reconciliation_jcs(coalesce(observation->'decimalSources', '{}'::jsonb))) ELSE 'null'::jsonb END AS proposed,
          canonical_decimal_sources IS NOT NULL AS original_present,
          observation ? 'decimalSources' AS proposed_present
        WHERE NOT EXISTS (SELECT 1 FROM decimal_fields)
          AND (canonical_decimal_sources IS NOT NULL) IS DISTINCT FROM (observation ? 'decimalSources')
      ), duration_fields AS (
        SELECT key FROM jsonb_object_keys(coalesce(canonical_duration_sources, '{}'::jsonb)) key
        UNION
        SELECT key FROM jsonb_object_keys(coalesce(observation->'durationSources', '{}'::jsonb)) key
      ), duration_diffs AS (
        SELECT key AS field, 'duration-source'::text AS provenance_kind,
          CASE WHEN coalesce(canonical_duration_sources, '{}'::jsonb) ? key
            THEN to_jsonb(source_reconciliation_jcs(canonical_duration_sources->key)) ELSE 'null'::jsonb END AS original,
          CASE WHEN coalesce(observation->'durationSources', '{}'::jsonb) ? key
            THEN to_jsonb(source_reconciliation_jcs(observation->'durationSources'->key)) ELSE 'null'::jsonb END AS proposed,
          coalesce(canonical_duration_sources, '{}'::jsonb) ? key AS original_present,
          coalesce(observation->'durationSources', '{}'::jsonb) ? key AS proposed_present
        FROM duration_fields
        WHERE (coalesce(canonical_duration_sources, '{}'::jsonb) ? key) IS DISTINCT FROM (coalesce(observation->'durationSources', '{}'::jsonb) ? key)
          OR (coalesce(canonical_duration_sources, '{}'::jsonb)->key) IS DISTINCT FROM (coalesce(observation->'durationSources', '{}'::jsonb)->key)
      ), duration_map_diff AS (
        SELECT '*'::text AS field, 'duration-source'::text AS provenance_kind,
          CASE WHEN canonical_duration_sources IS NOT NULL
            THEN to_jsonb(source_reconciliation_jcs(canonical_duration_sources)) ELSE 'null'::jsonb END AS original,
          CASE WHEN observation ? 'durationSources'
            THEN to_jsonb(source_reconciliation_jcs(coalesce(observation->'durationSources', '{}'::jsonb))) ELSE 'null'::jsonb END AS proposed,
          canonical_duration_sources IS NOT NULL AS original_present,
          observation ? 'durationSources' AS proposed_present
        WHERE NOT EXISTS (SELECT 1 FROM duration_fields)
          AND (canonical_duration_sources IS NOT NULL) IS DISTINCT FROM (observation ? 'durationSources')
      ), all_diffs AS (
        SELECT * FROM payload_diffs
        UNION ALL SELECT * FROM decimal_diffs
        UNION ALL SELECT * FROM decimal_map_diff
        UNION ALL SELECT * FROM duration_diffs
        UNION ALL SELECT * FROM duration_map_diff
      )
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'field', field, 'original', original, 'proposed', proposed,
          'originalPresent', original_present, 'proposedPresent', proposed_present,
          'layer', expected_layer, 'cause', expected_consequence
        ) || CASE WHEN provenance_kind IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('provenanceKind', provenance_kind) END
        ORDER BY field, provenance_kind NULLS FIRST
      ), '[]'::jsonb)
      INTO expected_field_diffs
      FROM all_diffs;
    END IF;

    IF duplicate_target THEN
      expected_conflict := jsonb_build_object(
        'id', line->'conflict'->>'id', 'observationId', observation->>'id',
        'code', 'DUPLICATE_TARGET', 'candidateIds', jsonb_build_array(line_target::text),
        'message', 'Duas observações aceitas apontam para o mesmo registro estável; resolva explicitamente.'
      );
    ELSIF expected_category = 'conflict' AND p_operation = 'reconcile' THEN
      expected_conflict := jsonb_build_object(
        'id', line->'conflict'->>'id', 'observationId', observation->>'id',
        'code', CASE WHEN canonical_outcome = 'multiple' THEN 'MULTIPLE_CANDIDATES' WHEN canonical_outcome = 'none' THEN 'NO_CANDIDATE' WHEN canonical_state = 'disregarded' THEN 'DISREGARDED_RECORD' ELSE 'PROTECTED_LAYER' END,
        'candidateIds', canonical_candidates,
        'message', CASE WHEN canonical_outcome = 'multiple' THEN 'Há múltiplos candidatos; escolha explicitamente um registro.' WHEN canonical_outcome = 'none' THEN 'Não há candidato comprovado; escolha explicitamente criar ou vincular um registro.' WHEN canonical_state = 'disregarded' THEN 'Registro desconsiderado não é reativado automaticamente.' ELSE 'A observação diverge de uma camada protegida e exige decisão.' END
      ) || CASE WHEN expected_layer = 'none' THEN '{}'::jsonb ELSE jsonb_build_object('currentLayer', expected_layer) END;
    ELSIF p_operation = 'decision' THEN
      parent_line := parent_lines_by_key->((observation->>'id') || ':' || (observation->>'locator'));
      IF line_decision IS NULL AND parent_line IS NOT NULL THEN
        expected_category := coalesce(parent_line->>'category', expected_category);
        expected_consequence := coalesce(parent_line->>'consequence', expected_consequence);
        expected_field_diffs := coalesce(parent_line->'fieldDiffs', expected_field_diffs);
      END IF;
      expected_conflict := CASE WHEN jsonb_typeof(parent_line->'conflict') = 'object' THEN parent_line->'conflict' ELSE NULL END;
      IF expected_conflict IS NOT NULL AND line_decision IS NOT NULL THEN
        expected_conflict := jsonb_set(expected_conflict, '{resolution}', to_jsonb(line_decision->>'outcome'), true);
      END IF;
    ELSE
      expected_conflict := NULL;
    END IF;
    IF line->'match'->>'observationId' IS DISTINCT FROM observation->>'id' OR
       line->'match'->>'policyVersion' IS DISTINCT FROM rec->'policy'->>'version' OR
       line->'match'->'candidateIds' IS DISTINCT FROM canonical_candidates OR
       (line->'match'->>'candidateCount')::integer IS DISTINCT FROM (canonical_candidate_counts_by_locator->>(observation->>'locator'))::integer OR
       line->'match'->>'outcome' IS DISTINCT FROM canonical_outcome OR
       line->'match'->>'reason' IS DISTINCT FROM expected_match_reason OR
       (canonical_outcome = 'unique' AND line->'match'->>'matchedRecordId' IS DISTINCT FROM matched_target::text) OR
       (canonical_outcome <> 'unique' AND line->'match' ? 'matchedRecordId') OR
       nullif(line->>'stableRecordId', '')::uuid IS DISTINCT FROM line_target OR
       line->>'category' <> expected_category OR line->>'consequence' <> expected_consequence OR
       line->'fieldDiffs' IS DISTINCT FROM expected_field_diffs OR line->'conflict' IS DISTINCT FROM expected_conflict THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation graph is not canonically derived';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(line->'match'->'candidateIds') candidate
      WHERE NOT EXISTS (SELECT 1 FROM public.src_stable_record r WHERE r.id = candidate::uuid)) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'reconciliation candidate is unavailable';
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value->'conflict' ORDER BY ordinal) FILTER (WHERE jsonb_typeof(value->'conflict') = 'object'), '[]'::jsonb)
    INTO expected_conflicts
  FROM jsonb_array_elements(rec->'lines') WITH ORDINALITY entries(value, ordinal);
  IF rec->'conflicts' IS DISTINCT FROM expected_conflicts THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation conflicts are not derived from the lines';
  END IF;
  SELECT count(*) INTO expected_absent FROM public.src_stable_record record
    CROSS JOIN LATERAL source_reconciliation_effective_record(record.id) effective
  WHERE effective.effective_state='active' AND NOT (accepted_target_ids ? record.id::text);
  SELECT coalesce(jsonb_agg(
      jsonb_build_object('stableRecordId', record.id::text, 'status', 'not_observed_this_batch', 'label', 'Não observado neste lote') ||
      jsonb_build_object('effectivePayload', coalesce(effective.effective_payload, '{}'::jsonb)) ||
      CASE WHEN NOT effective.projection_exists THEN '{}'::jsonb ELSE jsonb_build_object('effectiveVersion', effective.projection_version::text) END
      ORDER BY record.id::text), '[]'::jsonb)
    INTO expected_absences
  FROM public.src_stable_record record
  CROSS JOIN LATERAL source_reconciliation_effective_record(record.id) effective
  WHERE effective.effective_state='active' AND NOT (accepted_target_ids ? record.id::text);
  IF rec->'absences' IS DISTINCT FROM expected_absences THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation absences are not derived from the projection';
  END IF;
  SELECT jsonb_build_object(
    'inserted', count(*) FILTER (WHERE value->>'category' = 'inserted'),
    'updated', count(*) FILTER (WHERE value->>'category' = 'updated'),
    'unchanged', count(*) FILTER (WHERE value->>'category' = 'unchanged'),
    'rejected', count(*) FILTER (WHERE value->>'category' = 'rejected'),
    'conflict', count(*) FILTER (WHERE value->>'category' = 'conflict'),
    'total', count(*), 'absent', expected_absent,
    'pendingDecisions', count(*) FILTER (WHERE jsonb_typeof(value->'conflict') = 'object' AND value->'conflict'->>'resolution' IS NULL)
  ) INTO expected_summary
  FROM jsonb_array_elements(rec->'lines') value;
  IF rec->'summary' IS DISTINCT FROM expected_summary OR
     rec->>'status' IS DISTINCT FROM (CASE WHEN (expected_summary->>'pendingDecisions')::integer > 0 THEN 'needs-decision' ELSE 'ready-to-apply' END) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation summary is not derived from the graph';
  END IF;
  expected_metrics := source_reconciliation_metrics(rec->'lines');
  IF rec->'metrics' IS DISTINCT FROM expected_metrics THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation metrics are not derived from explicit metadata';
  END IF;
  SELECT encode(sha256(convert_to(coalesce((SELECT jsonb_agg(jsonb_build_array(
      (d->>'observationId') || ':' || coalesce(d->>'locator', ''), d->>'id', d->>'observationId', d->>'locator', d->>'stableRecordId', d->>'outcome', d->>'actor',
      d->>'policyVersion', d->>'rationale', d->>'version', coalesce(nullif(d->>'revisionNo', '')::bigint, 1)
    ) ORDER BY (d->>'observationId') || ':' || coalesce(d->>'locator', '') || ':' || (d->>'id')) FROM jsonb_array_elements(rec->'decisions') d), '[]'::jsonb)::text, 'utf8')), 'hex') INTO expected_decisions_hash;
  IF p_graph->>'decisionsHash' <> expected_decisions_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reconciliation decision hash changed';
  END IF;
  IF p_operation = 'reconcile' AND jsonb_array_length(coalesce(rec->'decisions', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'initial reconciliation cannot contain decisions';
  END IF;
  IF p_operation = 'reconcile' AND (nullif(rec->>'parentReconciliationId', '') IS NOT NULL OR coalesce(nullif(rec->>'revisionNo', '')::bigint, 1) <> 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation root must have no parent and revision one';
  END IF;
  IF p_operation = 'decision' THEN
    decision := p_graph->'newDecision';
    IF jsonb_typeof(decision) <> 'object' OR nullif(decision->>'id', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'new decision is required';
    END IF;
    -- decidedAt is a server audit field. Normalize both copies of the new act
    -- before checking the immutable chain, so a caller cannot choose its clock
    -- and the stored manifest/event always agree with PostgreSQL time.
    decision := jsonb_set(decision, '{decidedAt}', to_jsonb(server_created_at), true);
    rec := jsonb_set(rec, '{decisions}', coalesce((
      SELECT jsonb_agg(CASE WHEN d->>'id' = decision->>'id'
        THEN jsonb_set(d, '{decidedAt}', to_jsonb(server_created_at), true) ELSE d END)
      FROM jsonb_array_elements(coalesce(rec->'decisions', '[]'::jsonb)) d
    ), '[]'::jsonb), true);
    rec := jsonb_set(rec, '{lines}', coalesce((
      SELECT jsonb_agg(CASE WHEN value->'decision'->>'id' = decision->>'id'
        THEN jsonb_set(value, '{decision,decidedAt}', to_jsonb(server_created_at), true) ELSE value END)
      FROM jsonb_array_elements(coalesce(rec->'lines', '[]'::jsonb)) value
    ), '[]'::jsonb), true);
    IF EXISTS (
         SELECT 1 FROM jsonb_array_elements(coalesce(rec->'decisions', '[]'::jsonb)) d
         GROUP BY d->>'id' HAVING count(*) <> 1
       ) OR
       EXISTS (
         SELECT 1 FROM source_reconciliation_decisions(parent_id) prior
         WHERE prior.id = nullif(decision->>'id', '')::uuid
       ) OR
       jsonb_array_length(coalesce(rec->'decisions', '[]'::jsonb)) <> parent_decision_count + 1 OR
       NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(rec->'decisions') d
         WHERE d->>'id' = decision->>'id'
           AND d->>'observationId' = decision->>'observationId'
           AND coalesce(d->>'locator', '') = coalesce(decision->>'locator', '')
           AND coalesce(d->>'stableRecordId', '') = coalesce(decision->>'stableRecordId', '')
           AND d->>'outcome' = decision->>'outcome'
           AND d->>'actor' = decision->>'actor'
           AND d->>'policyVersion' = decision->>'policyVersion'
           AND d->>'rationale' = decision->>'rationale'
           AND d->>'version' = decision->>'version'
           AND coalesce(nullif(d->>'revisionNo', '')::bigint, 1) = coalesce(nullif(decision->>'revisionNo', '')::bigint, 1)
           AND (d->>'decidedAt')::timestamptz = (decision->>'decidedAt')::timestamptz
       ) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(rec->'decisions') d
         WHERE d->>'id' <> decision->>'id' AND NOT EXISTS (
           SELECT 1 FROM source_reconciliation_decisions(parent_id) prior
           WHERE prior.id = (d->>'id')::uuid
             AND prior.observation_id = (d->>'observationId')::uuid
             AND coalesce(prior.locator, '') = coalesce(d->>'locator', '')
             AND prior.stable_record_id IS NOT DISTINCT FROM nullif(d->>'stableRecordId', '')::uuid
             AND prior.outcome = d->>'outcome'
             AND prior.actor = d->>'actor'
             AND prior.policy_version = d->>'policyVersion'
             AND prior.rationale = d->>'rationale'
             AND prior.version = d->>'version'
             AND prior.revision_no = coalesce(nullif(d->>'revisionNo', '')::bigint, 1)
             -- The database owns the instant and keeps microseconds; the
             -- transport DTO is canonicalized to ISO milliseconds. Compare
             -- the precision represented by the immutable chain while
             -- retaining all other decision fields as exact identity checks.
             AND date_trunc('milliseconds', prior.decided_at) = date_trunc('milliseconds', (d->>'decidedAt')::timestamptz)
         )
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision chain is not canonical';
    END IF;
    SELECT value INTO parent_line
    FROM jsonb_array_elements(source_reconciliation_materialize_manifest(parent_id)->'lines') value
    WHERE value->'observation'->>'id' = decision->>'observationId'
      AND value->'observation'->>'locator' = decision->>'locator';
    IF parent_line IS NULL OR parent_line->'conflict'->>'resolution' IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision does not resolve a pending conflict';
    END IF;
    IF (parent_line->'conflict'->>'code' = 'PROTECTED_LAYER' AND decision->>'outcome' NOT IN ('link', 'keep-current', 'reject')) OR
       (parent_line->'conflict'->>'code' = 'DISREGARDED_RECORD' AND decision->>'outcome' <> 'reject') OR
       (coalesce(parent_line->'conflict'->>'code', '') NOT IN ('PROTECTED_LAYER', 'DISREGARDED_RECORD') AND decision->>'outcome' NOT IN ('link', 'create', 'reject')) OR
       (decision->>'outcome' = 'keep-current' AND (parent_line->'conflict'->>'code' <> 'PROTECTED_LAYER' OR nullif(decision->>'stableRecordId', '')::uuid IS DISTINCT FROM coalesce(nullif(parent_line->>'stableRecordId', '')::uuid, nullif(parent_line->'match'->>'matchedRecordId', '')::uuid))) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision outcome is not allowed for the canonical conflict';
    END IF;
    SELECT value INTO decision_line
    FROM jsonb_array_elements(rec->'lines') value
    WHERE value->'observation'->>'id' = decision->>'observationId'
      AND value->'observation'->>'locator' = decision->>'locator';
    IF decision_line IS NULL OR decision_line->'decision'->>'id' <> decision->>'id' OR
       decision_line->'decision'->>'outcome' <> decision->>'outcome' OR
       coalesce(decision_line->>'stableRecordId', '') <> coalesce(decision->>'stableRecordId', '') OR
       (decision->>'outcome' = 'create' AND decision_line->>'category' <> 'inserted') OR
       (decision->>'outcome' = 'keep-current' AND decision_line->>'category' <> 'unchanged') OR
       (decision->>'outcome' = 'reject' AND decision_line->>'category' <> 'rejected') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision result is not canonical';
    END IF;
    new_line_delta := decision_line;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(rec->'lines', '[]'::jsonb)) value
      WHERE value->'observation'->>'id' = decision->>'observationId'
        AND value->'observation'->>'locator' = decision->>'locator'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision does not identify a reconciliation line';
    END IF;
    IF decision->>'outcome' IN ('link', 'keep-current') AND NOT EXISTS (
      SELECT 1
      FROM public.src_stable_record r
      LEFT JOIN public.src_effective_record_projection p ON p.record_id = r.id
      WHERE r.id = (decision->>'stableRecordId')::uuid AND coalesce(p.state, r.state) = 'active'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'decision target is unavailable';
    END IF;
    IF decision->>'outcome' = 'reject' AND nullif(decision->>'stableRecordId', '') IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reject decision cannot identify a stable record';
    END IF;
    IF decision->>'policyVersion' <> parent_policy_version THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision policy does not match its parent';
    END IF;
    IF decision->>'outcome' = 'create' AND EXISTS (SELECT 1 FROM public.src_stable_record WHERE id = nullif(decision->>'stableRecordId', '')::uuid) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'create decision stable record id already exists';
    END IF;
  END IF;
  IF p_operation = 'reconcile' THEN
    -- The fingerprint advisory lock serializes equivalent roots. Re-read only
    -- after the complete canonical validation above: a waiter may now observe
    -- the winner committed by the transaction that previously held the lock.
    SELECT * INTO existing_fingerprint_reconciliation
    FROM public.src_reconciliation r
    WHERE r.fingerprint = p_graph->>'fingerprint'
    FOR SHARE;
    IF FOUND THEN
      IF existing_fingerprint_reconciliation.confirmation_id <> confirmation.id OR
         existing_fingerprint_reconciliation.base_projection_version <> (rec->>'baseProjectionVersion')::bigint OR
         existing_fingerprint_reconciliation.decisions_hash <> p_graph->>'decisionsHash' OR
         existing_fingerprint_reconciliation.policy_version <> rec->'policy'->>'version' THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation fingerprint conflict';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.src_reconciliation_request q
        WHERE q.operation = 'reconcile' AND q.idempotency_key = p_graph->>'idempotencyKey'
          AND q.fingerprint <> p_graph->>'fingerprint'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation idempotency conflict';
      END IF;
      WITH RECURSIVE descendants(id, revision_no, created_at) AS (
        SELECT id, revision_no, created_at FROM public.src_reconciliation WHERE id = existing_fingerprint_reconciliation.id
        UNION ALL
        SELECT child.id, child.revision_no, child.created_at
        FROM public.src_reconciliation child JOIN descendants parent ON child.parent_reconciliation_id = parent.id
      )
      SELECT d.id INTO effective_reconciliation_id
      FROM descendants d
      WHERE NOT EXISTS (SELECT 1 FROM public.src_reconciliation child WHERE child.parent_reconciliation_id = d.id)
      ORDER BY d.revision_no DESC, d.created_at DESC, d.id DESC LIMIT 1;
      INSERT INTO public.src_reconciliation_request(operation,idempotency_key,fingerprint,reconciliation_id,root_reconciliation_id,root_request_hash)
        SELECT 'reconcile',p_graph->>'idempotencyKey',root.fingerprint,root.id,root.id,root.root_request_hash
        FROM public.src_reconciliation effective JOIN public.src_reconciliation root ON root.id=coalesce(effective.lineage_id,effective.id)
        WHERE effective.id=effective_reconciliation_id
        ON CONFLICT (operation, idempotency_key) DO NOTHING;
      RETURN effective_reconciliation_id;
    END IF;
  END IF;
  rec := jsonb_set(rec, '{createdAt}', to_jsonb(server_created_at), true);
  IF p_operation = 'decision' THEN
    stored_manifest := jsonb_build_object(
      'format', 'reconciliation-delta-v1', 'id', rec->>'id',
      'parentReconciliationId', rec->>'parentReconciliationId',
      'revisionNo', rec->>'revisionNo', 'status', rec->>'status'
    );
    manifest_delta := jsonb_build_object('lines', coalesce((
      SELECT jsonb_agg(value ORDER BY ordinal)
      FROM jsonb_array_elements(rec->'lines') WITH ORDINALITY entries(value, ordinal)
      WHERE parent_lines_by_key->((value->'observation'->>'id') || ':' || (value->'observation'->>'locator')) IS DISTINCT FROM value
    ), jsonb_build_array(new_line_delta)), 'metrics', rec->'metrics');
  ELSE
    stored_manifest := rec - 'absences';
    manifest_delta := '{}'::jsonb;
  END IF;
  INSERT INTO public.src_reconciliation
    (id, confirmation_id, batch_id, preview_id, source_file_id, source_sha256, contract_hash, transformation_hash, preview_hash, root_request_hash,
     policy_version, policy, base_projection_version, parent_reconciliation_id, revision_no, status, fingerprint,
     idempotency_key, decisions_hash, summary, manifest, manifest_delta, actor, created_at,
     lineage_id, decision_count, metrics, metric_accumulator_hash,absence_root_id,absence_root_hash,absence_count,absence_min,absence_max,absence_commitment)
  VALUES (rec_id, (rec->>'confirmationId')::uuid, (rec->>'batchId')::uuid, (rec->>'previewId')::uuid, (rec->>'sourceFileId')::uuid,
    rec->>'sourceSha256', rec->>'contractHash', rec->>'transformationHash', rec->>'previewHash', rec->>'rootRequestHash', rec->'policy'->>'version',
    rec->'policy', (rec->>'baseProjectionVersion')::bigint, nullif(rec->>'parentReconciliationId', '')::uuid,
    coalesce(nullif(rec->>'revisionNo', '')::bigint, 1), rec->>'status', p_graph->>'fingerprint', p_graph->>'idempotencyKey',
    p_graph->>'decisionsHash', rec->'summary', stored_manifest, manifest_delta, rec->>'actor', server_created_at,
    CASE WHEN p_operation = 'reconcile' THEN rec_id ELSE parent_lineage END,
    CASE WHEN p_operation = 'reconcile' THEN 0 ELSE parent_decision_count + 1 END,
    coalesce(rec->'metrics', '{"decimalSums":{},"durationSums":{}}'::jsonb),
    encode(sha256(convert_to(source_reconciliation_jcs(source_reconciliation_metric_accumulator(rec->'lines')),'utf8')),'hex'),avl_root_id,avl_root_hash,avl_count,avl_min,avl_max,avl_commitment);
  IF p_operation = 'reconcile' THEN
    INSERT INTO public.src_reconciliation_absence
      (reconciliation_id,lineage_id,reconciliation_revision,stable_record_id,present,ordinal,status,label,effective_payload,effective_version,created_at)
    SELECT rec_id,rec_id,coalesce(nullif(rec->>'revisionNo','')::bigint,1),(absence.value->>'stableRecordId')::uuid,true,absence.ordinal,
      absence.value->>'status', absence.value->>'label', absence.value->'effectivePayload',
      nullif(absence.value->>'effectiveVersion', ''), server_created_at
    FROM jsonb_array_elements(coalesce(rec->'absences', '[]'::jsonb)) WITH ORDINALITY absence(value, ordinal);
  ELSE
    WITH before_rows AS (
      SELECT stable_record_id, item FROM source_reconciliation_absence_rows(parent_id)
    ), after_rows AS (
      SELECT (value->>'stableRecordId')::uuid AS stable_record_id, value AS item, ordinal
      FROM jsonb_array_elements(coalesce(rec->'absences', '[]'::jsonb)) WITH ORDINALITY entries(value, ordinal)
    ), changes AS (
      SELECT coalesce(after_rows.stable_record_id, before_rows.stable_record_id) AS stable_record_id,
        after_rows.item, after_rows.ordinal, after_rows.stable_record_id IS NOT NULL AS present
      FROM before_rows FULL JOIN after_rows USING (stable_record_id)
      WHERE before_rows.item IS DISTINCT FROM after_rows.item
    )
    INSERT INTO public.src_reconciliation_absence
      (reconciliation_id,lineage_id,reconciliation_revision,stable_record_id,present,ordinal,status,label,effective_payload,effective_version,created_at)
    SELECT rec_id,parent_lineage,coalesce(nullif(rec->>'revisionNo','')::bigint,parent.revision_no+1),changes.stable_record_id,changes.present,
      CASE WHEN changes.present THEN changes.ordinal ELSE NULL END,
      CASE WHEN changes.present THEN changes.item->>'status' ELSE NULL END,
      CASE WHEN changes.present THEN changes.item->>'label' ELSE NULL END,
      CASE WHEN changes.present THEN changes.item->'effectivePayload' ELSE NULL END,
      CASE WHEN changes.present THEN nullif(changes.item->>'effectiveVersion', '') ELSE NULL END,
      server_created_at
    FROM changes;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(coalesce(rec->'lines', '[]'::jsonb)) value LOOP
    observation := line->'observation';
    v_observation_id := (observation->>'id')::uuid;
    is_create := EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(rec->'decisions', '[]'::jsonb)) d
      WHERE d->>'observationId' = observation->>'id' AND d->>'outcome' = 'create'
    ) OR (p_operation = 'decision' AND decision->>'observationId' = observation->>'id' AND decision->>'outcome' = 'create');
    IF p_operation = 'reconcile' THEN
      -- Serialize the identity before looking for an existing row. A replay
      -- must prove equality of every immutable column; ON CONFLICT is only a
      -- final idempotent guard and must never hide a divergent observation.
      PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:observation:' || v_observation_id::text, 7824001));
      SELECT * INTO existing_observation
      FROM public.src_source_observation
      WHERE id = v_observation_id
      FOR SHARE;
      IF FOUND AND (
        existing_observation.batch_id::text IS DISTINCT FROM observation->>'batchId' OR
        existing_observation.preview_id::text IS DISTINCT FROM observation->>'previewId' OR
        existing_observation.source_file_id::text IS DISTINCT FROM observation->>'sourceFileId' OR
        existing_observation.locator IS DISTINCT FROM observation->>'locator' OR
        existing_observation.source_row_hash::text IS DISTINCT FROM observation->>'sourceRowHash' OR
        existing_observation.functional_hash::text IS DISTINCT FROM observation->>'functionalHash' OR
        existing_observation.normalized_payload IS DISTINCT FROM observation->'normalizedPayload' OR
        existing_observation.source_values IS DISTINCT FROM observation->'sourceValues' OR
        existing_observation.decimal_sources IS DISTINCT FROM CASE WHEN observation ? 'decimalSources' THEN observation->'decimalSources' ELSE NULL END OR
        existing_observation.duration_sources IS DISTINCT FROM CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END OR
        existing_observation.matching_attributes IS DISTINCT FROM coalesce(observation->'matchingAttributes', '{}'::jsonb) OR
        existing_observation.stable_record_id IS DISTINCT FROM CASE WHEN is_create THEN NULL ELSE nullif(observation->>'stableRecordId', '')::uuid END OR
        existing_observation.observed_at IS DISTINCT FROM (observation->>'observedAt')::timestamptz
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'replay observation diverges from the immutable row';
      END IF;
      INSERT INTO public.src_source_observation
        (id, batch_id, preview_id, source_file_id, locator, source_row_hash, functional_hash, normalized_payload,
        source_values, decimal_sources, duration_sources, matching_attributes, stable_record_id, observed_at)
      VALUES (v_observation_id, (observation->>'batchId')::uuid, (observation->>'previewId')::uuid, (observation->>'sourceFileId')::uuid,
        observation->>'locator', observation->>'sourceRowHash', observation->>'functionalHash', observation->'normalizedPayload',
        observation->'sourceValues', CASE WHEN observation ? 'decimalSources' THEN observation->'decimalSources' ELSE NULL END,
        CASE WHEN observation ? 'durationSources' THEN observation->'durationSources' ELSE NULL END, coalesce(observation->'matchingAttributes', '{}'::jsonb),
        CASE WHEN is_create THEN NULL ELSE nullif(observation->>'stableRecordId', '')::uuid END, (observation->>'observedAt')::timestamptz)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF p_operation = 'reconcile' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:match:' || v_observation_id::text || ':' || (line->'match'->>'policyVersion'), 7824001));
      SELECT coalesce(max(m.revision_no), 0) + 1 INTO revision
      FROM public.src_record_match m WHERE m.observation_id = v_observation_id AND m.policy_version = line->'match'->>'policyVersion';
      INSERT INTO public.src_record_match
        (id, observation_id, preview_id, batch_id, source_file_id, policy_version, outcome, candidate_ids, matched_record_id, reason, created_at, revision_no)
      VALUES ((line->'match'->>'id')::uuid, v_observation_id, (observation->>'previewId')::uuid, (observation->>'batchId')::uuid,
        (observation->>'sourceFileId')::uuid, line->'match'->>'policyVersion', line->'match'->>'outcome', line->'match'->'candidateIds',
        nullif(line->'match'->>'matchedRecordId', '')::uuid, line->'match'->>'reason', (observation->>'observedAt')::timestamptz, revision);
    END IF;
  END LOOP;
  IF p_operation = 'reconcile' THEN
    FOR conflict IN SELECT value FROM jsonb_array_elements(coalesce(rec->'conflicts', '[]'::jsonb)) value LOOP
      INSERT INTO public.src_import_conflict
        (id, reconciliation_id, preview_id, batch_id, source_file_id, observation_id, code, candidate_ids, current_layer, message, created_at)
      VALUES ((conflict->>'id')::uuid, rec_id,
        (rec->>'previewId')::uuid, (rec->>'batchId')::uuid, (rec->>'sourceFileId')::uuid, (conflict->>'observationId')::uuid,
        conflict->>'code', conflict->'candidateIds', nullif(conflict->>'currentLayer', ''), conflict->>'message', server_created_at);
    END LOOP;
  END IF;
  IF p_operation = 'decision' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:decision:' || (decision->>'observationId') || ':' || (decision->>'locator'), 7824001));
    SELECT coalesce(max(d.revision_no), 0) + 1 INTO revision
    FROM source_reconciliation_decisions(parent_id) d
    WHERE d.observation_id = (decision->>'observationId')::uuid AND d.locator = decision->>'locator';
    INSERT INTO public.src_reconciliation_decision
      (id, reconciliation_id, preview_id, batch_id, source_file_id, lineage_id, observation_id, locator, stable_record_id, outcome, actor,
       decided_at, policy_version, rationale, version, revision_no)
    VALUES ((decision->>'id')::uuid, rec_id, (rec->>'previewId')::uuid, (rec->>'batchId')::uuid, (rec->>'sourceFileId')::uuid,
      parent_lineage, (decision->>'observationId')::uuid, decision->>'locator', nullif(decision->>'stableRecordId', '')::uuid, decision->>'outcome',
      decision->>'actor', (decision->>'decidedAt')::timestamptz, decision->>'policyVersion', decision->>'rationale', decision->>'version', revision);
  END IF;
  INSERT INTO public.src_reconciliation_line_state
    (reconciliation_id, lineage_id, reconciliation_revision, observation_id, locator, ordinal, line,
     target_id, accepted_target_id, absence_target_id, pending_decision, category, created_at)
  SELECT rec_id,
    CASE WHEN p_operation = 'reconcile' THEN rec_id ELSE parent_lineage END,
    coalesce(nullif(rec->>'revisionNo', '')::bigint, 1),
    (entry.value->'observation'->>'id')::uuid, entry.value->'observation'->>'locator', entry.ordinal,
    entry.value, nullif(entry.value->>'stableRecordId', '')::uuid,
    CASE WHEN entry.value->>'category' IN ('inserted','updated','unchanged') OR entry.value->'conflict'->>'code'='DUPLICATE_TARGET'
      THEN nullif(entry.value->>'stableRecordId','')::uuid ELSE NULL END,
    CASE
      WHEN entry.value->'decision'->>'outcome' IN ('link', 'create', 'keep-current') THEN nullif(entry.value->>'stableRecordId', '')::uuid
      WHEN entry.value->'decision'->>'outcome' = 'reject' THEN nullif(entry.value->'match'->>'matchedRecordId', '')::uuid
      WHEN entry.value->'conflict'->>'code' IN ('PROTECTED_LAYER','DUPLICATE_TARGET') THEN coalesce(nullif(entry.value->>'stableRecordId','')::uuid,nullif(entry.value->'match'->>'matchedRecordId','')::uuid)
      WHEN entry.value->'match'->>'outcome' = 'unique' THEN nullif(entry.value->'match'->>'matchedRecordId', '')::uuid
      WHEN entry.value->>'category' IN ('inserted', 'updated', 'unchanged') THEN nullif(entry.value->>'stableRecordId', '')::uuid
      ELSE NULL END,
    coalesce(jsonb_typeof(entry.value->'conflict') = 'object' AND coalesce(entry.value->'conflict'->>'resolution', '') = '', false),
    entry.value->>'category', server_created_at
  FROM jsonb_array_elements(CASE WHEN p_operation = 'reconcile' THEN rec->'lines'
    ELSE coalesce(manifest_delta->'lines', '[]'::jsonb) END) WITH ORDINALITY entry(value, ordinal);

  INSERT INTO public.src_reconciliation_line_head
    (lineage_id, observation_id, locator, reconciliation_id, reconciliation_revision, ordinal, line,
     target_id, accepted_target_id, absence_target_id, pending_decision, category)
  SELECT state.lineage_id, state.observation_id, state.locator, state.reconciliation_id,
    state.reconciliation_revision, state.ordinal, state.line, state.target_id,
    CASE WHEN state.category IN ('inserted','updated','unchanged') OR state.line->'conflict'->>'code'='DUPLICATE_TARGET' THEN state.target_id ELSE NULL END,
    state.absence_target_id, state.pending_decision, state.category
  FROM public.src_reconciliation_line_state state WHERE state.reconciliation_id = rec_id
  ON CONFLICT (lineage_id, observation_id, locator) DO UPDATE SET
    reconciliation_id=EXCLUDED.reconciliation_id, reconciliation_revision=EXCLUDED.reconciliation_revision,
    line=EXCLUDED.line, target_id=EXCLUDED.target_id, accepted_target_id=EXCLUDED.accepted_target_id, absence_target_id=EXCLUDED.absence_target_id,
    pending_decision=EXCLUDED.pending_decision, category=EXCLUDED.category;
  IF p_operation = 'reconcile' THEN
    INSERT INTO public.src_reconciliation_head(lineage_id, leaf_reconciliation_id, revision_no, updated_at)
      VALUES (rec_id, rec_id, 1, server_created_at);
    INSERT INTO public.src_reconciliation_observed_target_head(lineage_id, stable_record_id, reference_count)
      SELECT rec_id, absence_target_id, count(*)::integer FROM public.src_reconciliation_line_head
      WHERE lineage_id=rec_id AND absence_target_id IS NOT NULL GROUP BY absence_target_id;
    INSERT INTO public.src_reconciliation_target_bucket_head(lineage_id,stable_record_id,reference_count)
      SELECT rec_id,accepted_target_id,count(*)::integer FROM public.src_reconciliation_line_head
      WHERE lineage_id=rec_id AND accepted_target_id IS NOT NULL GROUP BY accepted_target_id;
    INSERT INTO public.src_reconciliation_target_bucket_transition(reconciliation_id,lineage_id,stable_record_id,reference_delta,reference_count,created_at)
      SELECT rec_id,rec_id,stable_record_id,reference_count,reference_count,server_created_at
      FROM public.src_reconciliation_target_bucket_head WHERE lineage_id=rec_id;
    INSERT INTO public.src_reconciliation_absence_head(lineage_id, stable_record_id, status, label, effective_payload, effective_version)
      SELECT rec_id, stable_record_id, status, label, effective_payload, effective_version
      FROM public.src_reconciliation_absence WHERE reconciliation_id=rec_id AND present;
    INSERT INTO public.src_reconciliation_absence_key(lineage_id,stable_record_id)
      SELECT rec_id,stable_record_id FROM public.src_reconciliation_absence_head WHERE lineage_id=rec_id;
    INSERT INTO public.src_reconciliation_absence_span(lineage_id,stable_record_id,valid_from_revision,status,label,effective_payload,effective_version)
      SELECT rec_id,stable_record_id,1,status,label,effective_payload,effective_version
      FROM public.src_reconciliation_absence_head WHERE lineage_id=rec_id;
    INSERT INTO public.src_reconciliation_metric_head(lineage_id, metrics, accumulator, updated_at)
      VALUES (rec_id, coalesce(rec->'metrics', '{"decimalSums":{},"durationSums":{}}'::jsonb),
        source_reconciliation_metric_accumulator(rec->'lines'), server_created_at);
  ELSE
    UPDATE public.src_reconciliation_head SET leaf_reconciliation_id=rec_id,
      revision_no=coalesce(nullif(rec->>'revisionNo','')::bigint, revision_no+1), updated_at=server_created_at
      WHERE lineage_id=coalesce(parent.lineage_id,parent.id);
    UPDATE public.src_reconciliation_metric_head SET metrics=coalesce(rec->'metrics',metrics),
      accumulator=source_reconciliation_metric_accumulator(rec->'lines'),updated_at=server_created_at
      WHERE lineage_id=coalesce(parent.lineage_id,parent.id);
  END IF;

  INSERT INTO public.src_reconciliation_request (operation,idempotency_key,fingerprint,reconciliation_id,root_reconciliation_id,root_request_hash)
  VALUES (p_operation,p_graph->>'idempotencyKey',p_graph->>'fingerprint',rec_id,rec_id,rec->>'rootRequestHash');
  IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation_head h WHERE h.lineage_id=rec_id AND h.leaf_reconciliation_id=rec_id) OR (SELECT version FROM public.src_projection_version WHERE singleton)<>current_projection THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='reconciliation epochs changed during write';END IF;
  RETURN rec_id;
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_field_diffs(p_observation jsonb, p_target_id uuid, p_cause text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_payload jsonb := '{}'::jsonb;
  target_decimal jsonb;
  target_duration jsonb;
  target_layer text := 'none';
  proposed_payload jsonb := coalesce(p_observation->'normalizedPayload','{}'::jsonb);
  proposed_decimal jsonb := CASE WHEN p_observation ? 'decimalSources' THEN p_observation->'decimalSources' ELSE NULL END;
  proposed_duration jsonb := CASE WHEN p_observation ? 'durationSources' THEN p_observation->'durationSources' ELSE NULL END;
  field text;
  result jsonb := '[]'::jsonb;
  original_present boolean;
  proposed_present boolean;
  original_value jsonb;
  proposed_value jsonb;
  kind text;
BEGIN
  IF p_target_id IS NOT NULL THEN
    SELECT effective.effective_payload,effective.decimal_sources,effective.duration_sources,effective.effective_layer
    INTO target_payload,target_decimal,target_duration,target_layer
    FROM source_reconciliation_effective_record(p_target_id) effective;
    IF NOT FOUND THEN target_payload:='{}'::jsonb; target_decimal:=NULL; target_duration:=NULL; target_layer:='none'; END IF;
  END IF;
  FOR field IN SELECT key FROM (SELECT jsonb_object_keys(target_payload) key UNION SELECT jsonb_object_keys(proposed_payload)) fields ORDER BY key COLLATE "C" LOOP
    original_present:=target_payload ? field; proposed_present:=proposed_payload ? field;
    IF original_present IS DISTINCT FROM proposed_present OR target_payload->field IS DISTINCT FROM proposed_payload->field THEN
      result:=result||jsonb_build_array(jsonb_build_object('field',field,'original',CASE WHEN original_present THEN target_payload->field ELSE 'null'::jsonb END,
        'proposed',CASE WHEN proposed_present THEN proposed_payload->field ELSE 'null'::jsonb END,'originalPresent',original_present,
        'proposedPresent',proposed_present,'layer',target_layer,'cause',p_cause));
    END IF;
  END LOOP;
  FOREACH kind IN ARRAY ARRAY['decimal-source','duration-source'] LOOP
    original_value:=CASE kind WHEN 'decimal-source' THEN target_decimal ELSE target_duration END;
    proposed_value:=CASE kind WHEN 'decimal-source' THEN proposed_decimal ELSE proposed_duration END;
    IF NOT EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(original_value,'{}'::jsonb))) AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(proposed_value,'{}'::jsonb))) AND
       (original_value IS NULL) IS DISTINCT FROM (proposed_value IS NULL) THEN
      result:=result||jsonb_build_array(jsonb_build_object('field','*','original',CASE WHEN original_value IS NULL THEN NULL ELSE source_reconciliation_jcs(original_value) END,
        'proposed',CASE WHEN proposed_value IS NULL THEN NULL ELSE source_reconciliation_jcs(proposed_value) END,
        'originalPresent',original_value IS NOT NULL,'proposedPresent',proposed_value IS NOT NULL,'provenanceKind',kind,'layer',target_layer,'cause',p_cause));
    ELSE
      FOR field IN SELECT key FROM (SELECT jsonb_object_keys(coalesce(original_value,'{}'::jsonb)) key UNION SELECT jsonb_object_keys(coalesce(proposed_value,'{}'::jsonb))) fields ORDER BY key COLLATE "C" LOOP
        original_present:=original_value IS NOT NULL AND original_value ? field;
        proposed_present:=proposed_value IS NOT NULL AND proposed_value ? field;
        IF original_present IS DISTINCT FROM proposed_present OR original_value->field IS DISTINCT FROM proposed_value->field THEN
          result:=result||jsonb_build_array(jsonb_build_object('field',field,'original',CASE WHEN original_present THEN source_reconciliation_jcs(original_value->field) ELSE NULL END,
            'proposed',CASE WHEN proposed_present THEN source_reconciliation_jcs(proposed_value->field) ELSE NULL END,
            'originalPresent',original_present,'proposedPresent',proposed_present,'provenanceKind',kind,'layer',target_layer,'cause',p_cause));
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'field',CASE WHEN NOT (value ? 'provenanceKind') THEN 0 WHEN value->>'provenanceKind'='decimal-source' THEN 1 ELSE 2 END),'[]'::jsonb)
    INTO result FROM jsonb_array_elements(result) value;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_chain_hash(p_lineage uuid,p_parent_fingerprint text,p_parent_decisions_hash text,p_decision jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH canonical AS (
    SELECT encode(sha256(convert_to(source_reconciliation_jcs(p_delta),'utf8')),'hex') AS delta_hash,
      source_reconciliation_jcs(p_decision-'decidedAt') AS decision_text
  ), decision_hash AS (
    SELECT encode(sha256(convert_to('decision-chain-v4:'||p_lineage::text||':'||p_parent_decisions_hash||':'||decision_text||':'||delta_hash,'utf8')),'hex') value FROM canonical
  ) SELECT jsonb_build_object('decisionsHash',value,'fingerprint',encode(sha256(convert_to('reconciliation-chain-v4:'||p_lineage::text||':'||p_parent_fingerprint||':'||value,'utf8')),'hex')) FROM decision_hash
$$;

CREATE OR REPLACE FUNCTION write_source_reconciliation_decision(
  p_parent_id uuid, p_intent jsonb, p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  parent public.src_reconciliation%ROWTYPE;
  head public.src_reconciliation_head%ROWTYPE;
  current_line public.src_reconciliation_line_head%ROWTYPE;
  existing_decision public.src_reconciliation_decision%ROWTYPE;
  replay_child public.src_reconciliation%ROWTYPE;
  replay_parent public.src_reconciliation%ROWTYPE;
  replay_leaf public.src_reconciliation%ROWTYPE;
  replay_chain jsonb;
  decision_id uuid;
  decision_line_revision integer;
  -- Assigned only after the session_user guard and lexical UUID validation.
  decision_target uuid;
  persisted_target uuid;
  decision_outcome_v text := p_intent->>'outcome';
  server_time timestamptz := clock_timestamp();
  next_id uuid := gen_random_uuid();
  next_revision bigint;
  next_pending integer;
  next_status text;
  next_summary jsonb;
  next_metrics jsonb;
  next_fingerprint char(64);
  next_decisions_hash char(64);
  new_line jsonb;
  consequence text;
  next_category text;
  target_payload jsonb;
  target_decimal jsonb;
  target_duration jsonb;
  target_layer text;
  target_state text;
  old_absence_target uuid;
  new_absence_target uuid;
  old_count integer;
  new_count integer;
  lineage uuid;
  result_decision jsonb;
  changed_absences integer := 0;
  metric_field text;
  old_metadata jsonb;
  new_metadata jsonb;
  metric_total numeric;
  metric_scale integer;
  duration_total numeric;
  metric_accumulator jsonb;
  metric_entry jsonb;
  scale_counts jsonb;
  source_count integer;
  nonnull_count integer;
  old_present boolean;
  new_present boolean;
  provisional_accepted_target uuid;
  affected_targets uuid[];
  bucket_target uuid;
  bucket_count integer;
  bucket_line record;
  old_bucket_line jsonb;
  bucket_consequence text;
  bucket_category text;
  bucket_pending boolean;
  bucket_line_json jsonb;
  bucket_changes jsonb;
  bucket_transitions jsonb := '[]'::jsonb;
  changed_lines jsonb := '[]'::jsonb;
  absence_changes jsonb := '[]'::jsonb;
  change_entry jsonb;
  metric_changes jsonb := '[]'::jsonb;
  old_bucket_count integer;
  old_sole_line jsonb;
  new_sole_line jsonb;
  old_contributor_decimal jsonb;
  old_contributor_duration jsonb;
  new_contributor_decimal jsonb;
  new_contributor_duration jsonb;
  derived_delta jsonb;
  chain_result jsonb;
  canonical_policy_fields jsonb;
  preview_manifest jsonb;
  next_absence_root_id uuid;
  next_absence_root public.src_reconciliation_absence_node%ROWTYPE;
  next_absence_root_hash bytea;
  next_absence_count bigint;
  next_absence_min uuid;
  next_absence_max uuid;
  next_absence_commitment bytea;
  next_absence_commitment_json jsonb;
BEGIN
  IF session_user <> 'tria_app' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='atomic reconciliation decision is restricted to the application role';
  END IF;
  IF p_parent_id IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_intent) <> 'object' OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(p_intent) key WHERE key NOT IN
       ('observationId','locator','stableRecordId','outcome','policyVersion','rationale','version')) OR
     coalesce(p_intent->>'observationId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     (p_intent ? 'stableRecordId' AND coalesce(p_intent->>'stableRecordId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR
     length(coalesce(p_intent->>'locator','')) NOT BETWEEN 1 AND 200 OR p_intent->>'locator'<>btrim(p_intent->>'locator') OR
     length(btrim(coalesce(p_intent->>'rationale',''))) NOT BETWEEN 3 AND 1000 OR p_intent->>'rationale'<>btrim(p_intent->>'rationale') OR
     length(coalesce(p_intent->>'version','')) NOT BETWEEN 1 AND 120 OR length(coalesce(p_intent->>'policyVersion','')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid atomic reconciliation decision intent';
  END IF;
  decision_target:=nullif(p_intent->>'stableRecordId','')::uuid;
  decision_outcome_v:=p_intent->>'outcome';
  SELECT * INTO parent FROM public.src_reconciliation WHERE id=p_parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='reconciliation not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:confirmation:'||parent.confirmation_id::text,7824001));
  SELECT * INTO parent FROM public.src_reconciliation WHERE id=p_parent_id FOR SHARE;
  lineage := coalesce(parent.lineage_id,parent.id);
  PERFORM source_reconciliation_verify_absence_anchor(parent.id);
  SELECT preview.manifest INTO preview_manifest FROM public.src_import_preview preview WHERE preview.id=parent.preview_id;
  canonical_policy_fields:=public.source_reconciliation_canonical_matching_fields(preview_manifest);
  IF preview_manifest IS NULL OR jsonb_typeof(parent.policy)<>'object' OR
     EXISTS(SELECT 1 FROM jsonb_object_keys(parent.policy) key WHERE key NOT IN ('version','fields','evidence')) OR
     parent.policy->>'version'<>'server-owned-preview-matching-v1' OR
     parent.policy->>'evidence'<>'explicit-stable-attributes' OR jsonb_typeof(parent.policy->'fields')<>'array' OR
     parent.policy->'fields' IS DISTINCT FROM canonical_policy_fields OR parent.policy_version IS DISTINCT FROM parent.policy->>'version' THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation policy is not canonical';
  END IF;
  IF p_intent->>'policyVersion' IS DISTINCT FROM parent.policy_version OR
     length(coalesce(p_intent->>'rationale',''))<3 OR length(coalesce(p_intent->>'version',''))<1 OR
     decision_outcome_v NOT IN ('link','create','keep-current','reject') OR
     (decision_outcome_v IN ('create','reject') AND decision_target IS NOT NULL) OR
     (decision_outcome_v IN ('link','keep-current') AND decision_target IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid reconciliation decision intent';
  END IF;
  SELECT * INTO head FROM public.src_reconciliation_head WHERE lineage_id=lineage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='XX001', MESSAGE='reconciliation head not found'; END IF;
  SELECT d.* INTO existing_decision
  FROM public.src_reconciliation_decision d JOIN public.src_reconciliation child ON child.id=d.reconciliation_id
  WHERE d.lineage_id=lineage AND d.observation_id=(p_intent->>'observationId')::uuid AND d.locator=p_intent->>'locator' AND d.outcome=decision_outcome_v
    AND (decision_outcome_v='create' OR d.stable_record_id IS NOT DISTINCT FROM decision_target) AND d.policy_version=p_intent->>'policyVersion' AND d.rationale=p_intent->>'rationale' AND d.version=p_intent->>'version'
    AND child.revision_no<=(SELECT revision_no FROM public.src_reconciliation WHERE id=head.leaf_reconciliation_id)
  ORDER BY d.revision_no DESC LIMIT 1;
  IF FOUND THEN
    SELECT * INTO replay_child FROM public.src_reconciliation WHERE id=existing_decision.reconciliation_id;
    SELECT * INTO replay_parent FROM public.src_reconciliation WHERE id=replay_child.parent_reconciliation_id;
    result_decision:=jsonb_strip_nulls(jsonb_build_object('id',existing_decision.id::text,'observationId',existing_decision.observation_id::text,'locator',existing_decision.locator,'stableRecordId',existing_decision.stable_record_id::text,'outcome',existing_decision.outcome,'actor',existing_decision.actor,'decidedAt',existing_decision.decided_at,'policyVersion',existing_decision.policy_version,'rationale',existing_decision.rationale,'version',existing_decision.version,'revisionNo',existing_decision.revision_no));
    replay_chain:=source_reconciliation_chain_hash(lineage,replay_parent.fingerprint,replay_parent.decisions_hash,result_decision,replay_child.manifest_delta);
    IF replay_chain->>'fingerprint'<>replay_child.fingerprint OR replay_chain->>'decisionsHash'<>replay_child.decisions_hash OR replay_child.root_request_hash<>replay_parent.root_request_hash THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='decision replay chain is corrupt';END IF;
    SELECT * INTO replay_leaf FROM public.src_reconciliation WHERE id=head.leaf_reconciliation_id;PERFORM source_reconciliation_verify_lineage(replay_leaf.id);
    RETURN jsonb_build_object('id',replay_leaf.id::text,'reconciliationId',replay_leaf.id::text,'parentReconciliationId',replay_leaf.parent_reconciliation_id::text,'revisionNo',replay_leaf.revision_no::text,'fingerprint',replay_leaf.fingerprint,'status',CASE WHEN EXISTS(SELECT 1 FROM public.src_reconciliation_application application WHERE application.reconciliation_id=replay_leaf.id) THEN 'applied' ELSE replay_leaf.status END,'summary',replay_leaf.summary,'metrics',replay_leaf.metrics,'decision',result_decision,'changedLines','[]'::jsonb,'absenceChanges','[]'::jsonb,'decisionCount',replay_leaf.decision_count,'reused',true,'canonicalReopenRequired',true,'createdAt',replay_leaf.created_at);
  END IF;
  IF head.leaf_reconciliation_id <> p_parent_id THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='reconciliation parent is not the current leaf',DETAIL=head.leaf_reconciliation_id::text;END IF;
  SELECT accumulator INTO metric_accumulator FROM public.src_reconciliation_metric_head WHERE lineage_id=lineage FOR UPDATE;
  metric_accumulator := coalesce(metric_accumulator,'{"decimal":{},"duration":{}}'::jsonb);
  IF parent.metric_accumulator_hash<>encode(sha256(convert_to(source_reconciliation_jcs(metric_accumulator),'utf8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation metric accumulator head changed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.src_reconciliation_application WHERE reconciliation_id=p_parent_id) OR parent.status='applied' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='reconciliation already applied';
  END IF;
  IF parent.base_projection_version IS DISTINCT FROM (SELECT version FROM public.src_projection_version WHERE singleton FOR SHARE) THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='reconciliation projection version changed';
  END IF;
  SELECT * INTO current_line FROM public.src_reconciliation_line_head
    WHERE lineage_id=lineage AND observation_id=(p_intent->>'observationId')::uuid AND locator=p_intent->>'locator' FOR UPDATE;
  IF NOT FOUND OR NOT current_line.pending_decision OR jsonb_typeof(current_line.line->'conflict') <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='decision must resolve the addressed pending conflict';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation_line_state s WHERE s.lineage_id=lineage
      AND s.observation_id=current_line.observation_id AND s.locator=current_line.locator
      AND s.reconciliation_revision=current_line.reconciliation_revision AND s.line=current_line.line
      AND s.target_id IS NOT DISTINCT FROM current_line.target_id AND s.accepted_target_id IS NOT DISTINCT FROM current_line.accepted_target_id
      AND s.absence_target_id IS NOT DISTINCT FROM current_line.absence_target_id AND s.pending_decision=current_line.pending_decision AND s.category=current_line.category) THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation line head changed';
  END IF;
  IF current_line.line->'conflict'->>'code'='PROTECTED_LAYER' AND decision_outcome_v NOT IN ('link','keep-current','reject') OR
     current_line.line->'conflict'->>'code'='DISREGARDED_RECORD' AND decision_outcome_v <> 'reject' OR
     current_line.line->'conflict'->>'code'='DUPLICATE_TARGET' AND decision_outcome_v='keep-current' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outcome is not allowed for this conflict';
  END IF;
  IF decision_outcome_v='keep-current' AND decision_target IS DISTINCT FROM coalesce(current_line.target_id,
      nullif(current_line.line->'match'->>'matchedRecordId','')::uuid) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='keep-current must retain the protected target';
  END IF;
  IF decision_outcome_v IN ('link','keep-current') THEN
    PERFORM 1 FROM public.src_stable_record record WHERE record.id=decision_target FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='stable record target unavailable'; END IF;
    SELECT effective.effective_payload,effective.decimal_sources,effective.duration_sources,
      effective.effective_layer,effective.effective_state
    INTO target_payload,target_decimal,target_duration,target_layer,target_state
    FROM source_reconciliation_effective_record(decision_target) effective;
    IF NOT FOUND OR target_state='disregarded' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='stable record target unavailable';
    END IF;
  ELSIF decision_outcome_v='create' THEN
    persisted_target := gen_random_uuid();
  END IF;
  persisted_target := coalesce(persisted_target,decision_target);
  decision_id := gen_random_uuid();
  next_revision := parent.revision_no+1;
  consequence := CASE decision_outcome_v
    WHEN 'reject' THEN 'A decisão registrada rejeita esta observação.'
    WHEN 'create' THEN 'A decisão cria uma identidade interna opaca durante a aplicação.'
    WHEN 'keep-current' THEN 'A decisão mantém a camada vigente.'
    ELSE CASE WHEN target_layer IN ('adjustment','decision') THEN 'A decisão auditada autoriza o novo resultado.' ELSE 'A observação aceita atualiza a projeção vigente.' END END;
  next_category := CASE decision_outcome_v WHEN 'reject' THEN 'rejected' WHEN 'create' THEN 'inserted' WHEN 'keep-current' THEN 'unchanged'
    ELSE CASE WHEN coalesce(target_payload,'{}'::jsonb) IS NOT DISTINCT FROM current_line.line->'observation'->'normalizedPayload'
      AND target_decimal IS NOT DISTINCT FROM CASE WHEN current_line.line->'observation' ? 'decimalSources' THEN current_line.line->'observation'->'decimalSources' ELSE NULL END
      AND target_duration IS NOT DISTINCT FROM CASE WHEN current_line.line->'observation' ? 'durationSources' THEN current_line.line->'observation'->'durationSources' ELSE NULL END
      THEN 'unchanged' ELSE 'updated' END END;
  SELECT coalesce(max(revision_no),0)+1 INTO decision_line_revision FROM public.src_reconciliation_decision
    WHERE lineage_id=lineage AND observation_id=current_line.observation_id AND locator=current_line.locator;
  result_decision := jsonb_strip_nulls(jsonb_build_object('id',decision_id::text,'observationId',p_intent->>'observationId',
    'locator',p_intent->>'locator','stableRecordId',persisted_target::text,'outcome',decision_outcome_v,'actor','Rodrigo','decidedAt',server_time,
    'policyVersion',parent.policy_version,'rationale',p_intent->>'rationale','version',p_intent->>'version','revisionNo',
    decision_line_revision));
  new_line := current_line.line || jsonb_build_object('category',next_category,'consequence',consequence,'decision',result_decision);
  IF persisted_target IS NULL THEN new_line := new_line-'stableRecordId';
  ELSE new_line := jsonb_set(new_line,'{stableRecordId}',to_jsonb(persisted_target::text),true); END IF;
  IF jsonb_typeof(new_line->'conflict')='object' THEN new_line:=jsonb_set(new_line,'{conflict,resolution}',to_jsonb(decision_outcome_v),true); END IF;
  new_line:=jsonb_set(new_line,'{fieldDiffs}',source_reconciliation_field_diffs(new_line->'observation',persisted_target,consequence),true);
  provisional_accepted_target:=CASE WHEN next_category IN ('inserted','updated','unchanged') THEN persisted_target ELSE NULL END;
  SELECT coalesce(array_agg(DISTINCT value),ARRAY[]::uuid[]) INTO affected_targets FROM unnest(ARRAY[current_line.accepted_target_id,provisional_accepted_target]) value WHERE value IS NOT NULL;
  next_summary:=parent.summary;

  FOREACH bucket_target IN ARRAY affected_targets LOOP
    -- Authenticate the O(1) mutable bucket counter against its latest
    -- append-only transition. Do not rescan the unchanged K-line bucket.
    old_bucket_count := 0;
    SELECT reference_count INTO old_bucket_count FROM public.src_reconciliation_target_bucket_head
      WHERE lineage_id=lineage AND stable_record_id=bucket_target FOR UPDATE;
    old_bucket_count := coalesce(old_bucket_count,0);
    IF coalesce((SELECT transition.reference_count FROM public.src_reconciliation_target_bucket_transition transition
          WHERE transition.lineage_id=lineage AND transition.stable_record_id=bucket_target
          ORDER BY transition.created_at DESC,transition.reconciliation_id DESC LIMIT 1),0) <> old_bucket_count THEN
      RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation target bucket head changed';
    END IF;
    bucket_count := old_bucket_count
      - CASE WHEN current_line.accepted_target_id=bucket_target AND provisional_accepted_target IS DISTINCT FROM bucket_target THEN 1 ELSE 0 END
      + CASE WHEN current_line.accepted_target_id IS DISTINCT FROM bucket_target AND provisional_accepted_target=bucket_target THEN 1 ELSE 0 END;
    IF bucket_count < 0 THEN
      RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation target bucket count is invalid';
    END IF;
    SELECT effective.effective_payload,effective.decimal_sources,effective.duration_sources,effective.effective_layer
      INTO target_payload,target_decimal,target_duration,target_layer
    FROM source_reconciliation_effective_record(bucket_target) effective;
    old_sole_line := NULL;
    IF old_bucket_count=1 THEN
      SELECT line INTO old_sole_line FROM public.src_reconciliation_line_head
        WHERE lineage_id=lineage AND accepted_target_id=bucket_target ORDER BY ordinal LIMIT 1;
    END IF;
    IF bucket_count IS DISTINCT FROM old_bucket_count THEN
      bucket_transitions:=bucket_transitions||jsonb_build_array(jsonb_build_object('stableRecordId',bucket_target::text,
        'oldCount',old_bucket_count,'newCount',bucket_count,'delta',bucket_count-old_bucket_count));
    END IF;
    old_contributor_decimal:=CASE WHEN old_bucket_count=1 AND old_sole_line->>'category' IN ('inserted','updated','unchanged') AND coalesce(old_sole_line->'decision'->>'outcome','')<>'keep-current'
      THEN CASE WHEN old_sole_line->'observation' ? 'decimalSources' THEN old_sole_line->'observation'->'decimalSources' ELSE NULL END ELSE target_decimal END;
    old_contributor_duration:=CASE WHEN old_bucket_count=1 AND old_sole_line->>'category' IN ('inserted','updated','unchanged') AND coalesce(old_sole_line->'decision'->>'outcome','')<>'keep-current'
      THEN CASE WHEN old_sole_line->'observation' ? 'durationSources' THEN old_sole_line->'observation'->'durationSources' ELSE NULL END ELSE target_duration END;
    WITH candidates AS (
      SELECT lh.observation_id,lh.locator,lh.ordinal,lh.line,lh.line AS old_line,lh.absence_target_id,lh.pending_decision AS old_pending,lh.category AS old_category
      FROM public.src_reconciliation_line_head lh WHERE lh.lineage_id=lineage AND lh.accepted_target_id=bucket_target
        AND NOT (lh.observation_id=current_line.observation_id AND lh.locator=current_line.locator)
        -- Only a 1 -> 2 transition changes an untouched sibling. Once a
        -- bucket is conflicting, later decisions change the addressed row
        -- only; a 2 -> 1 transition deliberately leaves the sibling pending.
        AND old_bucket_count<2 AND bucket_count>=2
      UNION ALL
      SELECT current_line.observation_id,current_line.locator,current_line.ordinal,new_line,current_line.line,
        persisted_target,current_line.pending_decision,current_line.category WHERE provisional_accepted_target=bucket_target
    ), derived AS (
      SELECT candidate.*, d.category,d.consequence,d.pending,
        CASE WHEN bucket_count<2 AND candidate.old_line->'conflict'->>'code'='DUPLICATE_TARGET' AND coalesce(jsonb_typeof(candidate.line->'decision'),'null')<>'object' THEN candidate.old_line
        WHEN bucket_count>=2 THEN candidate.line||jsonb_build_object('category','conflict','stableRecordId',bucket_target::text,'consequence',d.consequence,
          'conflict',jsonb_build_object('id',CASE WHEN candidate.old_line->'conflict'->>'code'='DUPLICATE_TARGET' THEN candidate.old_line->'conflict'->>'id' ELSE gen_random_uuid()::text END,
            'observationId',candidate.observation_id::text,'code','DUPLICATE_TARGET','candidateIds',jsonb_build_array(bucket_target::text),'message',d.consequence))
        ELSE candidate.line||jsonb_build_object('category',d.category,'stableRecordId',bucket_target::text,'consequence',d.consequence) END AS base_line
      FROM candidates candidate CROSS JOIN LATERAL (
        SELECT CASE WHEN bucket_count>=2 THEN 'conflict'
          WHEN candidate.old_line->'conflict'->>'code'='DUPLICATE_TARGET' AND coalesce(jsonb_typeof(candidate.line->'decision'),'null')<>'object' THEN candidate.old_line->>'category'
          WHEN candidate.line->'decision'->>'outcome'='keep-current' THEN 'unchanged'
          WHEN NOT EXISTS(SELECT 1 FROM public.src_stable_record WHERE id=bucket_target) THEN 'inserted'
          WHEN coalesce(target_payload,'{}'::jsonb) IS NOT DISTINCT FROM candidate.line->'observation'->'normalizedPayload'
            AND target_decimal IS NOT DISTINCT FROM CASE WHEN candidate.line->'observation' ? 'decimalSources' THEN candidate.line->'observation'->'decimalSources' ELSE NULL END
            AND target_duration IS NOT DISTINCT FROM CASE WHEN candidate.line->'observation' ? 'durationSources' THEN candidate.line->'observation'->'durationSources' ELSE NULL END THEN 'unchanged' ELSE 'updated' END AS category,
          CASE WHEN bucket_count>=2 THEN 'Duas observações aceitas apontam para o mesmo registro estável; resolva explicitamente.'
            WHEN candidate.old_line->'conflict'->>'code'='DUPLICATE_TARGET' AND coalesce(jsonb_typeof(candidate.line->'decision'),'null')<>'object' THEN candidate.old_line->>'consequence'
            WHEN candidate.line->'decision'->>'outcome'='keep-current' THEN 'A decisão mantém a camada vigente.'
            WHEN NOT EXISTS(SELECT 1 FROM public.src_stable_record WHERE id=bucket_target) THEN 'A decisão cria uma identidade interna opaca durante a aplicação.'
            WHEN candidate.line->'decision'->>'outcome'='link' AND target_layer IN ('adjustment','decision') THEN 'A decisão auditada autoriza o novo resultado.'
            ELSE 'A observação aceita atualiza a projeção vigente.' END AS consequence,
          CASE WHEN bucket_count>=2 THEN true
            WHEN candidate.old_line->'conflict'->>'code'='DUPLICATE_TARGET' AND coalesce(jsonb_typeof(candidate.line->'decision'),'null')<>'object' THEN true
            ELSE false END AS pending
      ) d
    ), resolved AS (
      SELECT derived.*,CASE WHEN bucket_count<2 AND NOT pending AND jsonb_typeof(base_line->'conflict')='object'
        THEN jsonb_set(base_line,'{conflict,resolution}',to_jsonb(base_line->'decision'->>'outcome'),true) ELSE base_line END AS resolved_line
      FROM derived
    ), rendered AS (
      SELECT resolved.*,CASE WHEN bucket_count<2 AND resolved.old_line->'conflict'->>'code'='DUPLICATE_TARGET' AND coalesce(jsonb_typeof(resolved.line->'decision'),'null')<>'object'
        THEN resolved.resolved_line ELSE jsonb_set(resolved.resolved_line,'{fieldDiffs}',source_reconciliation_field_diffs(resolved.resolved_line->'observation',bucket_target,resolved.consequence),true) END AS final_line
      FROM resolved
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('observationId',observation_id::text,'locator',locator,'ordinal',ordinal,
      'line',final_line,'targetId',bucket_target::text,'acceptedTargetId',bucket_target::text,'absenceTargetId',absence_target_id::text,
      'pending',pending,'category',category,'oldCategory',old_category,'oldPending',old_pending) ORDER BY ordinal),'[]'::jsonb)
      INTO bucket_changes FROM rendered WHERE final_line IS DISTINCT FROM old_line OR observation_id=current_line.observation_id;
    FOR metric_field IN SELECT unnest(ARRAY['inserted','updated','unchanged','rejected','conflict']) LOOP
      next_summary:=jsonb_set(next_summary,ARRAY[metric_field],to_jsonb(greatest(0,coalesce((next_summary->>metric_field)::integer,0)
        +(SELECT count(*) FROM jsonb_array_elements(bucket_changes) change WHERE change->>'category'=metric_field)
        -(SELECT count(*) FROM jsonb_array_elements(bucket_changes) change WHERE change->>'oldCategory'=metric_field))),true);
    END LOOP;
    SELECT jsonb_set(next_summary,'{pendingDecisions}',to_jsonb(greatest(0,coalesce((next_summary->>'pendingDecisions')::integer,0)
      +coalesce((SELECT sum(CASE WHEN (value->>'pending')::boolean THEN 1 ELSE 0 END-CASE WHEN (value->>'oldPending')::boolean THEN 1 ELSE 0 END)
        FROM jsonb_array_elements(bucket_changes) value),0)::integer)),true) INTO next_summary;
    changed_lines:=changed_lines||bucket_changes;
    IF provisional_accepted_target=bucket_target THEN
      SELECT value->'line',value->>'category' INTO new_line,next_category FROM jsonb_array_elements(bucket_changes) value
        WHERE value->>'observationId'=current_line.observation_id::text AND value->>'locator'=current_line.locator;
    END IF;
    SELECT value->'line' INTO new_sole_line FROM jsonb_array_elements(bucket_changes) value
      WHERE value->>'acceptedTargetId'=bucket_target::text ORDER BY (value->>'ordinal')::bigint LIMIT 1;
    new_contributor_decimal:=CASE WHEN bucket_count=1 AND new_sole_line->>'category' IN ('inserted','updated','unchanged') AND coalesce(new_sole_line->'decision'->>'outcome','')<>'keep-current'
      THEN CASE WHEN new_sole_line->'observation' ? 'decimalSources' THEN new_sole_line->'observation'->'decimalSources' ELSE NULL END ELSE target_decimal END;
    new_contributor_duration:=CASE WHEN bucket_count=1 AND new_sole_line->>'category' IN ('inserted','updated','unchanged') AND coalesce(new_sole_line->'decision'->>'outcome','')<>'keep-current'
      THEN CASE WHEN new_sole_line->'observation' ? 'durationSources' THEN new_sole_line->'observation'->'durationSources' ELSE NULL END ELSE target_duration END;
    metric_changes:=metric_changes||jsonb_build_array(jsonb_build_object('oldDecimal',old_contributor_decimal,'newDecimal',new_contributor_decimal,
      'oldDuration',old_contributor_duration,'newDuration',new_contributor_duration));
  END LOOP;
  IF provisional_accepted_target IS NULL THEN
    next_summary:=jsonb_set(next_summary,ARRAY[current_line.category],to_jsonb(greatest(0,coalesce((next_summary->>current_line.category)::integer,0)-1)),true);
    next_summary:=jsonb_set(next_summary,ARRAY[next_category],to_jsonb(coalesce((next_summary->>next_category)::integer,0)+1),true);
    next_summary:=jsonb_set(next_summary,'{pendingDecisions}',to_jsonb(greatest(0,coalesce((next_summary->>'pendingDecisions')::integer,0)-1)),true);
    changed_lines:=changed_lines||jsonb_build_array(jsonb_build_object('observationId',current_line.observation_id::text,'locator',current_line.locator,
      'ordinal',current_line.ordinal,'line',new_line,'targetId',persisted_target::text,'acceptedTargetId',NULL,
      'absenceTargetId',CASE WHEN decision_outcome_v='reject' THEN current_line.line->'match'->>'matchedRecordId' ELSE persisted_target::text END,
      'pending',false,'category',next_category,'oldCategory',current_line.category,'oldPending',current_line.pending_decision));
  END IF;
  next_pending:=coalesce((next_summary->>'pendingDecisions')::integer,0);
  old_absence_target := coalesce(current_line.absence_target_id, CASE WHEN current_line.line->'conflict'->>'code'='PROTECTED_LAYER' THEN nullif(current_line.line->'match'->>'matchedRecordId','')::uuid END);
  new_absence_target := CASE WHEN decision_outcome_v='reject' THEN nullif(current_line.line->'match'->>'matchedRecordId','')::uuid ELSE persisted_target END;
  -- The addressed immutable line authenticates one old reference. The
  -- mutable counter is indexed by (lineage,target), so decision work stays
  -- O(delta + log N) even when K observations share the same absence target.
  IF old_absence_target IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.src_reconciliation_observed_target_head
    WHERE lineage_id=lineage AND stable_record_id=old_absence_target AND reference_count>0
  ) OR EXISTS (
    SELECT 1 FROM public.src_reconciliation_observed_target_head
    WHERE lineage_id=lineage AND stable_record_id IN (old_absence_target,new_absence_target) AND reference_count<0
  ) THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation observed target head changed';
  END IF;
  IF old_absence_target IS DISTINCT FROM new_absence_target THEN
    IF old_absence_target IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.src_reconciliation_observed_target_head
      WHERE lineage_id=lineage AND stable_record_id=old_absence_target AND reference_count=1
    ) AND EXISTS (SELECT 1 FROM public.src_stable_record WHERE id=old_absence_target) THEN
      changed_absences := changed_absences+1;
      SELECT absence_changes||jsonb_build_array(jsonb_build_object('stableRecordId',effective.stable_record_id::text,'absent',true,
        'item',jsonb_strip_nulls(jsonb_build_object('stableRecordId',effective.stable_record_id::text,'status','not_observed_this_batch','label','Não observado neste lote',
          'effectivePayload',coalesce(effective.effective_payload,'{}'::jsonb),'effectiveVersion',effective.projection_version::text)))) INTO absence_changes
      FROM source_reconciliation_effective_record(old_absence_target) effective;
    END IF;
    IF new_absence_target IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.src_reconciliation_absence_head
      WHERE lineage_id=lineage AND stable_record_id=new_absence_target
    ) THEN changed_absences := changed_absences-1;
      absence_changes:=absence_changes||jsonb_build_array(jsonb_build_object('stableRecordId',new_absence_target::text,'absent',false));
    END IF;
  END IF;
  next_summary := jsonb_set(next_summary,'{absent}',to_jsonb(greatest(0,coalesce((next_summary->>'absent')::integer,0)+changed_absences)),true);
  next_pending := coalesce((next_summary->>'pendingDecisions')::integer,0);
  next_status := CASE WHEN next_pending=0 THEN 'ready-to-apply' ELSE 'needs-decision' END;
  next_metrics := parent.metrics;
  FOR change_entry IN SELECT value FROM jsonb_array_elements(metric_changes) value LOOP
    target_decimal:=nullif(change_entry->'oldDecimal','null'::jsonb);
    target_duration:=nullif(change_entry->'oldDuration','null'::jsonb);
    FOR metric_field IN
      SELECT key FROM jsonb_object_keys(coalesce(target_decimal,'{}'::jsonb)) key
      UNION SELECT key FROM jsonb_object_keys(coalesce(nullif(change_entry->'newDecimal','null'::jsonb),'{}'::jsonb)) key
    LOOP
      old_metadata := coalesce(target_decimal,'{}'::jsonb)->metric_field;
      new_metadata := coalesce(nullif(change_entry->'newDecimal','null'::jsonb),'{}'::jsonb)->metric_field;
      old_present := old_metadata IS NOT NULL;
      new_present := new_metadata IS NOT NULL;
      metric_entry := coalesce(metric_accumulator->'decimal'->metric_field,
        '{"total":"0","sourceCount":0,"nonnullCount":0,"scaleCounts":{}}'::jsonb);
      metric_total := coalesce((metric_entry->>'total')::numeric,0)
        - CASE WHEN old_metadata->'normalized_value' IS NULL OR old_metadata->'normalized_value'='null'::jsonb THEN 0 ELSE (old_metadata->>'normalized_value')::numeric END
        + CASE WHEN new_metadata->'normalized_value' IS NULL OR new_metadata->'normalized_value'='null'::jsonb THEN 0 ELSE (new_metadata->>'normalized_value')::numeric END;
      source_count := coalesce((metric_entry->>'sourceCount')::integer,0) - old_present::integer + new_present::integer;
      nonnull_count := coalesce((metric_entry->>'nonnullCount')::integer,0)
        - (old_present AND old_metadata->'normalized_value'<>'null'::jsonb)::integer
        + (new_present AND new_metadata->'normalized_value'<>'null'::jsonb)::integer;
      scale_counts := coalesce(metric_entry->'scaleCounts','{}'::jsonb);
      IF old_present AND old_metadata->'normalized_value'<>'null'::jsonb THEN
        metric_scale := (old_metadata->>'source_scale')::integer;
        IF coalesce((scale_counts->>metric_scale::text)::integer,0)<=1 THEN scale_counts:=scale_counts-metric_scale::text;
        ELSE scale_counts:=jsonb_set(scale_counts,ARRAY[metric_scale::text],to_jsonb((scale_counts->>metric_scale::text)::integer-1),true); END IF;
      END IF;
      IF new_present AND new_metadata->'normalized_value'<>'null'::jsonb THEN
        metric_scale := (new_metadata->>'source_scale')::integer;
        scale_counts:=jsonb_set(scale_counts,ARRAY[metric_scale::text],to_jsonb(coalesce((scale_counts->>metric_scale::text)::integer,0)+1),true);
      END IF;
      IF source_count<=0 THEN
        metric_accumulator:=jsonb_set(metric_accumulator,'{decimal}',(metric_accumulator->'decimal')-metric_field,true);
        next_metrics:=jsonb_set(next_metrics,'{decimalSums}',coalesce(next_metrics->'decimalSums','{}'::jsonb)-metric_field,true);
      ELSE
        metric_scale:=CASE WHEN nonnull_count<=0 THEN 0 ELSE coalesce((SELECT max(key::integer) FROM jsonb_object_keys(scale_counts) key),0) END;
        metric_entry:=jsonb_build_object('total',source_reconciliation_decimal_text(metric_total,metric_scale),'sourceCount',source_count,'nonnullCount',nonnull_count,'scaleCounts',scale_counts);
        metric_accumulator:=jsonb_set(metric_accumulator,ARRAY['decimal',metric_field],metric_entry,true);
        next_metrics:=jsonb_set(next_metrics,ARRAY['decimalSums',metric_field],to_jsonb(source_reconciliation_decimal_text(metric_total,metric_scale)),true);
      END IF;
    END LOOP;
    FOR metric_field IN
      SELECT key FROM jsonb_object_keys(coalesce(target_duration,'{}'::jsonb)) key
      UNION SELECT key FROM jsonb_object_keys(coalesce(nullif(change_entry->'newDuration','null'::jsonb),'{}'::jsonb)) key
    LOOP
      old_metadata:=coalesce(target_duration,'{}'::jsonb)->metric_field;
      new_metadata:=coalesce(nullif(change_entry->'newDuration','null'::jsonb),'{}'::jsonb)->metric_field;
      old_present:=old_metadata IS NOT NULL; new_present:=new_metadata IS NOT NULL;
      metric_entry:=coalesce(metric_accumulator->'duration'->metric_field,'{"total":"0","sourceCount":0}'::jsonb);
      duration_total:=coalesce((metric_entry->>'total')::numeric,0)
        - CASE WHEN old_present THEN source_reconciliation_duration_seconds(old_metadata->>'source_text',old_metadata->>'unit') ELSE 0 END
        + CASE WHEN new_present THEN source_reconciliation_duration_seconds(new_metadata->>'source_text',new_metadata->>'unit') ELSE 0 END;
      source_count:=coalesce((metric_entry->>'sourceCount')::integer,0)-old_present::integer+new_present::integer;
      IF source_count<=0 THEN
        metric_accumulator:=jsonb_set(metric_accumulator,'{duration}',(metric_accumulator->'duration')-metric_field,true);
        next_metrics:=jsonb_set(next_metrics,'{durationSums}',coalesce(next_metrics->'durationSums','{}'::jsonb)-metric_field,true);
      ELSE
        metric_entry:=jsonb_build_object('total',trunc(duration_total)::text,'sourceCount',source_count);
        metric_accumulator:=jsonb_set(metric_accumulator,ARRAY['duration',metric_field],metric_entry,true);
        next_metrics:=jsonb_set(next_metrics,ARRAY['durationSums',metric_field],to_jsonb(trunc(duration_total)::text),true);
      END IF;
    END LOOP;
  END LOOP;
  next_absence_root_id:=parent.absence_root_id;
  FOR change_entry IN SELECT value FROM jsonb_array_elements(absence_changes) value ORDER BY (value->>'stableRecordId')::uuid LOOP
    next_absence_root_id:=source_reconciliation_avl_set(lineage,next_revision,next_absence_root_id,(change_entry->>'stableRecordId')::uuid,CASE WHEN (change_entry->>'absent')::boolean THEN change_entry->'item' ELSE NULL END);
  END LOOP;
  IF next_absence_root_id IS NULL THEN next_absence_root_hash:=source_reconciliation_avl_empty_hash();next_absence_count:=0;next_absence_min:=NULL;next_absence_max:=NULL;
  ELSE SELECT * INTO next_absence_root FROM public.src_reconciliation_absence_node WHERE lineage_id=lineage AND id=next_absence_root_id;next_absence_root_hash:=next_absence_root.node_hash;next_absence_count:=next_absence_root.subtree_count;next_absence_min:=next_absence_root.subtree_min;next_absence_max:=next_absence_root.subtree_max;END IF;
  next_absence_commitment:=source_reconciliation_avl_commitment(next_absence_root_hash,next_absence_count,next_absence_min,next_absence_max);
  next_absence_commitment_json:=jsonb_build_object('rootHash',encode(next_absence_root_hash,'hex'),'count',next_absence_count::text,'min',CASE WHEN next_absence_min IS NULL THEN NULL ELSE next_absence_min::text END,'max',CASE WHEN next_absence_max IS NULL THEN NULL ELSE next_absence_max::text END,'commitment',encode(next_absence_commitment,'hex'));
  derived_delta:=jsonb_build_object('absenceCommitment',next_absence_commitment_json,'lines',coalesce((SELECT jsonb_agg(value->'line' ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(changed_lines) value),'[]'::jsonb),
    'metrics',next_metrics,'summary',next_summary,'absenceTransitions',absence_changes,'targetBucketTransitions',bucket_transitions);
  chain_result:=source_reconciliation_chain_hash(lineage,parent.fingerprint,parent.decisions_hash,result_decision,derived_delta);
  next_decisions_hash:=chain_result->>'decisionsHash'; next_fingerprint:=chain_result->>'fingerprint';

  INSERT INTO public.src_reconciliation
    (id,confirmation_id,batch_id,preview_id,source_file_id,source_sha256,contract_hash,transformation_hash,preview_hash,root_request_hash,
     policy_version,policy,base_projection_version,parent_reconciliation_id,revision_no,status,fingerprint,idempotency_key,
     decisions_hash,summary,manifest,manifest_delta,actor,created_at,lineage_id,decision_count,metrics,metric_accumulator_hash,absence_root_id,absence_root_hash,absence_count,absence_min,absence_max,absence_commitment)
  VALUES(next_id,parent.confirmation_id,parent.batch_id,parent.preview_id,parent.source_file_id,parent.source_sha256,parent.contract_hash,
    parent.transformation_hash,parent.preview_hash,parent.root_request_hash,parent.policy_version,parent.policy,parent.base_projection_version,parent.id,
    next_revision,next_status,next_fingerprint,'decision-'||p_request_id::text,next_decisions_hash,next_summary,
    jsonb_build_object('id',next_id::text,'format','reconciliation-chain-v4','absenceCommitment',next_absence_commitment_json,'status',next_status,'revisionNo',next_revision::text,
      'parentReconciliationId',parent.id::text),
    derived_delta,
    'Rodrigo',server_time,lineage,parent.decision_count+1,next_metrics,
    encode(sha256(convert_to(source_reconciliation_jcs(metric_accumulator),'utf8')),'hex'),next_absence_root_id,next_absence_root_hash,next_absence_count,next_absence_min,next_absence_max,next_absence_commitment);
  INSERT INTO public.src_reconciliation_decision
    (id,reconciliation_id,preview_id,batch_id,source_file_id,lineage_id,observation_id,locator,stable_record_id,outcome,actor,
     decided_at,policy_version,rationale,version,revision_no)
  VALUES(decision_id,next_id,parent.preview_id,parent.batch_id,parent.source_file_id,lineage,(p_intent->>'observationId')::uuid,
    p_intent->>'locator',persisted_target,decision_outcome_v,'Rodrigo',server_time,parent.policy_version,p_intent->>'rationale',p_intent->>'version',decision_line_revision);

  FOR change_entry IN SELECT value FROM jsonb_array_elements(changed_lines) value LOOP
    INSERT INTO public.src_reconciliation_line_state
      (reconciliation_id,lineage_id,reconciliation_revision,observation_id,locator,ordinal,line,target_id,accepted_target_id,absence_target_id,pending_decision,category,created_at)
    VALUES(next_id,lineage,next_revision,(change_entry->>'observationId')::uuid,change_entry->>'locator',(change_entry->>'ordinal')::bigint,
      change_entry->'line',nullif(change_entry->>'targetId','')::uuid,nullif(change_entry->>'acceptedTargetId','')::uuid,
      nullif(change_entry->>'absenceTargetId','')::uuid,(change_entry->>'pending')::boolean,change_entry->>'category',server_time);
    IF change_entry->'line'->'conflict'->>'code'='DUPLICATE_TARGET' AND NOT EXISTS(
      SELECT 1 FROM public.src_import_conflict WHERE id=(change_entry->'line'->'conflict'->>'id')::uuid) THEN
      INSERT INTO public.src_import_conflict
        (id,reconciliation_id,preview_id,batch_id,source_file_id,observation_id,code,candidate_ids,current_layer,message,created_at)
      VALUES((change_entry->'line'->'conflict'->>'id')::uuid,next_id,parent.preview_id,parent.batch_id,parent.source_file_id,
        (change_entry->>'observationId')::uuid,'DUPLICATE_TARGET',change_entry->'line'->'conflict'->'candidateIds',NULL,
        change_entry->'line'->'conflict'->>'message',server_time);
    END IF;
    UPDATE public.src_reconciliation_line_head SET reconciliation_id=next_id,reconciliation_revision=next_revision,line=change_entry->'line',
      target_id=nullif(change_entry->>'targetId','')::uuid,accepted_target_id=nullif(change_entry->>'acceptedTargetId','')::uuid,
      absence_target_id=nullif(change_entry->>'absenceTargetId','')::uuid,pending_decision=(change_entry->>'pending')::boolean,category=change_entry->>'category'
      WHERE lineage_id=lineage AND observation_id=(change_entry->>'observationId')::uuid AND locator=change_entry->>'locator';
  END LOOP;

  FOR change_entry IN SELECT value FROM jsonb_array_elements(bucket_transitions) value LOOP
    IF (change_entry->>'newCount')::integer=0 THEN
      DELETE FROM public.src_reconciliation_target_bucket_head
        WHERE lineage_id=lineage AND stable_record_id=(change_entry->>'stableRecordId')::uuid;
    ELSE
      INSERT INTO public.src_reconciliation_target_bucket_head(lineage_id,stable_record_id,reference_count)
        VALUES(lineage,(change_entry->>'stableRecordId')::uuid,(change_entry->>'newCount')::integer)
        ON CONFLICT(lineage_id,stable_record_id) DO UPDATE SET reference_count=EXCLUDED.reference_count;
    END IF;
    INSERT INTO public.src_reconciliation_target_bucket_transition
      (reconciliation_id,lineage_id,stable_record_id,reference_delta,reference_count,created_at)
    VALUES(next_id,lineage,(change_entry->>'stableRecordId')::uuid,(change_entry->>'delta')::integer,
      (change_entry->>'newCount')::integer,server_time);
  END LOOP;

  IF old_absence_target IS DISTINCT FROM new_absence_target THEN
    IF old_absence_target IS NOT NULL THEN
      UPDATE public.src_reconciliation_observed_target_head SET reference_count=reference_count-1
        WHERE lineage_id=lineage AND stable_record_id=old_absence_target RETURNING reference_count INTO old_count;
      IF coalesce(old_count,0)=0 AND EXISTS(SELECT 1 FROM public.src_stable_record WHERE id=old_absence_target) THEN
        INSERT INTO public.src_reconciliation_absence_head(lineage_id,stable_record_id,status,label,effective_payload,effective_version)
        SELECT lineage,effective.stable_record_id,'not_observed_this_batch','Não observado neste lote',
          coalesce(effective.effective_payload,'{}'::jsonb),effective.projection_version::text
        FROM source_reconciliation_effective_record(old_absence_target) effective
        ON CONFLICT(lineage_id,stable_record_id) DO UPDATE SET effective_payload=EXCLUDED.effective_payload,effective_version=EXCLUDED.effective_version;
        INSERT INTO public.src_reconciliation_absence_key(lineage_id,stable_record_id)
          VALUES(lineage,old_absence_target) ON CONFLICT DO NOTHING;
        INSERT INTO public.src_reconciliation_absence_span(lineage_id,stable_record_id,valid_from_revision,status,label,effective_payload,effective_version)
        SELECT lineage,stable_record_id,next_revision,status,label,effective_payload,effective_version
        FROM public.src_reconciliation_absence_head WHERE lineage_id=lineage AND stable_record_id=old_absence_target;
        INSERT INTO public.src_reconciliation_absence(reconciliation_id,lineage_id,reconciliation_revision,stable_record_id,present,ordinal,status,label,effective_payload,effective_version,created_at)
        SELECT next_id,lineage,next_revision,stable_record_id,true,row_number() OVER(),status,label,effective_payload,effective_version,server_time
        FROM public.src_reconciliation_absence_head WHERE lineage_id=lineage AND stable_record_id=old_absence_target;
        changed_absences := changed_absences+1;

      END IF;
    END IF;
    IF new_absence_target IS NOT NULL THEN
      INSERT INTO public.src_reconciliation_observed_target_head(lineage_id,stable_record_id,reference_count)
        VALUES(lineage,new_absence_target,1) ON CONFLICT(lineage_id,stable_record_id) DO UPDATE SET reference_count=src_reconciliation_observed_target_head.reference_count+1
        RETURNING reference_count INTO new_count;
      IF new_count=1 THEN
        DELETE FROM public.src_reconciliation_absence_head WHERE lineage_id=lineage AND stable_record_id=new_absence_target;
        IF FOUND AND EXISTS(SELECT 1 FROM public.src_stable_record WHERE id=new_absence_target) THEN
          UPDATE public.src_reconciliation_absence_span SET valid_to_revision=next_revision
            WHERE lineage_id=lineage AND stable_record_id=new_absence_target AND valid_to_revision IS NULL;
          INSERT INTO public.src_reconciliation_absence(reconciliation_id,lineage_id,reconciliation_revision,stable_record_id,present,created_at)
            VALUES(next_id,lineage,next_revision,new_absence_target,false,server_time);
          changed_absences := changed_absences-1;
        END IF;
      END IF;
    END IF;
  END IF;
  UPDATE public.src_reconciliation_metric_head SET metrics=next_metrics,accumulator=metric_accumulator,updated_at=server_time WHERE lineage_id=lineage;
  UPDATE public.src_reconciliation_head SET leaf_reconciliation_id=next_id,revision_no=next_revision,updated_at=server_time WHERE lineage_id=lineage;
  IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation_head h WHERE h.lineage_id=lineage AND h.leaf_reconciliation_id=next_id AND h.revision_no=next_revision) OR (SELECT version FROM public.src_projection_version WHERE singleton)<>parent.base_projection_version THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='reconciliation epochs changed during decision';END IF;
  INSERT INTO public.src_reconciliation_request(operation,idempotency_key,fingerprint,reconciliation_id)
    VALUES('decision','decision-'||p_request_id::text,next_fingerprint,next_id);
  RETURN jsonb_build_object('id',next_id::text,'reconciliationId',next_id::text,'parentReconciliationId',parent.id::text,
    'revisionNo',next_revision::text,'fingerprint',next_fingerprint,'status',next_status,'summary',next_summary,'metrics',next_metrics,
    'decision',result_decision,'changedLines',coalesce((SELECT jsonb_agg(value->'line' ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(changed_lines) value),'[]'::jsonb),
    'absenceChanges',absence_changes,'decisionCount',parent.decision_count+1,'reused',false,'canonicalReopenRequired',true,'createdAt',server_time);
END;
$$;

CREATE OR REPLACE FUNCTION source_reconciliation_verify_lineage(p_leaf_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $lineage$
DECLARE item record;expected_parent uuid:=NULL;expected_revision bigint:=1;
BEGIN
 FOR item IN WITH RECURSIVE ancestors AS (SELECT r.id,r.parent_reconciliation_id,r.revision_no FROM public.src_reconciliation r WHERE r.id=p_leaf_id UNION ALL SELECT p.id,p.parent_reconciliation_id,p.revision_no FROM public.src_reconciliation p JOIN ancestors c ON c.parent_reconciliation_id=p.id) SELECT * FROM ancestors ORDER BY revision_no LOOP
   IF item.parent_reconciliation_id IS DISTINCT FROM expected_parent OR item.revision_no<>expected_revision THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation lineage has a gap';END IF;
   PERFORM source_reconciliation_verify_absence_anchor(item.id);expected_parent:=item.id;expected_revision:=expected_revision+1;
 END LOOP;
 IF expected_parent IS DISTINCT FROM p_leaf_id THEN RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation leaf is not anchored';END IF;RETURN true;
END;$lineage$;

CREATE OR REPLACE FUNCTION source_reconciliation_decision_set_hash(p_reconciliation_id uuid)
RETURNS char(64) LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $decision_set$
 SELECT encode(sha256(convert_to(coalesce((SELECT jsonb_agg(jsonb_build_array(d.observation_id::text||':'||coalesce(d.locator,''),d.id::text,d.observation_id::text,d.locator,d.stable_record_id::text,d.outcome,d.actor,d.policy_version,d.rationale,d.version,d.revision_no) ORDER BY (d.observation_id::text||':'||coalesce(d.locator,'')||':'||d.id::text) COLLATE "C") FROM source_reconciliation_decisions(p_reconciliation_id)d),'[]'::jsonb)::text,'utf8')),'hex')::char(64)
$decision_set$;

CREATE OR REPLACE FUNCTION alias_source_reconciliation_request(p_idempotency_key text,p_root_request_hash char(64),p_expected_decisions_hash char(64),p_reconciliation_id uuid,p_require_applied boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $alias$
DECLARE leaf public.src_reconciliation%ROWTYPE; root public.src_reconciliation%ROWTYPE; head_id uuid; existing public.src_reconciliation_request%ROWTYPE;
BEGIN
  IF session_user<>'tria_app' OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 1 AND 200 OR p_reconciliation_id IS NULL OR p_require_applied IS NULL OR length(coalesce(p_root_request_hash::text,''))<>64 OR length(coalesce(p_expected_decisions_hash::text,''))<>64 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reconciliation alias is restricted to the application service';
  END IF;
  SELECT * INTO leaf FROM public.src_reconciliation WHERE id=p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation alias target conflict'; END IF;
  SELECT * INTO root FROM public.src_reconciliation WHERE id=coalesce(leaf.lineage_id,leaf.id);
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:confirmation:'||root.confirmation_id::text,7824001));
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:key:'||p_idempotency_key,7824001));
  SELECT h.leaf_reconciliation_id INTO head_id FROM public.src_reconciliation_head h WHERE h.lineage_id=root.id FOR UPDATE;
  SELECT * INTO leaf FROM public.src_reconciliation WHERE id=head_id FOR SHARE;
  PERFORM source_reconciliation_verify_lineage(leaf.id);
  IF root.root_request_hash<>p_root_request_hash OR leaf.root_request_hash<>p_root_request_hash OR source_reconciliation_decision_set_hash(leaf.id)<>p_expected_decisions_hash OR (p_require_applied AND NOT EXISTS(SELECT 1 FROM public.src_reconciliation_application a WHERE a.reconciliation_id=leaf.id)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation alias identity conflict';
  END IF;
  SELECT * INTO existing FROM public.src_reconciliation_request WHERE operation='reconcile' AND idempotency_key=p_idempotency_key FOR SHARE;
  IF FOUND AND (existing.root_reconciliation_id<>root.id OR existing.root_request_hash<>p_root_request_hash) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation idempotency conflict';
  END IF;
  INSERT INTO public.src_reconciliation_request(operation,idempotency_key,fingerprint,reconciliation_id,root_reconciliation_id,root_request_hash)
    VALUES('reconcile',p_idempotency_key,root.fingerprint,root.id,root.id,root.root_request_hash)
    ON CONFLICT(operation,idempotency_key) DO NOTHING;
  RETURN leaf.id;
END;
$alias$;

CREATE OR REPLACE FUNCTION source_reconciliation_event_hash(p_reconciliation_id uuid)
RETURNS char(64) LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $event_hash$
  SELECT encode(sha256(convert_to(source_reconciliation_jcs(coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id::text,'reconciliationId',e.reconciliation_id::text,'recordId',e.record_id::text,
    'observationId',CASE WHEN e.observation_id IS NULL THEN NULL ELSE e.observation_id::text END,
    'eventType',e.event_type,'layer',e.layer,'state',e.state,'payload',e.payload,
    'decimalSources',e.decimal_sources,'durationSources',e.duration_sources,'actor',e.actor,
    'occurredAtEpochMicros',floor(extract(epoch FROM e.occurred_at)*1000000)::numeric::text,
    'version',e.version,'decisionId',CASE WHEN e.decision_id IS NULL THEN NULL ELSE e.decision_id::text END,
    'decisionRationale',e.decision_rationale,'decisionVersion',e.decision_version,
    'decisionDecidedAtEpochMicros',CASE WHEN e.decision_decided_at IS NULL THEN NULL ELSE floor(extract(epoch FROM e.decision_decided_at)*1000000)::numeric::text END
  ) ORDER BY e.id),'[]'::jsonb)),'utf8')),'hex')::char(64)
  FROM public.src_effective_record_event e WHERE e.reconciliation_id=p_reconciliation_id
$event_hash$;

CREATE OR REPLACE FUNCTION apply_source_reconciliation(
  p_reconciliation_id uuid, p_idempotency_key text, p_request_id uuid, p_actor text
) RETURNS TABLE(reused boolean, event_count integer, projection_version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  rec public.src_reconciliation%ROWTYPE;
  existing public.src_reconciliation_application%ROWTYPE;
  line jsonb;
  item jsonb;
  rid uuid;
  oid uuid;
  evt_id uuid;
  v_version bigint;
  v_current_version bigint;
  v_count integer := 0;
  v_decisions_hash char(64);
  request_fingerprint char(64);
  request_reconciliation uuid;
  decision_outcome text;
  decision_id uuid;
  decision_rationale text;
  decision_version text;
  decision_decided_at timestamptz;
  protected_layer boolean;
  confirmation_application_id uuid;
  reconciliation_confirmation_id uuid;
  latest_decisions jsonb := '{}'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_chain_hash boolean := false;
  child_rec record;
  parent_hash char(64);
  parent_fingerprint char(64);
  physical_decision record;
  embedded_decision jsonb;
  physical_lines jsonb;
  recomputed_hash char(64);
  recomputed_fingerprint char(64);
  chain_result jsonb;
  frozen_snapshot jsonb;
  frozen_snapshot_hash char(64);
  frozen_event_hash char(64);
  frozen_event_count integer;
  preserved_payload jsonb;
  preserved_decimal_sources jsonb;
  preserved_duration_sources jsonb;
  preserved_state text;
  preserved_source_observation_id uuid;
  preserved_adjustment_event_id uuid;
  preserved_decision_event_id uuid;
BEGIN
  IF session_user <> 'tria_app' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'reconciliation application is restricted to the application role';
  END IF;
  IF p_actor <> 'Rodrigo' OR p_reconciliation_id IS NULL OR length(coalesce(p_idempotency_key, '')) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid reconciliation application';
  END IF;
  SELECT confirmation_id INTO reconciliation_confirmation_id
  FROM public.src_reconciliation WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'reconciliation not found'; END IF;
  -- Match the writer's lock order: confirmation -> transport identity ->
  -- immutable reconciliation -> projection -> stable-record identities.
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:confirmation:' || reconciliation_confirmation_id::text, 7824001));
  PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:key:' || p_idempotency_key, 7824001));
  SELECT * INTO rec FROM public.src_reconciliation WHERE id = p_reconciliation_id FOR UPDATE;
  IF NOT FOUND OR rec.confirmation_id <> reconciliation_confirmation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'reconciliation not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.src_reconciliation_head h
    WHERE h.lineage_id=coalesce(rec.lineage_id,rec.id) AND h.leaf_reconciliation_id=rec.id AND h.revision_no=rec.revision_no) THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='reconciliation is not the current leaf', DETAIL=(SELECT h.leaf_reconciliation_id::text FROM public.src_reconciliation_head h WHERE h.lineage_id=coalesce(rec.lineage_id,rec.id));
  END IF;
  PERFORM source_reconciliation_verify_absence_anchor(rec.id);
  IF (SELECT count(*) FROM public.src_reconciliation_decision d
      WHERE d.reconciliation_id=coalesce(rec.lineage_id,rec.id))<>0 THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation root decision cardinality changed';
  END IF;
  v_chain_hash := rec.manifest->>'format' IN ('reconciliation-chain-v3','reconciliation-chain-v4');
  IF v_chain_hash THEN
    parent_hash:=NULL; parent_fingerprint:=NULL;
    FOR child_rec IN
      WITH RECURSIVE ancestors AS (
        SELECT r.* FROM public.src_reconciliation r WHERE r.id=rec.id
        UNION ALL SELECT p.* FROM public.src_reconciliation p JOIN ancestors c ON c.parent_reconciliation_id=p.id
      ) SELECT * FROM ancestors ORDER BY revision_no
    LOOP
      IF child_rec.parent_reconciliation_id IS NULL THEN
        IF (SELECT count(*) FROM public.src_reconciliation_decision d WHERE d.reconciliation_id=child_rec.id)<>0 THEN
          RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation root decision cardinality changed';
        END IF;
        parent_hash:=child_rec.decisions_hash; parent_fingerprint:=child_rec.fingerprint;
      ELSE
        IF (SELECT count(*) FROM public.src_reconciliation_decision d WHERE d.reconciliation_id=child_rec.id)<>1 THEN
          RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation decision chain cardinality changed';
        END IF;
        SELECT d.* INTO physical_decision FROM public.src_reconciliation_decision d WHERE d.reconciliation_id=child_rec.id;
        SELECT value->'decision' INTO embedded_decision FROM jsonb_array_elements(coalesce(child_rec.manifest_delta->'lines','[]'::jsonb)) value
          WHERE value->'decision'->>'id'=physical_decision.id::text;
        IF embedded_decision IS NULL OR embedded_decision->>'observationId'<>physical_decision.observation_id::text OR
          embedded_decision->>'locator' IS DISTINCT FROM physical_decision.locator OR nullif(embedded_decision->>'stableRecordId','')::uuid IS DISTINCT FROM physical_decision.stable_record_id OR
          embedded_decision->>'outcome'<>physical_decision.outcome OR embedded_decision->>'actor'<>physical_decision.actor OR
          (embedded_decision->>'decidedAt')::timestamptz IS DISTINCT FROM physical_decision.decided_at OR embedded_decision->>'policyVersion'<>physical_decision.policy_version OR
          embedded_decision->>'rationale'<>physical_decision.rationale OR embedded_decision->>'version'<>physical_decision.version OR
          (embedded_decision->>'revisionNo')::bigint<>physical_decision.revision_no THEN
          RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation embedded decision changed';
        END IF;
        SELECT coalesce(jsonb_agg(s.line ORDER BY s.ordinal),'[]'::jsonb) INTO physical_lines
          FROM public.src_reconciliation_line_state s WHERE s.reconciliation_id=child_rec.id;
        IF physical_lines IS DISTINCT FROM coalesce(child_rec.manifest_delta->'lines','[]'::jsonb) OR
           child_rec.metrics IS DISTINCT FROM child_rec.manifest_delta->'metrics' OR child_rec.summary IS DISTINCT FROM child_rec.manifest_delta->'summary' OR
           (SELECT count(*) FROM public.src_reconciliation_absence a WHERE a.reconciliation_id=child_rec.id) <> jsonb_array_length(coalesce(child_rec.manifest_delta->'absenceTransitions','[]'::jsonb)) OR
           EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(child_rec.manifest_delta->'absenceTransitions','[]'::jsonb)) transition
             WHERE NOT EXISTS(SELECT 1 FROM public.src_reconciliation_absence a WHERE a.reconciliation_id=child_rec.id
               AND a.stable_record_id=(transition->>'stableRecordId')::uuid AND a.present=(transition->>'absent')::boolean)) OR
           (SELECT count(*) FROM public.src_reconciliation_target_bucket_transition transition WHERE transition.reconciliation_id=child_rec.id) <>
             jsonb_array_length(coalesce(child_rec.manifest_delta->'targetBucketTransitions','[]'::jsonb)) OR
           EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(child_rec.manifest_delta->'targetBucketTransitions','[]'::jsonb)) transition
             WHERE NOT EXISTS(SELECT 1 FROM public.src_reconciliation_target_bucket_transition physical
               WHERE physical.reconciliation_id=child_rec.id AND physical.stable_record_id=(transition->>'stableRecordId')::uuid
                 AND physical.reference_delta=(transition->>'delta')::integer AND physical.reference_count=(transition->>'newCount')::integer)) THEN
          RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation line delta changed';
        END IF;
        chain_result:=source_reconciliation_chain_hash(coalesce(child_rec.lineage_id,child_rec.id),parent_fingerprint,parent_hash,embedded_decision,child_rec.manifest_delta);
        recomputed_hash:=chain_result->>'decisionsHash'; recomputed_fingerprint:=chain_result->>'fingerprint';
        IF child_rec.decisions_hash<>recomputed_hash OR child_rec.fingerprint<>recomputed_fingerprint THEN
          RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation decision chain changed';
        END IF;
        parent_hash:=child_rec.decisions_hash; parent_fingerprint:=child_rec.fingerprint;
      END IF;
    END LOOP;
  END IF;
  -- An application replay is authenticated exclusively against the frozen
  -- A-era ledger, application and snapshot. It must not rebuild A against a
  -- later global projection/catalog produced by an unrelated reconciliation.
  SELECT * INTO existing FROM public.src_reconciliation_application WHERE idempotency_key=p_idempotency_key;
  IF FOUND AND existing.reconciliation_id<>rec.id THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation idempotency conflict';
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM public.src_reconciliation_application WHERE reconciliation_id=rec.id;
  END IF;
  IF FOUND THEN
    SELECT projection INTO frozen_snapshot FROM public.src_effective_snapshot snapshot
      WHERE snapshot.reconciliation_id=rec.id AND snapshot.batch_id=rec.batch_id
        AND snapshot.projection_version=existing.projection_version AND snapshot.created_at=existing.applied_at;
    SELECT count(*)::integer,source_reconciliation_event_hash(rec.id)
      INTO frozen_event_count,frozen_event_hash
      FROM public.src_effective_record_event event WHERE event.reconciliation_id=rec.id;
    frozen_snapshot_hash:=CASE WHEN frozen_snapshot IS NULL THEN NULL ELSE
      encode(sha256(convert_to(source_reconciliation_jcs(frozen_snapshot),'utf8')),'hex') END;
    IF existing.actor<>'Rodrigo' OR existing.summary IS DISTINCT FROM rec.summary OR
       existing.projection_version<=rec.base_projection_version OR existing.event_count<>frozen_event_count OR
       frozen_snapshot IS NULL OR existing.audit_payload->>'snapshotHash' IS DISTINCT FROM frozen_snapshot_hash OR
       existing.audit_payload->>'eventHash' IS DISTINCT FROM frozen_event_hash OR
       existing.audit_payload->>'actor'<>'Rodrigo' OR existing.audit_payload->>'confirmationId'<>rec.confirmation_id::text OR
       existing.audit_payload->>'batchId'<>rec.batch_id::text OR existing.audit_payload->>'previewId'<>rec.preview_id::text OR
       existing.audit_payload->>'sourceFileId'<>rec.source_file_id::text OR existing.audit_payload->>'sourceSha256'<>rec.source_sha256 OR
       existing.audit_payload->>'contractHash'<>rec.contract_hash OR existing.audit_payload->>'transformationHash'<>rec.transformation_hash OR
       existing.audit_payload->>'previewHash'<>rec.preview_hash OR existing.audit_payload->>'policyVersion'<>rec.policy_version OR
       existing.audit_payload->>'chainHash'<>rec.decisions_hash OR existing.audit_payload->>'decisionsHash'<>rec.decisions_hash OR
       existing.audit_payload->'counts' IS DISTINCT FROM rec.summary OR
       existing.audit_payload->'metrics' IS DISTINCT FROM rec.metrics OR
       NOT EXISTS(SELECT 1 FROM public.src_reconciliation_confirmation_application confirmation
         WHERE confirmation.confirmation_id=rec.confirmation_id AND confirmation.reconciliation_id=rec.id
           AND confirmation.applied_at=existing.applied_at) OR
       NOT EXISTS(SELECT 1 FROM public.src_reconciliation_request request
         WHERE request.operation='apply' AND request.idempotency_key=existing.idempotency_key
           AND request.fingerprint=rec.fingerprint AND request.reconciliation_id=rec.id) THEN
      RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='frozen reconciliation application changed';
    END IF;
    SELECT fingerprint,reconciliation_id INTO request_fingerprint,request_reconciliation
      FROM public.src_reconciliation_request WHERE operation='apply' AND idempotency_key=p_idempotency_key;
    IF FOUND AND (request_fingerprint<>rec.fingerprint OR request_reconciliation<>rec.id) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reconciliation idempotency conflict';
    END IF;
    INSERT INTO public.src_reconciliation_request(operation,idempotency_key,fingerprint,reconciliation_id)
      VALUES('apply',p_idempotency_key,rec.fingerprint,rec.id) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT true,existing.event_count,existing.projection_version;
    RETURN;
  END IF;
  -- First apply authenticates current derived heads and serializes effects on
  -- the singleton projection version.
  SELECT version INTO v_current_version FROM public.src_projection_version WHERE singleton FOR UPDATE;
  SELECT * INTO existing FROM public.src_reconciliation_application WHERE reconciliation_id = p_reconciliation_id;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM public.src_reconciliation_application WHERE idempotency_key = p_idempotency_key;
    IF FOUND AND existing.reconciliation_id <> p_reconciliation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation idempotency conflict';
    END IF;
    IF rec.base_projection_version <> v_current_version THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'projection version changed';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation_head h WHERE h.lineage_id=coalesce(rec.lineage_id,rec.id)
      AND h.leaf_reconciliation_id=rec.id AND h.revision_no=rec.revision_no) OR
     EXISTS(
       WITH latest AS (
         SELECT DISTINCT ON (s.observation_id,s.locator) s.*
         FROM public.src_reconciliation_line_state s
         WHERE s.lineage_id=coalesce(rec.lineage_id,rec.id) AND s.reconciliation_revision<=rec.revision_no
         ORDER BY s.observation_id,s.locator,s.reconciliation_revision DESC
       )
       SELECT 1 FROM public.src_reconciliation_line_head h FULL JOIN latest
         ON latest.lineage_id=h.lineage_id AND latest.observation_id=h.observation_id AND latest.locator=h.locator
       WHERE coalesce(h.lineage_id,latest.lineage_id)=coalesce(rec.lineage_id,rec.id) AND
         (h.line IS NULL OR latest.line IS NULL OR h.line IS DISTINCT FROM latest.line OR
          h.category IS DISTINCT FROM latest.category OR h.pending_decision IS DISTINCT FROM latest.pending_decision OR
          h.target_id IS DISTINCT FROM latest.target_id OR h.accepted_target_id IS DISTINCT FROM latest.accepted_target_id OR
          h.absence_target_id IS DISTINCT FROM latest.absence_target_id)
     ) OR
     NOT EXISTS(SELECT 1 FROM public.src_reconciliation_metric_head m WHERE m.lineage_id=coalesce(rec.lineage_id,rec.id) AND m.metrics=rec.metrics) OR
     EXISTS(SELECT 1 FROM public.src_reconciliation_absence_head h FULL JOIN
       (SELECT * FROM public.src_reconciliation_absence_span span WHERE span.lineage_id=coalesce(rec.lineage_id,rec.id)
          AND span.valid_from_revision<=rec.revision_no AND (span.valid_to_revision IS NULL OR span.valid_to_revision>rec.revision_no)) s
       ON s.lineage_id=h.lineage_id AND s.stable_record_id=h.stable_record_id
       WHERE coalesce(h.lineage_id,s.lineage_id)=coalesce(rec.lineage_id,rec.id) AND (h.stable_record_id IS NULL OR s.stable_record_id IS NULL
         OR h.status IS DISTINCT FROM s.status OR h.label IS DISTINCT FROM s.label OR h.effective_payload IS DISTINCT FROM s.effective_payload
         OR h.effective_version IS DISTINCT FROM s.effective_version)) OR
     EXISTS(SELECT 1 FROM public.src_reconciliation_observed_target_head observed FULL JOIN
       (SELECT absence_target_id AS stable_record_id,count(*)::integer reference_count FROM public.src_reconciliation_line_head
        WHERE lineage_id=coalesce(rec.lineage_id,rec.id) AND absence_target_id IS NOT NULL GROUP BY absence_target_id) derived
       ON observed.stable_record_id=derived.stable_record_id AND observed.lineage_id=coalesce(rec.lineage_id,rec.id)
       WHERE (observed.lineage_id=coalesce(rec.lineage_id,rec.id) OR derived.stable_record_id IS NOT NULL)
         AND (observed.stable_record_id IS NULL OR derived.stable_record_id IS NULL OR observed.reference_count<>derived.reference_count)) OR
     EXISTS(
       WITH derived AS (
         SELECT accepted_target_id AS stable_record_id,count(*)::integer AS reference_count
         FROM public.src_reconciliation_line_head WHERE lineage_id=coalesce(rec.lineage_id,rec.id) AND accepted_target_id IS NOT NULL
         GROUP BY accepted_target_id
       ), bucket AS (
         SELECT stable_record_id,reference_count
         FROM public.src_reconciliation_target_bucket_head
         WHERE lineage_id=coalesce(rec.lineage_id,rec.id)
       ), latest_transition AS (
         SELECT DISTINCT ON (stable_record_id) stable_record_id,reference_count
         FROM public.src_reconciliation_target_bucket_transition
         WHERE lineage_id=coalesce(rec.lineage_id,rec.id)
         ORDER BY stable_record_id,created_at DESC,reconciliation_id DESC
       ), authenticated AS (
         SELECT coalesce(bucket.stable_record_id,derived.stable_record_id,latest_transition.stable_record_id) AS stable_record_id,
           bucket.reference_count AS bucket_count,derived.reference_count AS derived_count,
           latest_transition.reference_count AS transition_count
         FROM bucket FULL JOIN derived USING(stable_record_id)
         FULL JOIN latest_transition USING(stable_record_id)
       )
       SELECT 1 FROM authenticated
       WHERE coalesce(bucket_count,0)<>coalesce(derived_count,0)
         OR coalesce(bucket_count,0)<>coalesce(transition_count,0)
     ) THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation derived head changed';
  END IF;
  rec.manifest := source_reconciliation_materialize_manifest(rec.id,false);
  IF jsonb_typeof(rec.manifest) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconciliation manifest could not be materialized';
  END IF;
  -- Apply is the full O(N + D) authentication boundary. Recompute every
  -- derived cardinality and payload from the immutable line/decision ledger,
  -- then compare the rebuildable heads before any effect is written.
  IF rec.manifest->'lines' IS DISTINCT FROM coalesce((SELECT jsonb_agg(h.line ORDER BY h.ordinal)
       FROM public.src_reconciliation_line_head h WHERE h.lineage_id=coalesce(rec.lineage_id,rec.id)),'[]'::jsonb) OR
     rec.summary IS DISTINCT FROM (
       SELECT jsonb_build_object(
         'inserted',count(*) FILTER(WHERE value->>'category'='inserted'),
         'updated',count(*) FILTER(WHERE value->>'category'='updated'),
         'unchanged',count(*) FILTER(WHERE value->>'category'='unchanged'),
         'rejected',count(*) FILTER(WHERE value->>'category'='rejected'),
         'conflict',count(*) FILTER(WHERE value->>'category'='conflict'),
         'total',count(*),
         'absent',(SELECT count(*) FROM public.src_reconciliation_absence_head a WHERE a.lineage_id=coalesce(rec.lineage_id,rec.id)),
         'pendingDecisions',count(*) FILTER(WHERE jsonb_typeof(value->'conflict')='object' AND nullif(value->'conflict'->>'resolution','') IS NULL)
       ) FROM jsonb_array_elements(rec.manifest->'lines') value
     ) OR rec.manifest->'summary' IS DISTINCT FROM rec.summary OR
     rec.metrics IS DISTINCT FROM source_reconciliation_metrics(rec.manifest->'lines') OR
     rec.manifest->'metrics' IS DISTINCT FROM rec.metrics OR
     NOT EXISTS(SELECT 1 FROM public.src_reconciliation_metric_head metric
       WHERE metric.lineage_id=coalesce(rec.lineage_id,rec.id) AND metric.metrics=rec.metrics
         AND metric.accumulator=source_reconciliation_metric_accumulator(rec.manifest->'lines')
         AND rec.metric_accumulator_hash=encode(sha256(convert_to(source_reconciliation_jcs(metric.accumulator),'utf8')),'hex')) THEN
    RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='reconciliation derived state changed';
  END IF;
  SELECT fingerprint, reconciliation_id INTO request_fingerprint, request_reconciliation
    FROM public.src_reconciliation_request
    WHERE operation = 'apply' AND idempotency_key = p_idempotency_key;
  IF FOUND AND (request_fingerprint <> rec.fingerprint OR request_reconciliation <> rec.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reconciliation idempotency conflict';
  END IF;
  SELECT reconciliation_id INTO confirmation_application_id
  FROM public.src_reconciliation_confirmation_application
  WHERE confirmation_id = rec.confirmation_id
  FOR SHARE;
  IF confirmation_application_id IS NOT NULL AND confirmation_application_id <> rec.id THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'confirmation already has an applied reconciliation';
  END IF;
  -- Projection locking and base-version validation happened before derived-state
  -- authentication. Keep every subsequent identity lock after that global lock.
  -- A decision leaf stores only its delta, so physical conflict rows belong
  -- to the root. Gate apply on the fully materialized leaf, never on rows whose
  -- reconciliation_id happens to equal the leaf id.
  IF rec.status <> 'ready-to-apply' OR rec.manifest->>'status' <> 'ready-to-apply' OR
     coalesce((rec.manifest->'summary'->>'pendingDecisions')::integer, -1) <> 0 OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(rec.manifest->'lines', '[]'::jsonb)) value
       WHERE jsonb_typeof(value->'conflict') = 'object'
         AND nullif(value->'conflict'->>'resolution', '') IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reconciliation requires decisions';
  END IF;
  SELECT encode(sha256(convert_to(coalesce((
    SELECT jsonb_agg(jsonb_build_array(
      d.observation_id::text || ':' || coalesce(d.locator, ''), d.id::text, d.observation_id::text,
      d.locator, d.stable_record_id::text, d.outcome, d.actor,
      d.policy_version, d.rationale, d.version, d.revision_no
    ) ORDER BY d.observation_id::text || ':' || coalesce(d.locator, '') || ':' || d.id::text)
    FROM source_reconciliation_decisions(rec.id) d
  ), '[]'::jsonb)::text, 'utf8')), 'hex') INTO v_decisions_hash;
  IF NOT v_chain_hash AND rec.decisions_hash <> v_decisions_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'reconciliation decision hash changed';
  END IF;
  IF v_chain_hash THEN v_decisions_hash:=rec.decisions_hash; END IF;
  SELECT coalesce(jsonb_object_agg(d.observation_id::text, to_jsonb(d)), '{}'::jsonb)
    INTO latest_decisions
  FROM (
    SELECT DISTINCT ON (decision.observation_id) decision.*
    FROM source_reconciliation_decisions(rec.id) decision
    ORDER BY decision.observation_id, decision.revision_no DESC, decision.decided_at DESC, decision.id DESC
  ) d;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(latest_decisions) entry
    WHERE entry.value->>'policy_version' <> rec.policy_version
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(rec.manifest->'lines') value
    WHERE latest_decisions ? (value->'observation'->>'id')
      AND latest_decisions->(value->'observation'->>'id')->>'locator' <> value->'observation'->>'locator'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'decision does not identify the reconciliation line';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(rec.manifest->'lines') value
    WHERE value->>'category' IN ('inserted', 'updated', 'unchanged')
      AND nullif(value->>'stableRecordId', '') IS NOT NULL
    GROUP BY (value->>'stableRecordId')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'multiple observations resolve to the same stable record';
  END IF;
  -- Locks are acquired in UUID order to keep concurrent applications deadlock-free.
  FOR rid IN
    SELECT DISTINCT (value->>'stableRecordId')::uuid
    FROM jsonb_array_elements(rec.manifest->'lines') value
    WHERE value->>'category' IN ('inserted', 'updated', 'unchanged')
      AND nullif(value->>'stableRecordId', '') IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('source-reconciliation:record:' || rid::text, 7824001));
  END LOOP;
  -- The materialized leaf already contains the validated final target/category.
  -- Do not invoke the recursive decision function once per line.
  FOR line IN
    SELECT value
    FROM jsonb_array_elements(rec.manifest->'lines') value
    WHERE value->>'category' IN ('inserted', 'updated', 'unchanged')
      AND nullif(value->>'stableRecordId', '') IS NOT NULL
    ORDER BY value->>'stableRecordId', value->'observation'->>'locator'
  LOOP
    rid := (line->>'stableRecordId')::uuid;
    oid := (line->'observation'->>'id')::uuid;
    decision_outcome := (latest_decisions->(oid::text))->>'outcome';
    decision_id := nullif((latest_decisions->(oid::text))->>'id', '')::uuid;
    decision_rationale := (latest_decisions->(oid::text))->>'rationale';
    decision_version := (latest_decisions->(oid::text))->>'version';
    decision_decided_at := nullif((latest_decisions->(oid::text))->>'decided_at', '')::timestamptz;
    IF decision_outcome='keep-current' THEN
      SELECT effective.effective_payload,effective.decimal_sources,effective.duration_sources,effective.effective_state,
        effective.source_observation_id,effective.adjustment_event_id,effective.decision_event_id
      INTO preserved_payload,preserved_decimal_sources,preserved_duration_sources,preserved_state,
        preserved_source_observation_id,preserved_adjustment_event_id,preserved_decision_event_id
      FROM source_reconciliation_effective_record(rid) effective;
      IF NOT FOUND OR preserved_state='disregarded' THEN
        RAISE EXCEPTION USING ERRCODE='XX001',MESSAGE='keep-current effective record is unavailable';
      END IF;
    END IF;
    IF decision_outcome = 'create' AND EXISTS (SELECT 1 FROM public.src_stable_record WHERE id = rid) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'create decision stable record id already exists';
    END IF;
    IF decision_outcome = 'create' THEN
      INSERT INTO public.src_stable_record (id, state, matching_attributes, created_at)
        VALUES (rid, 'active', coalesce((
          SELECT jsonb_object_agg(policy_field.field_name, line->'observation'->'matchingAttributes'->policy_field.field_name ORDER BY policy_field.field_name)
          FROM jsonb_array_elements_text(rec.manifest->'policy'->'fields') AS policy_field(field_name)
        ), '{}'::jsonb), v_now);
    END IF;
    evt_id := gen_random_uuid();
    INSERT INTO public.src_effective_record_event
      (id, reconciliation_id, record_id, observation_id, event_type, layer, payload, decimal_sources, duration_sources, actor, occurred_at, version)
      VALUES (evt_id, rec.id, rid, oid, CASE WHEN line->>'category' = 'inserted' THEN 'record.inserted' ELSE 'observation.accepted' END,
        'source', coalesce(line->'observation'->'normalizedPayload', '{}'::jsonb), CASE WHEN line->'observation' ? 'decimalSources' THEN line->'observation'->'decimalSources' ELSE NULL END, CASE WHEN line->'observation' ? 'durationSources' THEN line->'observation'->'durationSources' ELSE NULL END, p_actor, v_now,
        rec.batch_id::text || ':' || coalesce(line->'observation'->>'locator', '')) ON CONFLICT DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
    IF EXISTS (SELECT 1 FROM public.src_effective_record_event WHERE id = evt_id) THEN
      SELECT coalesce(line->'conflict'->>'code' = 'PROTECTED_LAYER', false)
        OR EXISTS (
          SELECT 1 FROM public.src_effective_record_projection p
          WHERE p.record_id = rid AND (p.adjustment_event_id IS NOT NULL OR p.decision_event_id IS NOT NULL)
        )
        INTO protected_layer;
      IF decision_outcome = 'keep-current' THEN
        -- Keep-current records both source lineage and the human act, while
        -- retaining every protected value and pointer in the effective row.
        evt_id := gen_random_uuid();
        INSERT INTO public.src_effective_record_event
          (id, reconciliation_id, record_id, observation_id, event_type, layer, payload, decimal_sources, duration_sources, actor, occurred_at, version,
           decision_id, decision_rationale, decision_version, decision_decided_at)
        VALUES (evt_id, rec.id, rid, oid, 'decision.audit', 'decision',
          preserved_payload,preserved_decimal_sources,preserved_duration_sources,
          p_actor, v_now, rec.batch_id::text || ':' || coalesce(line->'observation'->>'locator', '') || ':decision',
          decision_id, decision_rationale, decision_version, decision_decided_at)
          ON CONFLICT DO NOTHING;
        IF FOUND THEN v_count := v_count + 1; END IF;
        INSERT INTO public.src_effective_record_projection
          (record_id, payload, decimal_sources, duration_sources, source_observation_id, adjustment_event_id, decision_event_id, observed_batch_id, state, version, updated_at)
        VALUES (rid,preserved_payload,preserved_decimal_sources,preserved_duration_sources,oid,
          preserved_adjustment_event_id,evt_id,rec.batch_id,preserved_state,
          (SELECT version FROM public.src_projection_version WHERE singleton) + 1, v_now)
        ON CONFLICT (record_id) DO UPDATE SET
          payload = EXCLUDED.payload,
          decimal_sources = EXCLUDED.decimal_sources,
          duration_sources = EXCLUDED.duration_sources,
          source_observation_id = EXCLUDED.source_observation_id,
          adjustment_event_id = EXCLUDED.adjustment_event_id,
          decision_event_id = EXCLUDED.decision_event_id,
          observed_batch_id = EXCLUDED.observed_batch_id,
          state = EXCLUDED.state,
          version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
      ELSIF decision_outcome = 'link' THEN
        -- A human link that replaces a protected layer remains a decision event.
        -- The source observation is still recorded, while the projection keeps
        -- the existing adjustment pointer and moves its decision pointer to the
        -- new audited authorization.
        evt_id := gen_random_uuid();
        INSERT INTO public.src_effective_record_event
          (id, reconciliation_id, record_id, observation_id, event_type, layer, payload, decimal_sources, duration_sources, actor, occurred_at, version,
           decision_id, decision_rationale, decision_version, decision_decided_at)
          VALUES (evt_id, rec.id, rid, oid, 'decision.audit', 'decision',
            coalesce(line->'observation'->'normalizedPayload', '{}'::jsonb), CASE WHEN line->'observation' ? 'decimalSources' THEN line->'observation'->'decimalSources' ELSE NULL END, CASE WHEN line->'observation' ? 'durationSources' THEN line->'observation'->'durationSources' ELSE NULL END, p_actor, v_now,
            rec.batch_id::text || ':' || coalesce(line->'observation'->>'locator', '') || ':decision',
            decision_id, decision_rationale, decision_version, decision_decided_at)
          ON CONFLICT DO NOTHING;
        IF FOUND THEN v_count := v_count + 1; END IF;
        INSERT INTO public.src_effective_record_projection
          (record_id, payload, decimal_sources, duration_sources, source_observation_id, adjustment_event_id, decision_event_id, observed_batch_id, state, version, updated_at)
          VALUES (rid, coalesce(line->'observation'->'normalizedPayload', '{}'::jsonb), CASE WHEN line->'observation' ? 'decimalSources' THEN line->'observation'->'decimalSources' ELSE NULL END, CASE WHEN line->'observation' ? 'durationSources' THEN line->'observation'->'durationSources' ELSE NULL END, oid,
            CASE WHEN protected_layer THEN (SELECT p.adjustment_event_id FROM public.src_effective_record_projection p WHERE p.record_id = rid) ELSE NULL END,
            evt_id, rec.batch_id, 'active',
            (SELECT version FROM public.src_projection_version WHERE singleton) + 1, v_now)
        ON CONFLICT (record_id) DO UPDATE SET payload = EXCLUDED.payload, decimal_sources = EXCLUDED.decimal_sources,
          duration_sources = EXCLUDED.duration_sources, source_observation_id = EXCLUDED.source_observation_id,
          adjustment_event_id = coalesce(EXCLUDED.adjustment_event_id, public.src_effective_record_projection.adjustment_event_id),
          decision_event_id = EXCLUDED.decision_event_id, observed_batch_id = EXCLUDED.observed_batch_id,
          state = EXCLUDED.state, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
      ELSE
        INSERT INTO public.src_effective_record_projection
          (record_id, payload, decimal_sources, duration_sources, source_observation_id, observed_batch_id, state, version, updated_at)
          VALUES (rid, coalesce(line->'observation'->'normalizedPayload', '{}'::jsonb), CASE WHEN line->'observation' ? 'decimalSources' THEN line->'observation'->'decimalSources' ELSE NULL END, CASE WHEN line->'observation' ? 'durationSources' THEN line->'observation'->'durationSources' ELSE NULL END, oid, rec.batch_id, 'active',
            (SELECT version FROM public.src_projection_version WHERE singleton) + 1, v_now)
        ON CONFLICT (record_id) DO UPDATE SET payload = EXCLUDED.payload, decimal_sources = EXCLUDED.decimal_sources,
          duration_sources = EXCLUDED.duration_sources, source_observation_id = EXCLUDED.source_observation_id,
          observed_batch_id = EXCLUDED.observed_batch_id, state = EXCLUDED.state, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
      END IF;
    END IF;
  END LOOP;
  v_version := v_current_version + 1;
  UPDATE public.src_projection_version SET version = v_version WHERE singleton;
  SELECT coalesce(jsonb_agg(to_jsonb(projection) || jsonb_build_object(
      'payload',effective.effective_payload,'decimal_sources',effective.decimal_sources,
      'duration_sources',effective.duration_sources,'version',projection.version::text)
      ORDER BY projection.record_id),'[]'::jsonb)
    INTO frozen_snapshot
  FROM public.src_effective_record_projection projection
  CROSS JOIN LATERAL source_reconciliation_effective_record(projection.record_id) effective;
  frozen_snapshot_hash:=encode(sha256(convert_to(source_reconciliation_jcs(frozen_snapshot),'utf8')),'hex');
  SELECT source_reconciliation_event_hash(rec.id) INTO frozen_event_hash;
  INSERT INTO public.src_reconciliation_application
    (id, reconciliation_id, idempotency_key, request_id, actor, applied_at, projection_version, event_count, summary, audit_payload)
    VALUES (gen_random_uuid(), rec.id, p_idempotency_key, p_request_id, p_actor, v_now, v_version, v_count, rec.summary,
      jsonb_build_object('actor', p_actor, 'appliedAt', v_now, 'confirmationId', rec.confirmation_id, 'batchId', rec.batch_id,
        'previewId', rec.preview_id, 'sourceFileId', rec.source_file_id, 'sourceSha256', rec.source_sha256,
        'contractHash', rec.contract_hash, 'transformationHash', rec.transformation_hash, 'previewHash', rec.preview_hash,
        'policyVersion', rec.policy_version, 'decisionsHash', v_decisions_hash, 'chainHash', rec.decisions_hash, 'decisions', rec.manifest->'decisions', 'counts', rec.summary, 'metrics', rec.manifest->'metrics',
        'snapshotHash',frozen_snapshot_hash,'eventHash',frozen_event_hash));
  INSERT INTO public.src_reconciliation_confirmation_application (confirmation_id, reconciliation_id, applied_at)
    VALUES (rec.confirmation_id, rec.id, v_now)
    ON CONFLICT (confirmation_id) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM public.src_reconciliation_confirmation_application
    WHERE confirmation_id = rec.confirmation_id AND reconciliation_id <> rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'confirmation already has an applied reconciliation';
  END IF;
  INSERT INTO public.src_reconciliation_request (operation, idempotency_key, fingerprint, reconciliation_id)
    VALUES ('apply', p_idempotency_key, rec.fingerprint, rec.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.src_effective_snapshot (id, reconciliation_id, batch_id, projection_version, projection, created_at)
    VALUES (gen_random_uuid(), rec.id, rec.batch_id, v_version,frozen_snapshot,v_now);
  IF NOT EXISTS(SELECT 1 FROM public.src_reconciliation_head h WHERE h.lineage_id=coalesce(rec.lineage_id,rec.id) AND h.leaf_reconciliation_id=rec.id) OR (SELECT version FROM public.src_projection_version WHERE singleton)<>v_version THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='reconciliation epochs changed during apply';END IF;
  RETURN QUERY SELECT false, v_count, v_version;
END;
$$;

CREATE OR REPLACE FUNCTION read_source_reconciliation(p_reconciliation_id uuid)
RETURNS TABLE(manifest jsonb,decisions jsonb,fingerprint char(64),idempotency_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $read$
BEGIN
 IF session_user<>'tria_app' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reconciliation read is restricted to the application role';END IF;
 PERFORM source_reconciliation_verify_absence_anchor(p_reconciliation_id);
 RETURN QUERY SELECT source_reconciliation_materialize_manifest(r.id,false),coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',d.id::text,'observationId',d.observation_id::text,'locator',d.locator,'stableRecordId',d.stable_record_id::text,'outcome',d.outcome,'actor',d.actor,'decidedAt',d.decided_at,'policyVersion',d.policy_version,'rationale',d.rationale,'version',d.version,'revisionNo',d.revision_no)) ORDER BY d.revision_no,d.decided_at,d.id) FROM source_reconciliation_decisions(r.id)d),'[]'::jsonb),r.fingerprint,r.idempotency_key FROM public.src_reconciliation r WHERE r.id=p_reconciliation_id;
END;$read$;

REVOKE ALL ON FUNCTION validate_import_graph(), source_reconciliation_validate_staging_row_json(), prevent_source_reconciliation_mutation(), read_source_reconciliation(uuid), source_reconciliation_ordered_root_tree(jsonb), source_reconciliation_root_request_hash(uuid,jsonb), source_reconciliation_event_hash(uuid), source_reconciliation_avl_empty_hash(), source_reconciliation_avl_node_hash(uuid,jsonb,bytea,bytea,smallint,bigint,uuid,uuid), source_reconciliation_avl_commitment(bytea,bigint,uuid,uuid), source_reconciliation_avl_load_verified_node(uuid,uuid), source_reconciliation_avl_verify_node(uuid,uuid), source_reconciliation_avl_make_node(uuid,bigint,uuid,jsonb,uuid,uuid), source_reconciliation_avl_build(uuid,bigint,jsonb,integer,integer), source_reconciliation_avl_rebalance(uuid,bigint,uuid,jsonb,uuid,uuid), source_reconciliation_avl_set(uuid,bigint,uuid,uuid,jsonb), source_reconciliation_verify_absence_anchor(uuid), source_reconciliation_absence_page(uuid,uuid,integer), source_reconciliation_verify_lineage(uuid), source_reconciliation_decision_set_hash(uuid), validate_source_reconciliation_projection_pointers(), source_reconciliation_effective_record(uuid), source_reconciliation_stable_record_page(text,uuid,integer), validate_source_reconciliation_absence_span(), source_reconciliation_authenticated_absence_item(uuid, uuid, bigint, bigint, boolean, text, text, jsonb, text), source_reconciliation_has_reserved_key(jsonb), source_reconciliation_valid_decimal_sources(jsonb), source_reconciliation_valid_duration_sources(jsonb), source_reconciliation_absence_rows(uuid), source_reconciliation_absence_rows(uuid, uuid, integer), source_reconciliation_decisions(uuid), source_reconciliation_materialize_manifest(uuid), source_reconciliation_materialize_manifest(uuid, boolean), source_reconciliation_json_text(text), source_reconciliation_jcs(jsonb), source_reconciliation_observation_id(uuid, text), source_reconciliation_functional_hash(jsonb), source_reconciliation_canonical_matching_fields(jsonb), source_reconciliation_fingerprint(jsonb), source_reconciliation_decimal_text(numeric, integer), source_reconciliation_duration_seconds(text, text), source_reconciliation_metrics(jsonb), source_reconciliation_metric_accumulator(jsonb), source_reconciliation_field_diffs(jsonb, uuid, text), source_reconciliation_chain_hash(uuid, text, text, jsonb, jsonb), write_source_reconciliation(text, jsonb), write_source_reconciliation_decision(uuid, jsonb, uuid), alias_source_reconciliation_request(text,char(64),char(64),uuid,boolean), next_source_reconciliation_recovery_attempt(uuid, bigint), apply_source_reconciliation(uuid, text, uuid, text) FROM PUBLIC, tria_app, tria_importer;
REVOKE ALL PRIVILEGES ON src_stable_record, src_source_observation, src_record_match, src_reconciliation, src_import_conflict,
  src_reconciliation_decision, src_reconciliation_line_state, src_reconciliation_head, src_reconciliation_line_head, src_reconciliation_observed_target_head, src_reconciliation_target_bucket_head, src_reconciliation_target_bucket_transition, src_reconciliation_absence_head, src_reconciliation_absence_span, src_reconciliation_absence_key, src_reconciliation_absence_node, src_reconciliation_metric_head, src_reconciliation_absence, src_effective_record_event, src_projection_version, src_effective_record_projection,
  src_reconciliation_application, src_reconciliation_confirmation_application, src_reconciliation_recovery_attempt, src_effective_snapshot, src_reconciliation_request FROM PUBLIC, tria_app, tria_importer;
GRANT SELECT ON src_reconciliation_confirmation_application TO tria_app;
GRANT SELECT ON src_reconciliation_recovery_attempt TO tria_app;
GRANT SELECT ON src_stable_record, src_effective_record_event TO tria_app;
GRANT SELECT ON src_reconciliation, src_reconciliation_head, src_reconciliation_request TO tria_app;
GRANT SELECT ON src_effective_record_projection, src_reconciliation_application, src_effective_snapshot, src_projection_version TO tria_app;
GRANT EXECUTE ON FUNCTION read_source_reconciliation(uuid),source_reconciliation_absence_page(uuid,uuid,integer),source_reconciliation_stable_record_page(text,uuid,integer),write_source_reconciliation(text,jsonb), write_source_reconciliation_decision(uuid,jsonb,uuid), alias_source_reconciliation_request(text,char(64),char(64),uuid,boolean), apply_source_reconciliation(uuid,text,uuid,text) TO tria_app;
GRANT EXECUTE ON FUNCTION next_source_reconciliation_recovery_attempt(uuid, bigint) TO tria_app;
REVOKE INSERT ON src_stable_record, src_source_observation, src_record_match, src_reconciliation, src_import_conflict,
  src_reconciliation_decision, src_reconciliation_line_state, src_reconciliation_head, src_reconciliation_line_head, src_reconciliation_observed_target_head, src_reconciliation_target_bucket_head, src_reconciliation_target_bucket_transition, src_reconciliation_absence_head, src_reconciliation_absence_span, src_reconciliation_absence_key, src_reconciliation_absence_node, src_reconciliation_metric_head, src_reconciliation_absence, src_effective_record_event, src_projection_version, src_effective_record_projection,
  src_reconciliation_application, src_reconciliation_confirmation_application, src_reconciliation_recovery_attempt, src_effective_snapshot, src_reconciliation_request FROM PUBLIC, tria_app, tria_importer;
REVOKE UPDATE, DELETE, TRUNCATE ON src_stable_record, src_source_observation, src_record_match, src_reconciliation, src_import_conflict,
  src_reconciliation_decision, src_reconciliation_line_state, src_reconciliation_head, src_reconciliation_line_head, src_reconciliation_observed_target_head, src_reconciliation_target_bucket_head, src_reconciliation_target_bucket_transition, src_reconciliation_absence_head, src_reconciliation_absence_span, src_reconciliation_absence_key, src_reconciliation_absence_node, src_reconciliation_metric_head, src_reconciliation_absence, src_effective_record_event, src_projection_version, src_effective_record_projection,
  src_reconciliation_application, src_reconciliation_confirmation_application, src_reconciliation_recovery_attempt, src_effective_snapshot, src_reconciliation_request FROM tria_app;

DO $database_temp_acl$
DECLARE database_owner oid;owner_name text;can_revoke boolean;
BEGIN
 SELECT datdba,pg_get_userbyid(datdba) INTO database_owner,owner_name FROM pg_database WHERE datname=current_database();
 SELECT current_user=owner_name OR rolsuper INTO can_revoke FROM pg_roles WHERE rolname=current_user;
 IF can_revoke THEN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC,tria_app,tria_importer',current_database());
 ELSIF has_database_privilege('tria_app',current_database(),'TEMPORARY') OR has_database_privilege('tria_importer',current_database(),'TEMPORARY') THEN
   RAISE EXCEPTION 'database owner % must revoke TEMPORARY before migration',owner_name;
 END IF;
END $database_temp_acl$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

DO $acl_assert$
DECLARE relation_name text;signature text;privilege_name text;expected_select boolean;
  protected_relations constant text[]:=ARRAY['src_stable_record','src_source_observation','src_record_match','src_reconciliation','src_import_conflict','src_reconciliation_decision','src_reconciliation_line_state','src_reconciliation_head','src_reconciliation_line_head','src_reconciliation_observed_target_head','src_reconciliation_target_bucket_head','src_reconciliation_target_bucket_transition','src_reconciliation_absence_head','src_reconciliation_absence_span','src_reconciliation_absence_key','src_reconciliation_absence_node','src_reconciliation_metric_head','src_reconciliation_absence','src_effective_record_event','src_projection_version','src_effective_record_projection','src_reconciliation_application','src_reconciliation_confirmation_application','src_reconciliation_recovery_attempt','src_effective_snapshot','src_reconciliation_request'];
  app_select constant text[]:=ARRAY['src_reconciliation_confirmation_application','src_reconciliation_recovery_attempt','src_stable_record','src_effective_record_event','src_reconciliation','src_reconciliation_head','src_reconciliation_request','src_effective_record_projection','src_reconciliation_application','src_effective_snapshot','src_projection_version'];
  protected_routines constant text[]:=ARRAY['validate_import_graph()','source_reconciliation_validate_staging_row_json()','prevent_source_reconciliation_mutation()','read_source_reconciliation(uuid)','source_reconciliation_ordered_root_tree(jsonb)','source_reconciliation_root_request_hash(uuid,jsonb)','source_reconciliation_event_hash(uuid)','source_reconciliation_avl_empty_hash()','source_reconciliation_avl_node_hash(uuid,jsonb,bytea,bytea,smallint,bigint,uuid,uuid)','source_reconciliation_avl_commitment(bytea,bigint,uuid,uuid)','source_reconciliation_avl_load_verified_node(uuid,uuid)','source_reconciliation_avl_verify_node(uuid,uuid)','source_reconciliation_avl_make_node(uuid,bigint,uuid,jsonb,uuid,uuid)','source_reconciliation_avl_build(uuid,bigint,jsonb,integer,integer)','source_reconciliation_avl_rebalance(uuid,bigint,uuid,jsonb,uuid,uuid)','source_reconciliation_avl_set(uuid,bigint,uuid,uuid,jsonb)','source_reconciliation_verify_absence_anchor(uuid)','source_reconciliation_absence_page(uuid,uuid,integer)','source_reconciliation_verify_lineage(uuid)','source_reconciliation_decision_set_hash(uuid)','validate_source_reconciliation_projection_pointers()','source_reconciliation_effective_record(uuid)','source_reconciliation_stable_record_page(text,uuid,integer)','validate_source_reconciliation_absence_span()','source_reconciliation_authenticated_absence_item(uuid,uuid,bigint,bigint,boolean,text,text,jsonb,text)','source_reconciliation_has_reserved_key(jsonb)','source_reconciliation_valid_decimal_sources(jsonb)','source_reconciliation_valid_duration_sources(jsonb)','source_reconciliation_absence_rows(uuid)','source_reconciliation_absence_rows(uuid,uuid,integer)','source_reconciliation_decisions(uuid)','source_reconciliation_materialize_manifest(uuid)','source_reconciliation_materialize_manifest(uuid,boolean)','source_reconciliation_json_text(text)','source_reconciliation_jcs(jsonb)','source_reconciliation_observation_id(uuid,text)','source_reconciliation_functional_hash(jsonb)','source_reconciliation_canonical_matching_fields(jsonb)','source_reconciliation_fingerprint(jsonb)','source_reconciliation_decimal_text(numeric,integer)','source_reconciliation_duration_seconds(text,text)','source_reconciliation_metrics(jsonb)','source_reconciliation_metric_accumulator(jsonb)','source_reconciliation_field_diffs(jsonb,uuid,text)','source_reconciliation_chain_hash(uuid,text,text,jsonb,jsonb)','write_source_reconciliation(text,jsonb)','write_source_reconciliation_decision(uuid,jsonb,uuid)','alias_source_reconciliation_request(text,character,character,uuid,boolean)','next_source_reconciliation_recovery_attempt(uuid,bigint)','apply_source_reconciliation(uuid,text,uuid,text)'];
  app_execute constant text[]:=ARRAY['read_source_reconciliation(uuid)','source_reconciliation_absence_page(uuid,uuid,integer)','source_reconciliation_stable_record_page(text,uuid,integer)','write_source_reconciliation(text,jsonb)','write_source_reconciliation_decision(uuid,jsonb,uuid)','alias_source_reconciliation_request(text,character,character,uuid,boolean)','next_source_reconciliation_recovery_attempt(uuid,bigint)','apply_source_reconciliation(uuid,text,uuid,text)'];
BEGIN
 IF has_database_privilege('tria_app',current_database(),'TEMPORARY') OR has_database_privilege('tria_importer',current_database(),'TEMPORARY') THEN RAISE EXCEPTION 'application roles retain TEMPORARY';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('tria_app','tria_importer') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'application role attributes are unsafe';END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN('tria_app','tria_importer')) THEN RAISE EXCEPTION 'application role retains membership';END IF;
 IF NOT has_database_privilege('tria_app',current_database(),'CONNECT') OR NOT has_database_privilege('tria_importer',current_database(),'CONNECT') OR has_database_privilege('tria_app',current_database(),'CREATE,TEMPORARY') OR has_database_privilege('tria_importer',current_database(),'CREATE,TEMPORARY') OR NOT has_schema_privilege('tria_app','public','USAGE') OR NOT has_schema_privilege('tria_importer','public','USAGE') OR has_schema_privilege('tria_app','public','CREATE') OR has_schema_privilege('tria_importer','public','CREATE') THEN RAISE EXCEPTION 'database/schema ACL scope is unsafe';END IF;
 IF EXISTS(SELECT 1 FROM pg_database d JOIN pg_roles owner ON owner.oid=d.datdba WHERE d.datname=current_database() AND owner.rolname IN('tria_app','tria_importer')) OR EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner WHERE n.nspname='public' AND owner.rolname IN('tria_app','tria_importer')) THEN RAISE EXCEPTION 'application role owns database or schema';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner WHERE c.oid=ANY(SELECT name::regclass FROM unnest(protected_relations) names(name)) AND owner.rolname IN('tria_app','tria_importer')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=ANY(SELECT item::regprocedure FROM unnest(protected_routines) signatures(item)) AND owner.rolname IN('tria_app','tria_importer')) THEN RAISE EXCEPTION 'application role owns a protected object';END IF;
 FOREACH relation_name IN ARRAY protected_relations LOOP
   expected_select:=relation_name=ANY(app_select);
   IF has_table_privilege('tria_app',relation_name,'SELECT') IS DISTINCT FROM expected_select OR has_table_privilege('tria_app',relation_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('tria_importer',relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=relation_name::regclass AND acl.grantee=0 AND acl.privilege_type IN('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) THEN RAISE EXCEPTION 'relation ACL mismatch: %',relation_name;END IF;
 END LOOP;
 FOREACH signature IN ARRAY protected_routines LOOP
   IF has_function_privilege('tria_app',signature,'EXECUTE') IS DISTINCT FROM (signature=ANY(app_execute)) OR has_function_privilege('tria_importer',signature,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid=signature::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'routine ACL mismatch: %',signature;END IF;
 END LOOP;
END $acl_assert$;
