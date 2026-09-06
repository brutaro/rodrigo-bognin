-- Source-ledger 3.2: only a separately seeded, isolated synthetic source can be read.
ALTER TABLE source_file ADD CONSTRAINT source_file_version_pair UNIQUE (id, file_version_id);

CREATE TABLE src_import_source_attestation (
  id uuid PRIMARY KEY,
  source_file_id uuid NOT NULL UNIQUE,
  file_version_id uuid NOT NULL UNIQUE,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK (source_format IN ('XLS', 'XLSX', 'CSV')),
  namespace text NOT NULL CHECK (namespace ~ '^tria-(evidence|vault|adjustments)-[a-z0-9_-]+$'),
  attestation_kind text NOT NULL CHECK (attestation_kind = 'synthetic-seed-v1'),
  attested_at timestamptz NOT NULL,
  UNIQUE (source_file_id, file_version_id, source_sha256, source_format),
  FOREIGN KEY (source_file_id, file_version_id) REFERENCES source_file(id, file_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (file_version_id) REFERENCES file_version(id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION validate_source_attestation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE actual_sha char(64); actual_format text; actual_status text; actual_document uuid;
BEGIN
  IF session_user <> 'tria_importer' AND NOT (session_user = 'tria_app' AND EXISTS (SELECT 1 FROM public.src_import_synthetic_context c JOIN public.source_file f ON f.id = NEW.source_file_id WHERE c.namespace = NEW.namespace AND f.xmin::text = pg_current_xact_id()::text)) THEN RAISE EXCEPTION 'synthetic attestations are seed-only'; END IF;
  SELECT v.sha256, upper(sf.source_format), v.status, sf.document_id
    INTO actual_sha, actual_format, actual_status, actual_document
    FROM source_file sf JOIN file_version v ON v.id = sf.file_version_id AND v.document_id = sf.document_id
    WHERE sf.id = NEW.source_file_id AND sf.file_version_id = NEW.file_version_id;
  IF actual_sha IS NULL OR actual_sha <> NEW.source_sha256 OR actual_format <> NEW.source_format OR actual_status <> 'active' THEN
    RAISE EXCEPTION 'synthetic attestation does not match source version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM file_document WHERE id = actual_document AND document_kind = 'source' AND status = 'active') THEN
    RAISE EXCEPTION 'synthetic attestation does not match an active source';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER src_import_source_attestation_valid
BEFORE INSERT OR UPDATE ON src_import_source_attestation
FOR EACH ROW EXECUTE FUNCTION validate_source_attestation();

CREATE TABLE src_import_contract (
  id uuid PRIMARY KEY,
  contract_hash char(64) NOT NULL UNIQUE CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK (source_format IN ('XLSX', 'CSV')),
  sheet_selection jsonb,
  csv_parse_options jsonb,
  schema_id text NOT NULL CHECK (schema_id = 'synthetic-source-schema-v1'),
  parser_profile_id text NOT NULL CHECK (parser_profile_id = 'synthetic-safe-v1'),
  transformation_id text NOT NULL CHECK (transformation_id = 'remove-course-track-v1'),
  limits_profile_id text NOT NULL CHECK (limits_profile_id = 'synthetic-safe-v1'),
  schema_version text NOT NULL CHECK (schema_version = 'synthetic-source-schema-v1'),
  parser_version text NOT NULL CHECK (parser_version = 'synthetic-passive-tabular-v1'),
  transformation_version text NOT NULL CHECK (transformation_version = 'source-transformation-v1'),
  transformation_hash char(64) NOT NULL CHECK (transformation_hash ~ '^[0-9a-f]{64}$'),
  header_mapping jsonb NOT NULL,
  ignored_columns jsonb NOT NULL CHECK (ignored_columns = '["curso", "trilha"]'::jsonb),
  limits jsonb NOT NULL,
  contract_payload jsonb NOT NULL,
  UNIQUE (id, contract_hash, source_format, transformation_hash),
  UNIQUE (id, source_format),
  CHECK ((source_format = 'CSV' AND sheet_selection IS NULL AND csv_parse_options IS NOT NULL) OR
         (source_format = 'XLSX' AND sheet_selection IS NOT NULL AND csv_parse_options IS NULL))
);

CREATE TABLE src_import_batch (
  id uuid PRIMARY KEY,
  source_file_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK (source_format IN ('XLS', 'XLSX', 'CSV')),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  prepared_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL CHECK (retain_until >= prepared_at + interval '30 days'),
  status text NOT NULL CHECK (status IN ('Validado', 'Rejeitado')),
  fingerprint char(64) NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  contract_id uuid,
  found_count integer NOT NULL CHECK (found_count >= 0),
  valid_count integer NOT NULL CHECK (valid_count >= 0 AND valid_count <= found_count),
  error_count integer NOT NULL CHECK (error_count >= 0 AND error_count <= found_count),
  rejected_count integer NOT NULL CHECK (rejected_count >= 0 AND rejected_count <= found_count),
  rejection_code text CHECK (status = 'Validado' OR length(rejection_code) BETWEEN 1 AND 120),
  rejection_message text CHECK (status = 'Validado' OR length(rejection_message) BETWEEN 1 AND 500),
  request_id uuid,
  FOREIGN KEY (source_file_id, file_version_id, source_sha256, source_format)
    REFERENCES src_import_source_attestation(source_file_id, file_version_id, source_sha256, source_format) ON DELETE RESTRICT,
  FOREIGN KEY (contract_id, source_format) REFERENCES src_import_contract(id, source_format) ON DELETE RESTRICT,
  CHECK ((status = 'Validado' AND contract_id IS NOT NULL AND rejection_code IS NULL AND rejection_message IS NULL) OR
         (status = 'Rejeitado' AND contract_id IS NULL AND rejection_code IS NOT NULL AND rejection_message IS NOT NULL)),
  UNIQUE (id, source_file_id, file_version_id, source_sha256, source_format, contract_id)
);
CREATE INDEX src_import_batch_source_idx ON src_import_batch(source_file_id, file_version_id, prepared_at, id);

CREATE TABLE src_import_staging_row (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 200),
  source_row_hash char(64) NOT NULL CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  normalized_payload jsonb NOT NULL,
  source_values jsonb NOT NULL,
  decimal_sources jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('valid', 'rejected')),
  field_errors jsonb NOT NULL,
  retain_until timestamptz NOT NULL,
  UNIQUE (batch_id, locator),
  CHECK (NOT (normalized_payload ? 'curso') AND NOT (normalized_payload ? 'trilha'))
);
CREATE INDEX src_import_staging_batch_idx ON src_import_staging_row(batch_id, locator, id);

CREATE TABLE src_import_preview (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL UNIQUE REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  source_file_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK (source_format IN ('XLSX', 'CSV')),
  contract_id uuid NOT NULL,
  contract_hash char(64) NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  transformation_hash char(64) NOT NULL CHECK (transformation_hash ~ '^[0-9a-f]{64}$'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  row_result_hash char(64) NOT NULL CHECK (row_result_hash ~ '^[0-9a-f]{64}$'),
  preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL,
  summary jsonb NOT NULL,
  prepared_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL CHECK (retain_until >= prepared_at + interval '30 days'),
  FOREIGN KEY (batch_id, source_file_id, file_version_id, source_sha256, source_format, contract_id)
    REFERENCES src_import_batch(id, source_file_id, file_version_id, source_sha256, source_format, contract_id) ON DELETE RESTRICT,
  FOREIGN KEY (contract_id, contract_hash, source_format, transformation_hash) REFERENCES src_import_contract(id, contract_hash, source_format, transformation_hash) ON DELETE RESTRICT,
  UNIQUE (id, batch_id, source_file_id, file_version_id, source_sha256, contract_id, contract_hash, transformation_hash, content_hash, row_result_hash, source_format, preview_hash),
  UNIQUE (id, batch_id),
  UNIQUE (source_file_id, file_version_id, preview_hash)
);

CREATE TABLE src_import_preview_confirmation (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL UNIQUE,
  batch_id uuid NOT NULL,
  source_file_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL,
  content_hash char(64) NOT NULL,
  row_result_hash char(64) NOT NULL,
  contract_id uuid NOT NULL,
  contract_hash char(64) NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  transformation_hash char(64) NOT NULL CHECK (transformation_hash ~ '^[0-9a-f]{64}$'),
  preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  confirmed_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  confirmation_payload jsonb NOT NULL,
  FOREIGN KEY (preview_id, batch_id, source_file_id, file_version_id, source_sha256, contract_id, contract_hash, transformation_hash, content_hash, row_result_hash, source_format, preview_hash)
    REFERENCES src_import_preview(id, batch_id, source_file_id, file_version_id, source_sha256, contract_id, contract_hash, transformation_hash, content_hash, row_result_hash, source_format, preview_hash) ON DELETE RESTRICT
);

CREATE TABLE src_import_event (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('source.import.preview_prepared.v1', 'source.import.preview_confirmed.v1', 'source.import.preview_rejected.v1')),
  entity_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id) ON DELETE RESTRICT,
  preview_id uuid REFERENCES src_import_preview(id) ON DELETE RESTRICT,
  actor text NOT NULL CHECK (actor = 'Rodrigo'),
  request_id uuid,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (event_type, entity_id),
  FOREIGN KEY (preview_id, batch_id) REFERENCES src_import_preview(id, batch_id) ON DELETE RESTRICT,
  CHECK ((event_type = 'source.import.preview_rejected.v1' AND preview_id IS NULL) OR
         (event_type <> 'source.import.preview_rejected.v1' AND preview_id IS NOT NULL))
);
CREATE INDEX src_import_event_graph_idx ON src_import_event(batch_id, preview_id, occurred_at, id);

