-- Executors are read exclusively from the current resource rows.
DROP TABLE project_resource_executor;
ALTER TABLE resource_import DROP COLUMN executor_recovery;
