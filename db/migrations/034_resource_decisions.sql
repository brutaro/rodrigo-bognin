ALTER TABLE resource_import ADD COLUMN resolved_from uuid REFERENCES resource_import(id);
ALTER TABLE resource_import ADD COLUMN decisions jsonb NOT NULL DEFAULT '{}'::jsonb;
GRANT SELECT(resolved_from,decisions), INSERT(resolved_from,decisions) ON resource_import TO tria_app;
