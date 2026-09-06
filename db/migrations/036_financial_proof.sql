CREATE TABLE financial_entry_proof (
 entry_id uuid PRIMARY KEY REFERENCES manual_financial_entry(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES file_version(id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, DELETE ON financial_entry_proof TO tria_app;
GRANT UPDATE(file_version_id) ON financial_entry_proof TO tria_app;
CREATE FUNCTION validate_financial_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM manual_financial_entry m JOIN file_document d ON d.project_id=m.project_id
   JOIN file_version v ON v.document_id=d.id WHERE m.id=NEW.entry_id AND v.id=NEW.file_version_id
   AND d.document_kind='project' AND d.status='active' AND v.status='active') THEN
  RAISE EXCEPTION 'O comprovante precisa ser um arquivo ativo deste projeto.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_proof_valid BEFORE INSERT OR UPDATE ON financial_entry_proof FOR EACH ROW EXECUTE FUNCTION validate_financial_proof();