CREATE OR REPLACE FUNCTION prevent_source_import_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'source import records are append-only'; END; $$;
CREATE TRIGGER src_import_attestation_immutable BEFORE UPDATE OR DELETE ON src_import_source_attestation FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_contract_immutable BEFORE UPDATE OR DELETE ON src_import_contract FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_batch_immutable BEFORE UPDATE OR DELETE ON src_import_batch FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_staging_row_immutable BEFORE UPDATE OR DELETE ON src_import_staging_row FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_preview_immutable BEFORE UPDATE OR DELETE ON src_import_preview FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_confirmation_immutable BEFORE UPDATE OR DELETE ON src_import_preview_confirmation FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
CREATE TRIGGER src_import_event_immutable BEFORE UPDATE OR DELETE ON src_import_event FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();
REVOKE ALL ON FUNCTION prevent_source_import_mutation(), validate_source_attestation() FROM PUBLIC;

REVOKE ALL PRIVILEGES ON src_import_source_attestation, src_import_contract, src_import_batch, src_import_staging_row,
  src_import_preview, src_import_preview_confirmation, src_import_event FROM PUBLIC, tria_app, tria_importer;
GRANT SELECT ON src_import_source_attestation TO tria_app;
GRANT SELECT, INSERT ON src_import_contract, src_import_batch, src_import_staging_row, src_import_preview,
  src_import_preview_confirmation, src_import_event TO tria_app;
