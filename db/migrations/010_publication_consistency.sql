-- Cross-check relational publication metadata against its immutable JSONB snapshot.
ALTER TABLE publication ADD CONSTRAINT publication_snapshot_identity_check CHECK (
  snapshot->>'id' = id::text AND
  snapshot->>'projectId' = project_id AND
  (snapshot->>'version')::integer = version AND
  coalesce(snapshot->>'priorPublicationId', '') = coalesce(prior_publication_id::text, '') AND
  (snapshot->>'createdAt')::timestamptz = created_at AND
  snapshot->>'createdBy' = created_by AND
  snapshot->>'contentHash' = content_hash AND
  snapshot->>'recordHash' = record_hash
);
