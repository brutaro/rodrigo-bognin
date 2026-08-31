-- Bind each imported record to a batch of the correct source type.
ALTER TABLE import_batch ADD CONSTRAINT import_batch_id_source_type_key UNIQUE (id, source_type);

ALTER TABLE financial_relation ADD COLUMN batch_source_type text NOT NULL DEFAULT 'financial_relations' CHECK (batch_source_type = 'financial_relations');
ALTER TABLE evidence_asset ADD COLUMN batch_source_type text NOT NULL DEFAULT 'project_evidence' CHECK (batch_source_type = 'project_evidence');
ALTER TABLE project_evidence ADD COLUMN batch_source_type text NOT NULL DEFAULT 'project_evidence' CHECK (batch_source_type = 'project_evidence');

ALTER TABLE financial_relation ADD CONSTRAINT financial_relation_typed_batch_fk FOREIGN KEY (batch_id, batch_source_type) REFERENCES import_batch(id, source_type);
ALTER TABLE evidence_asset ADD CONSTRAINT evidence_asset_typed_batch_fk FOREIGN KEY (batch_id, batch_source_type) REFERENCES import_batch(id, source_type);
ALTER TABLE project_evidence ADD CONSTRAINT project_evidence_typed_batch_fk FOREIGN KEY (batch_id, batch_source_type) REFERENCES import_batch(id, source_type);
