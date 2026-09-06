-- Classificação explícita, sem reinterpretar os lançamentos antigos.
CREATE TABLE reimbursement_status_history (
 entry_id uuid NOT NULL REFERENCES manual_financial_entry(id),
 revision bigint NOT NULL CHECK (revision > 0),
 status text NOT NULL CHECK (status IN ('nao_informado','sinalizado_pendente','recebido_confirmado')),
 received_on date,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
 actor text NOT NULL DEFAULT 'Rodrigo',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entry_id,revision),
 CHECK ((status = 'recebido_confirmado') = (received_on IS NOT NULL))
);
CREATE FUNCTION validate_reimbursement_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM manual_financial_entry WHERE id=NEW.entry_id AND kind='Reembolso') THEN
  RAISE EXCEPTION 'Escolha um lançamento de reembolso.';
 END IF;
 IF NEW.received_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
  RAISE EXCEPTION 'O recebimento não pode ter data futura.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reimbursement_status_valid BEFORE INSERT ON reimbursement_status_history FOR EACH ROW EXECUTE FUNCTION validate_reimbursement_status();
CREATE VIEW current_reimbursement_status AS
 SELECT DISTINCT ON(entry_id) entry_id,revision,status,received_on,reason,actor,created_at
 FROM reimbursement_status_history ORDER BY entry_id,revision DESC;
GRANT SELECT,INSERT ON reimbursement_status_history TO tria_app;
GRANT SELECT ON current_reimbursement_status TO tria_app;
