-- Reuse the owner vault catalog for one canonical physical version per evidence asset.
ALTER TABLE file_document ADD COLUMN document_kind text NOT NULL DEFAULT 'project'
  CHECK (document_kind IN ('project', 'evidence'));
ALTER TABLE file_document ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE file_document ADD CONSTRAINT file_document_owner_shape CHECK (
  (document_kind = 'project' AND project_id IS NOT NULL) OR
  (document_kind = 'evidence' AND project_id IS NULL AND include_in_publication = false)
);

ALTER TABLE file_version ADD COLUMN evidence_asset_id char(64);
ALTER TABLE file_version ADD CONSTRAINT file_version_evidence_asset_fk
  FOREIGN KEY (evidence_asset_id) REFERENCES evidence_asset(id);
ALTER TABLE file_version ADD CONSTRAINT file_version_evidence_asset_unique UNIQUE (evidence_asset_id);
ALTER TABLE file_version ADD CONSTRAINT file_version_evidence_shape
  CHECK (evidence_asset_id IS NULL OR (version = 1 AND sha256 = evidence_asset_id));
CREATE INDEX file_version_evidence_idx ON file_version (evidence_asset_id)
  WHERE evidence_asset_id IS NOT NULL;

-- Keep the web role unable to claim canonical evidence columns.
REVOKE INSERT ON file_document, file_version FROM tria_app;
GRANT INSERT (id, project_id, title, status, created_at, updated_at, include_in_publication)
  ON file_document TO tria_app;
GRANT INSERT (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
  ON file_version TO tria_app;
