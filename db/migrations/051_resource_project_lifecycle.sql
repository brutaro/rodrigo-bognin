-- Planejamento explícito de criação/arquivamento, aplicado junto da carga confirmada.
ALTER TABLE resource_import ADD COLUMN project_plan jsonb CHECK(project_plan IS NULL OR jsonb_typeof(project_plan)='object');
