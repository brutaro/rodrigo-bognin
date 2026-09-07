-- Valor contratual e recebimentos declarados. Nenhum valor é inferido das notas ou recursos.
CREATE TABLE project_contract_revision (
 project_id text NOT NULL REFERENCES project(id),
 revision bigint NOT NULL CHECK(revision>0),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 200),
 receipts jsonb NOT NULL CHECK(jsonb_typeof(receipts)='array'),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor text NOT NULL DEFAULT 'Rodrigo' CHECK(actor='Rodrigo'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,revision)
);
CREATE VIEW current_project_contract AS
 SELECT DISTINCT ON(project_id) * FROM project_contract_revision ORDER BY project_id,revision DESC;
REVOKE ALL ON project_contract_revision,current_project_contract FROM PUBLIC,tria_app,tria_importer;
GRANT SELECT,INSERT ON project_contract_revision TO tria_app;
GRANT SELECT ON current_project_contract TO tria_app;
