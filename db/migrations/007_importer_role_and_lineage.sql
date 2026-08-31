-- Add explicit source-batch lineage and a non-DDL importer role.
ALTER TABLE financial_relation ADD COLUMN batch_id uuid;
ALTER TABLE evidence_asset ADD COLUMN batch_id uuid;
ALTER TABLE project_evidence ADD COLUMN batch_id uuid;

UPDATE financial_relation SET batch_id = (SELECT id FROM import_batch WHERE source_type = 'financial_relations' LIMIT 1);
UPDATE evidence_asset SET batch_id = (SELECT id FROM import_batch WHERE source_type = 'project_evidence' LIMIT 1);
UPDATE project_evidence SET batch_id = (SELECT id FROM import_batch WHERE source_type = 'project_evidence' LIMIT 1);

ALTER TABLE financial_relation ALTER COLUMN batch_id SET NOT NULL;
ALTER TABLE evidence_asset ALTER COLUMN batch_id SET NOT NULL;
ALTER TABLE project_evidence ALTER COLUMN batch_id SET NOT NULL;
ALTER TABLE financial_relation ADD CONSTRAINT financial_relation_batch_fk FOREIGN KEY (batch_id) REFERENCES import_batch(id);
ALTER TABLE evidence_asset ADD CONSTRAINT evidence_asset_batch_fk FOREIGN KEY (batch_id) REFERENCES import_batch(id);
ALTER TABLE project_evidence ADD CONSTRAINT project_evidence_batch_fk FOREIGN KEY (batch_id) REFERENCES import_batch(id);

GRANT USAGE ON SCHEMA public TO tria_importer;
GRANT SELECT, INSERT ON import_batch, project, bm_activity, fiscal_note, financial_relation,
  evidence_asset, project_evidence, project_draft TO tria_importer;
GRANT UPDATE (date_start, date_end, bm_count, activity_count, hours_total, value_total) ON project TO tria_importer;
