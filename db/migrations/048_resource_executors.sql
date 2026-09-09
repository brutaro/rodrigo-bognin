-- Associações históricas independentes dos valores vigentes de recursos.
CREATE TABLE project_resource_executor (
 project_id text NOT NULL REFERENCES project(id),
 resource_id text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 300),
 import_id uuid NOT NULL REFERENCES resource_import(id),
 PRIMARY KEY(project_id,resource_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON project_resource_executor TO tria_app;
ALTER TABLE resource_import ADD COLUMN executor_recovery jsonb CHECK(executor_recovery IS NULL OR jsonb_typeof(executor_recovery)='array');
