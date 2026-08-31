-- Remove raw local paths from the persisted MVP data.
UPDATE import_batch
SET relative_path = CASE source_type
  WHEN 'bm_activities' THEN 'source://bm-activities/complete-v1'
  WHEN 'fiscal_notes' THEN 'source://fiscal-notes/truth-v1'
  WHEN 'financial_relations' THEN 'source://financial-relations/audited-v1'
  WHEN 'project_evidence' THEN 'source://project-evidence/crosswalk-v1'
  ELSE 'source://local/opaque'
END;

UPDATE evidence_asset SET private_path = 'sha256://' || sha256;
DELETE FROM narrative_document;
