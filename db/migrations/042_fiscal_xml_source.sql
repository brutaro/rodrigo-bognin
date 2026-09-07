ALTER TABLE source_file DROP CONSTRAINT source_file_source_format_check;
ALTER TABLE source_file ADD CONSTRAINT source_file_source_format_check CHECK(source_format IN ('xls','xlsx','csv','pdf','xml'));
ALTER TABLE file_document DROP CONSTRAINT file_document_source_title;
ALTER TABLE file_document ADD CONSTRAINT file_document_source_title CHECK(document_kind <> 'source' OR title IN ('Base consolidada de aplicação de recursos','Nota fiscal em PDF','Nota fiscal em XML'));
