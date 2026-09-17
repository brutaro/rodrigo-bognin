-- A payment declaration records what the owner confirmed. It never changes
-- the invoice, invents a payment date, or treats a candidate project as final.
CREATE TABLE fiscal_payment_declaration (
 fiscal_note_id text NOT NULL REFERENCES fiscal_note(id),
 revision bigint NOT NULL CHECK(revision>0),
 status text NOT NULL CHECK(status IN ('confirmado','revertido')),
 amount_cents numeric(24,0) NOT NULL CHECK(amount_cents>=0),
 project_id text REFERENCES project(id),
 paid_on date,
 payment_entry_id uuid REFERENCES manual_financial_entry(id),
 separate_payment boolean NOT NULL DEFAULT false,
 note_revision bigint NOT NULL CHECK(note_revision>=0),
 note_number text NOT NULL,
 issue_date date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 actor text NOT NULL DEFAULT 'Rodrigo' CHECK(actor='Rodrigo'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(fiscal_note_id,revision)
);
CREATE VIEW current_fiscal_payment_declaration AS
 SELECT DISTINCT ON(fiscal_note_id) * FROM fiscal_payment_declaration
 ORDER BY fiscal_note_id,revision DESC;
REVOKE ALL ON fiscal_payment_declaration,current_fiscal_payment_declaration FROM PUBLIC,tria_app,tria_importer;
GRANT SELECT,INSERT ON fiscal_payment_declaration TO tria_app;
GRANT SELECT ON current_fiscal_payment_declaration TO tria_app;

CREATE FUNCTION validate_fiscal_payment_declaration() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE note effective_fiscal_note%ROWTYPE; payment manual_financial_entry%ROWTYPE;
 confirmation current_cost_confirmation%ROWTYPE; prior bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(23003);
 SELECT coalesce(max(revision),0) INTO prior FROM fiscal_payment_declaration WHERE fiscal_note_id=NEW.fiscal_note_id;
 IF NEW.revision<>prior+1 THEN RAISE EXCEPTION 'Revisão de pagamento obsoleta.'; END IF;
 IF NEW.paid_on>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Data de pagamento futura.'; END IF;
 IF NEW.status='confirmado' THEN
  SELECT * INTO note FROM effective_fiscal_note WHERE id=NEW.fiscal_note_id;
  IF note.id IS NULL OR note.adjustment_revision<>NEW.note_revision OR round(note.amount*100)<>NEW.amount_cents
   OR note.note_number<>NEW.note_number OR note.issue_date<>NEW.issue_date THEN RAISE EXCEPTION 'A nota mudou. Confira a declaração.'; END IF;
  IF NEW.payment_entry_id IS NOT NULL THEN
   SELECT * INTO payment FROM manual_financial_entry WHERE id=NEW.payment_entry_id;
   SELECT * INTO confirmation FROM current_cost_confirmation WHERE entry_id=NEW.payment_entry_id;
   IF payment.kind IS DISTINCT FROM 'Pagamento' OR payment.project_id IS DISTINCT FROM NEW.project_id
    OR payment.amount_cents IS DISTINCT FROM NEW.amount_cents OR confirmation.status IS DISTINCT FROM 'confirmado'
    OR confirmation.effective_on IS DISTINCT FROM NEW.paid_on THEN RAISE EXCEPTION 'Pagamento vinculado incompatível.'; END IF;
   IF EXISTS(SELECT 1 FROM current_fiscal_payment_declaration WHERE fiscal_note_id<>NEW.fiscal_note_id
    AND status='confirmado' AND payment_entry_id=NEW.payment_entry_id) THEN RAISE EXCEPTION 'Pagamento já vinculado a outra nota.'; END IF;
  ELSIF NOT NEW.separate_payment AND EXISTS(SELECT 1 FROM manual_financial_entry WHERE kind='Pagamento' AND amount_cents=NEW.amount_cents) THEN
   RAISE EXCEPTION 'Confira o pagamento existente do mesmo valor.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION validate_fiscal_payment_declaration() FROM PUBLIC;
CREATE TRIGGER fiscal_payment_declaration_valid BEFORE INSERT ON fiscal_payment_declaration FOR EACH ROW EXECUTE FUNCTION validate_fiscal_payment_declaration();
