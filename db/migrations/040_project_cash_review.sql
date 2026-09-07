-- Confirmações explícitas; os valores e as fontes existentes continuam imutáveis.
ALTER TABLE reimbursement_status_history DROP CONSTRAINT reimbursement_status_history_status_check;
ALTER TABLE reimbursement_status_history ADD CONSTRAINT reimbursement_status_history_status_check
 CHECK(status IN ('nao_informado','sinalizado_pendente','recebido_confirmado','revertido'));

CREATE TABLE cost_confirmation_history (
 entry_id uuid NOT NULL REFERENCES manual_financial_entry(id),
 revision bigint NOT NULL CHECK(revision > 0),
 status text NOT NULL CHECK(status IN ('nao_informado','confirmado','revertido')),
 effective_on date,
 cost_entry_id uuid REFERENCES manual_financial_entry(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor text NOT NULL DEFAULT 'Rodrigo',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entry_id,revision),
 CHECK((status='confirmado') = (effective_on IS NOT NULL)),
 CHECK(status='confirmado' OR cost_entry_id IS NULL)
);
CREATE VIEW current_cost_confirmation AS
 SELECT DISTINCT ON(entry_id) * FROM cost_confirmation_history ORDER BY entry_id,revision DESC;
CREATE FUNCTION validate_cost_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry manual_financial_entry;
BEGIN
 SELECT * INTO entry FROM manual_financial_entry WHERE id=NEW.entry_id;
 IF entry.kind IS NULL OR entry.kind NOT IN ('Custo ou valor do projeto','Pagamento') THEN
  RAISE EXCEPTION 'Escolha um lançamento de custo ou pagamento.';
 END IF;
 IF NEW.effective_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
  RAISE EXCEPTION 'A confirmação não pode ter data futura.';
 END IF;
 IF NEW.cost_entry_id IS NOT NULL AND (entry.kind <> 'Pagamento' OR NOT EXISTS (
  SELECT 1 FROM manual_financial_entry WHERE id=NEW.cost_entry_id AND project_id=entry.project_id AND kind='Custo ou valor do projeto'
 )) THEN RAISE EXCEPTION 'Escolha um custo deste projeto para o pagamento.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_confirmation_valid BEFORE INSERT ON cost_confirmation_history FOR EACH ROW EXECUTE FUNCTION validate_cost_confirmation();

CREATE TABLE project_cash_review_history (
 project_id text NOT NULL REFERENCES project(id),
 revision bigint NOT NULL CHECK(revision > 0),
 basis_hash text NOT NULL CHECK(basis_hash ~ '^[0-9a-f]{64}$'),
 cutoff_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
 costs text NOT NULL CHECK(costs IN ('nao_conferido','completo','sem_movimento')),
 payments text NOT NULL CHECK(payments IN ('nao_conferido','completo','sem_movimento')),
 reimbursements text NOT NULL CHECK(reimbursements IN ('nao_conferido','completo','sem_movimento')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor text NOT NULL DEFAULT 'Rodrigo',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,revision)
);
CREATE VIEW current_project_cash_review AS
 SELECT DISTINCT ON(project_id) * FROM project_cash_review_history ORDER BY project_id,revision DESC;
GRANT SELECT,INSERT ON cost_confirmation_history,project_cash_review_history TO tria_app;
GRANT SELECT ON current_cost_confirmation,current_project_cash_review TO tria_app;
