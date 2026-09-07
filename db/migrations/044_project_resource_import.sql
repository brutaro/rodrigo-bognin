-- A prévia continua guardando a base integral; o escopo identifica o projeto alterado.
ALTER TABLE resource_import
  ADD COLUMN scope_project_id text REFERENCES project(id),
  ADD COLUMN scope_project_title text,
  ADD CONSTRAINT resource_import_scope_pair CHECK ((scope_project_id IS NULL) = (scope_project_title IS NULL));
