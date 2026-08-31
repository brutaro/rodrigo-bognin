-- A real local database must not accept a demonstrative origin label.
ALTER TABLE manual_financial_entry DROP CONSTRAINT manual_financial_entry_origin_check;
ALTER TABLE manual_financial_entry ADD CONSTRAINT manual_financial_entry_origin_check CHECK (origin = 'Informado por Rodrigo');