GRANT SELECT, INSERT ON src_import_source_attestation TO tria_importer;
GRANT SELECT (id, file_version_id, document_id, source_format) ON source_file TO tria_importer;
GRANT SELECT (id, document_id, sha256, status) ON file_version TO tria_importer;
GRANT SELECT (id, document_kind, status) ON file_document TO tria_importer;
REVOKE UPDATE, DELETE, TRUNCATE ON src_import_source_attestation, src_import_contract, src_import_batch, src_import_staging_row,
  src_import_preview, src_import_preview_confirmation, src_import_event FROM tria_app, tria_importer;

-- Only the disposable harness administrator can establish this database identity.
CREATE TABLE src_import_synthetic_context (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  namespace text NOT NULL CHECK (namespace ~ '^tria-adjustments-[a-z0-9_-]+$')
);
REVOKE ALL ON src_import_synthetic_context FROM PUBLIC, tria_app, tria_importer;

CREATE FUNCTION attest_new_synthetic_receipt(receipt_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE ns text; item record;
BEGIN
  SELECT namespace INTO ns FROM public.src_import_synthetic_context WHERE singleton;
  -- An unconfigured preparation context must not revoke opaque source reception.
  IF ns IS NULL THEN RETURN; END IF;
  IF ns <> current_setting('tria.synthetic_namespace', true) OR session_user <> 'tria_app' THEN
    RAISE EXCEPTION 'synthetic bridge disabled';
  END IF;
  SELECT f.id, f.file_version_id, upper(f.source_format) format, v.sha256 INTO item
    FROM public.source_file f JOIN public.file_version v ON v.id=f.file_version_id AND v.document_id=f.document_id
    JOIN public.source_file_event e ON e.source_file_id=f.id AND e.operation='source.file.received.v1'
    WHERE f.id=receipt_id AND f.xmin::text=pg_current_xact_id()::text AND e.xmin::text=pg_current_xact_id()::text;
  IF item.id IS NULL THEN RAISE EXCEPTION 'receipt is not newly received'; END IF;
  INSERT INTO public.src_import_source_attestation VALUES
    (gen_random_uuid(), item.id, item.file_version_id, item.sha256, item.format, ns, 'synthetic-seed-v1', now());
END; $$;
REVOKE ALL ON FUNCTION attest_new_synthetic_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attest_new_synthetic_receipt(uuid) TO tria_app;

CREATE TABLE src_import_request (
  operation text NOT NULL CHECK (operation IN ('prepare','confirm')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  fingerprint char(64) NOT NULL,
  batch_id uuid NOT NULL REFERENCES src_import_batch(id),
  preview_id uuid REFERENCES src_import_preview(id),
  FOREIGN KEY (preview_id,batch_id) REFERENCES src_import_preview(id,batch_id),
  PRIMARY KEY (operation,idempotency_key)
);
REVOKE ALL ON src_import_request FROM PUBLIC, tria_app, tria_importer;
GRANT SELECT, INSERT ON src_import_request TO tria_app;
CREATE TRIGGER src_import_request_immutable BEFORE UPDATE OR DELETE ON src_import_request FOR EACH ROW EXECUTE FUNCTION prevent_source_import_mutation();

CREATE FUNCTION validate_import_graph() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b public.src_import_batch; p public.src_import_preview; c public.src_import_preview_confirmation; contract public.src_import_contract; n integer; v integer; r integer;
BEGIN
  SELECT * INTO b FROM public.src_import_batch WHERE id=CASE WHEN TG_TABLE_NAME='src_import_batch' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'batch_id')::uuid END;
  IF TG_TABLE_NAME='src_import_staging_row' THEN
    IF b.status <> 'Validado' OR NEW.retain_until <> b.retain_until OR
       jsonb_typeof(NEW.field_errors)<>'array' OR (NEW.status='valid' AND jsonb_array_length(NEW.field_errors)<>0) OR (NEW.status='rejected' AND jsonb_array_length(NEW.field_errors)=0) OR
       EXISTS (SELECT 1 FROM jsonb_each(NEW.normalized_payload) j WHERE j.key NOT IN ('codigo','data','valor') OR jsonb_typeof(j.value) NOT IN ('string','null')) OR
       EXISTS (SELECT 1 FROM jsonb_each(NEW.source_values) j WHERE j.key NOT IN ('codigo','data','valor') OR jsonb_typeof(j.value)<>'string') OR
       NEW.source_values ?| ARRAY['curso','trilha'] OR NEW.decimal_sources ?| ARRAY['curso','trilha'] THEN RAISE EXCEPTION 'invalid staging graph'; END IF;
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
      SELECT 1 FROM jsonb_array_elements(p.manifest->'rows') row WHERE row->>'locator'=st.locator AND row->>'sourceRowHash'=st.source_row_hash AND row->'normalizedPayload'=st.normalized_payload AND row->'sourceValues'=st.source_values AND row->'decimalSources'=st.decimal_sources AND row->'fieldErrors'=st.field_errors AND row->>'status'=st.status)) OR jsonb_array_length(p.manifest->'rows')<>n THEN RAISE EXCEPTION 'invalid row manifest'; END IF;
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
REVOKE ALL ON FUNCTION validate_import_graph() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER validate_staging_graph AFTER INSERT ON src_import_staging_row DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_import_graph();
CREATE CONSTRAINT TRIGGER validate_preview_graph AFTER INSERT ON src_import_preview DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_import_graph();
CREATE CONSTRAINT TRIGGER validate_confirmation_graph AFTER INSERT ON src_import_preview_confirmation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_import_graph();
CREATE CONSTRAINT TRIGGER validate_event_graph AFTER INSERT ON src_import_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_import_graph();

