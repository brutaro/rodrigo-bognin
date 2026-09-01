-- Cofre pessoal autenticado, quota exata e catálogo de arquivos versionados.
CREATE TABLE auth_login_throttle (
  client_hash char(64) PRIMARY KEY CHECK (client_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file_store_counter (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  quota_bytes bigint NOT NULL CHECK (quota_bytes = 9000000000),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  CHECK (used_bytes + reserved_bytes <= quota_bytes)
);
INSERT INTO file_store_counter (singleton, quota_bytes) VALUES (true, 9000000000);

CREATE TABLE file_reservation (
  id uuid PRIMARY KEY,
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes > 0),
  object_key uuid UNIQUE,
  status text NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX file_reservation_reconcile_idx ON file_reservation(status, expires_at);

CREATE TABLE file_document (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'purging')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX file_document_project_idx ON file_document(project_id, created_at DESC);

CREATE TABLE file_version (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES file_document(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  object_key uuid NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  media_type text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 200),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'purging')),
  created_at timestamptz NOT NULL,
  UNIQUE (document_id, version)
);
CREATE INDEX file_version_document_idx ON file_version(document_id, version DESC);

CREATE TABLE publication_file (
  publication_id uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
  file_version_id uuid NOT NULL REFERENCES file_version(id) ON DELETE RESTRICT,
  PRIMARY KEY (publication_id, file_version_id)
);
CREATE INDEX publication_file_version_idx ON publication_file(file_version_id);

-- Publicações continuam imutáveis, exceto durante o expurgo explícito e auditado.
CREATE OR REPLACE FUNCTION prevent_published_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'publication' AND TG_OP = 'DELETE' AND current_setting('tria.purge_authorized', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published records are append-only';
END;
$$;

REVOKE ALL PRIVILEGES ON auth_login_throttle, file_store_counter, file_reservation,
  file_document, file_version, publication_file FROM tria_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_login_throttle TO tria_app;
GRANT SELECT ON file_store_counter TO tria_app;
GRANT UPDATE (used_bytes, reserved_bytes) ON file_store_counter TO tria_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_reservation TO tria_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_document, file_version TO tria_app;
GRANT SELECT, INSERT, DELETE ON publication_file TO tria_app;
GRANT DELETE ON publication TO tria_app;
