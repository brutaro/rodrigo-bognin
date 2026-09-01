-- Revogação individual da sessão; o código permanente continua independente.
CREATE TABLE owner_session (
  id_hash char(64) PRIMARY KEY CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX owner_session_expiry_idx ON owner_session(expires_at);
GRANT SELECT, INSERT, DELETE ON owner_session TO tria_app;
GRANT UPDATE (revoked_at) ON owner_session TO tria_app;