CREATE CONSTRAINT TRIGGER validate_batch_graph AFTER INSERT ON src_import_batch DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_import_graph();
CREATE FUNCTION validate_import_contract_payload() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$ BEGIN
  IF NEW.contract_payload IS DISTINCT FROM (
    jsonb_build_object(
      'contractSchemaVersion','import-contract-v1','canonicalHashVersion','rfc8785-jcs-v1',
      'contractHash',NEW.contract_hash,'sourceFormat',NEW.source_format,
      'schemaId',NEW.schema_id,'parserProfileId',NEW.parser_profile_id,
      'transformationId',NEW.transformation_id,'limitsProfileId',NEW.limits_profile_id,
      'schemaVersion',NEW.schema_version,'parserVersion',NEW.parser_version,
      'transformationVersion',NEW.transformation_version,'transformationHash',NEW.transformation_hash,
      'headerMapping',NEW.header_mapping,'ignoredColumns',NEW.ignored_columns,'limits',NEW.limits
    ) || CASE WHEN NEW.source_format='CSV' THEN jsonb_build_object('csvParseOptions',NEW.csv_parse_options)
              ELSE jsonb_build_object('sheetSelection',NEW.sheet_selection) END
  ) THEN RAISE EXCEPTION 'invalid contract payload'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION validate_import_contract_payload() FROM PUBLIC;
