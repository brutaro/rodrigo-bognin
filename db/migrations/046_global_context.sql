ALTER TABLE file_document DROP CONSTRAINT file_document_document_kind_check;
ALTER TABLE file_document ADD CONSTRAINT file_document_document_kind_check CHECK(document_kind IN ('project','evidence','source','context'));
ALTER TABLE file_document DROP CONSTRAINT file_document_owner_shape;
ALTER TABLE file_document ADD CONSTRAINT file_document_owner_shape CHECK (
 (document_kind='project' AND project_id IS NOT NULL) OR
 (document_kind IN ('evidence','source','context') AND project_id IS NULL AND include_in_publication=false)
);
-- Contexto tem auditoria global; operações de projeto continuam exigindo projeto.
ALTER TABLE file_operation_event DROP CONSTRAINT file_operation_event_check;
ALTER TABLE file_operation_event ADD CONSTRAINT file_operation_event_check
 CHECK(project_id IS NOT NULL OR operation IN ('backup_prepared','download','upload_version'));
