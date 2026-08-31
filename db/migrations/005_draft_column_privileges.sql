-- Limit draft writes to mutable content fields only.
REVOKE UPDATE ON project_draft FROM tria_app;
GRANT UPDATE (narrative, revision, updated_at) ON project_draft TO tria_app;
