ALTER TABLE manual_financial_entry DROP CONSTRAINT manual_financial_entry_kind_check;
ALTER TABLE manual_financial_entry ADD CONSTRAINT manual_financial_entry_kind_check
 CHECK(kind IN ('Custo ou valor do projeto','Nota ou cobrança','Pagamento','Valor informado','Reembolso'));