CREATE TRIGGER validate_contract_payload BEFORE INSERT ON src_import_contract FOR EACH ROW EXECUTE FUNCTION validate_import_contract_payload();

CREATE FUNCTION validate_import_request() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$ BEGIN
  IF NEW.operation='prepare' AND NOT EXISTS(SELECT 1 FROM src_import_batch b WHERE b.id=NEW.batch_id AND b.fingerprint=NEW.fingerprint AND ((b.status='Rejeitado' AND NEW.preview_id IS NULL) OR (b.status='Validado' AND EXISTS(SELECT 1 FROM src_import_preview p WHERE p.id=NEW.preview_id AND p.batch_id=b.id)))) THEN RAISE EXCEPTION 'invalid preparation request'; END IF;
  IF NEW.operation='confirm' AND NOT EXISTS(SELECT 1 FROM src_import_preview_confirmation c WHERE c.preview_id=NEW.preview_id AND c.batch_id=NEW.batch_id AND c.payload_fingerprint=NEW.fingerprint) THEN RAISE EXCEPTION 'invalid confirmation request'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION validate_import_request() FROM PUBLIC;
CREATE TRIGGER validate_request_graph BEFORE INSERT ON src_import_request FOR EACH ROW EXECUTE FUNCTION validate_import_request();
