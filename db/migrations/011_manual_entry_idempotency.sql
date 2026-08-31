-- Deduplicate retried financial-entry submissions.
ALTER TABLE manual_financial_entry ADD COLUMN request_id uuid;
UPDATE manual_financial_entry SET request_id = id WHERE request_id IS NULL;
ALTER TABLE manual_financial_entry ALTER COLUMN request_id SET NOT NULL;
ALTER TABLE manual_financial_entry ADD CONSTRAINT manual_financial_entry_request_id_key UNIQUE (request_id);
GRANT SELECT (request_id) ON manual_financial_entry TO tria_app;
GRANT INSERT (request_id) ON manual_financial_entry TO tria_app;
