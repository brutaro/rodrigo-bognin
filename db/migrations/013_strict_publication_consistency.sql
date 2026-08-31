-- Reject missing or mistyped identity fields; CHECK must evaluate to TRUE, never NULL.
ALTER TABLE publication DROP CONSTRAINT publication_snapshot_identity_check;
ALTER TABLE publication ADD CONSTRAINT publication_snapshot_identity_check CHECK ((
  snapshot ?& ARRAY['id','projectId','version','priorPublicationId','createdAt','createdBy','contentHash','recordHash'] AND
  jsonb_typeof(snapshot->'id') = 'string' AND
  jsonb_typeof(snapshot->'projectId') = 'string' AND
  jsonb_typeof(snapshot->'version') = 'number' AND
  jsonb_typeof(snapshot->'createdAt') = 'string' AND
  jsonb_typeof(snapshot->'createdBy') = 'string' AND
  jsonb_typeof(snapshot->'contentHash') = 'string' AND
  jsonb_typeof(snapshot->'recordHash') = 'string' AND
  snapshot->>'id' = id::text AND
  snapshot->>'projectId' = project_id AND
  (snapshot->>'version')::integer = version AND
  coalesce(snapshot->>'priorPublicationId', '') = coalesce(prior_publication_id::text, '') AND
  (snapshot->>'createdAt')::timestamptz = created_at AND
  snapshot->>'createdBy' = created_by AND
  snapshot->>'contentHash' = content_hash AND
  snapshot->>'recordHash' = record_hash
) IS TRUE);
