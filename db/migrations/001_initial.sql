CREATE TABLE import_batch (
  id uuid PRIMARY KEY,
  source_type text NOT NULL,
  relative_path text NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_type, sha256)
);

CREATE TABLE project (
  id text PRIMARY KEY,
  source_project_id text NOT NULL UNIQUE,
  title text NOT NULL UNIQUE,
  date_start date,
  date_end date,
  bm_count integer NOT NULL DEFAULT 0,
  activity_count integer NOT NULL DEFAULT 0,
  hours_total numeric(24,6),
  value_total numeric(30,16),
  evidence_status text NOT NULL,
  import_batch_id uuid NOT NULL REFERENCES import_batch(id)
);

CREATE TABLE bm_activity (
  id text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batch(id),
  project_id text NOT NULL REFERENCES project(id),
  source_id text NOT NULL,
  source_sheet text NOT NULL,
  source_excel_row integer NOT NULL,
  bm_code text NOT NULL,
  activity_date timestamptz,
  month_period timestamptz,
  cost_center text,
  functionality text,
  activity text,
  duration_seconds bigint,
  hourly_rate numeric(24,8),
  measured_value numeric(30,16) NOT NULL,
  quality_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, source_sheet, source_excel_row)
);
CREATE INDEX bm_activity_project_idx ON bm_activity(project_id, activity_date, bm_code);

CREATE TABLE fiscal_note (
  id text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batch(id),
  source_note_id text NOT NULL,
  issue_year smallint NOT NULL,
  note_number text NOT NULL,
  issue_date date NOT NULL,
  amount numeric(20,2) NOT NULL,
  category text,
  declared_project_id text REFERENCES project(id),
  UNIQUE (batch_id, source_note_id)
);
CREATE INDEX fiscal_note_declared_project_idx ON fiscal_note(declared_project_id);

CREATE TABLE financial_relation (
  fiscal_note_id text PRIMARY KEY REFERENCES fiscal_note(id),
  candidate_project_id text REFERENCES project(id),
  strength text NOT NULL,
  state text NOT NULL,
  criterion text,
  full_value_eligible boolean,
  verified_related_value numeric(20,2),
  snapshot_1505_state text,
  snapshot_3009_state text
);
CREATE INDEX financial_relation_candidate_idx ON financial_relation(candidate_project_id);

CREATE TABLE evidence_asset (
  id char(64) PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  sha256 char(64) NOT NULL UNIQUE,
  file_type text,
  private_path text NOT NULL,
  access_level text NOT NULL DEFAULT 'private'
);

CREATE TABLE project_evidence (
  project_id text NOT NULL REFERENCES project(id),
  evidence_asset_id char(64) NOT NULL REFERENCES evidence_asset(id),
  strength text NOT NULL,
  rule_used text,
  caveat text,
  status text NOT NULL,
  PRIMARY KEY (project_id, evidence_asset_id)
);

CREATE TABLE narrative_document (
  id text PRIMARY KEY,
  document_role text NOT NULL,
  private_path text NOT NULL,
  sha256 char(64) NOT NULL,
  version_status text NOT NULL,
  access_level text NOT NULL,
  line_count integer NOT NULL
);

CREATE TABLE project_draft (
  project_id text PRIMARY KEY REFERENCES project(id),
  narrative text NOT NULL DEFAULT '',
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz
);

CREATE TABLE manual_financial_entry (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  kind text NOT NULL CHECK (kind IN ('Custo ou valor do projeto', 'Nota ou cobrança', 'Pagamento', 'Valor informado')),
  description text NOT NULL,
  amount_cents numeric(24,0) NOT NULL CHECK (amount_cents >= 0),
  origin text NOT NULL CHECK (origin IN ('Informado por Rodrigo', 'Cadastro demonstrativo')),
  document_state text NOT NULL CHECK (document_state IN ('Sem arquivo associado', 'Com arquivo associado')),
  created_at timestamptz NOT NULL
);
CREATE INDEX manual_financial_entry_project_idx ON manual_financial_entry(project_id, created_at);

CREATE TABLE history_event (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  action text NOT NULL,
  detail text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX history_event_project_idx ON history_event(project_id, occurred_at DESC);

CREATE TABLE publication (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  version integer NOT NULL CHECK (version > 0),
  prior_publication_id uuid REFERENCES publication(id),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  content_hash char(64) NOT NULL,
  record_hash char(64) NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE (project_id, version),
  UNIQUE (project_id, content_hash)
);
CREATE INDEX publication_project_idx ON publication(project_id, version DESC);

CREATE OR REPLACE FUNCTION prevent_published_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published records are append-only';
END;
$$;
CREATE TRIGGER publication_append_only
BEFORE UPDATE OR DELETE ON publication
FOR EACH ROW EXECUTE FUNCTION prevent_published_mutation();
CREATE TRIGGER history_event_append_only
BEFORE UPDATE OR DELETE ON history_event
FOR EACH ROW EXECUTE FUNCTION prevent_published_mutation();

GRANT USAGE ON SCHEMA public TO tria_app;
GRANT SELECT ON import_batch, project, bm_activity, fiscal_note, financial_relation, evidence_asset, project_evidence, narrative_document TO tria_app;
GRANT SELECT, INSERT, UPDATE ON project_draft TO tria_app;
GRANT SELECT, INSERT ON manual_financial_entry, history_event, publication TO tria_app;
