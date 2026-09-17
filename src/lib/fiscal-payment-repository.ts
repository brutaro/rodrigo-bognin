import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {getSql} from './database';
import {possibleExistingPayments,type InvoiceCashRow,type ExistingPayment} from './fiscal-payment-domain';
export class FiscalPaymentError extends Error {}
type Query=Sql|TransactionSql;
export async function readInvoiceCash(tx:Query=getSql()) {
 const notes=await tx<InvoiceCashRow[]>`SELECT n.id,coalesce(e.note_number,d.note_number,n.note_number) number,
  coalesce(e.issue_date,d.issue_date,n.issue_date)::text "issueDate",round(coalesce(e.amount,n.amount)*100)::text "amountCents",
  e.declared_project_id "projectId",p.title "projectTitle",coalesce(e.adjustment_revision,0)::text "noteRevision",e.id IS NULL deleted,
  CASE WHEN d.fiscal_note_id IS NULL THEN NULL ELSE jsonb_build_object('revision',d.revision::text,'status',d.status,
   'amountCents',d.amount_cents::text,'projectId',d.project_id,'paidOn',d.paid_on::text,'paymentEntryId',d.payment_entry_id::text,
   'separatePayment',d.separate_payment,'noteRevision',d.note_revision::text,'number',d.note_number,'issueDate',d.issue_date::text,'reason',d.reason,'actor',d.actor,'createdAt',d.created_at::text) END declaration
  FROM fiscal_note n LEFT JOIN effective_fiscal_note e ON e.id=n.id
  LEFT JOIN current_fiscal_payment_declaration d ON d.fiscal_note_id=n.id
  LEFT JOIN project p ON p.id=e.declared_project_id
  WHERE e.id IS NOT NULL OR d.fiscal_note_id IS NOT NULL ORDER BY n.id`;
 const payments=await tx<ExistingPayment[]>`SELECT m.id::text,m.project_id "projectId",m.description,m.amount_cents::text "amountCents",
  c.effective_on::text "paidOn",coalesce(c.status='confirmado',false) confirmed
  FROM manual_financial_entry m LEFT JOIN current_cost_confirmation c ON c.entry_id=m.id WHERE m.kind='Pagamento' ORDER BY m.id`;
 const basisHash=createHash('sha256').update(JSON.stringify({notes,payments})).digest('hex');
 return {notes,payments,basisHash};
}
export type FiscalPaymentInput={id:string;revision:string;status:'confirmado'|'revertido';projectId:string|null;paidOn:string|null;paymentEntryId:string|null;separatePayment:boolean;reason:string};
async function lock(tx:TransactionSql) {
 await tx`SELECT pg_advisory_xact_lock(23003)`;
 // Manual entries use these same project locks. Recheck the snapshot afterwards.
 const projects=await tx`SELECT id FROM project ORDER BY id`;
 for(const p of projects)await tx`SELECT pg_advisory_xact_lock(hashtext(${p.id}))`;
}
async function writeDeclaration(tx:TransactionSql,note:InvoiceCashRow,input:FiscalPaymentInput,payments:ExistingPayment[],notes:InvoiceCashRow[]) {
 if((note.declaration?.revision??'0')!==input.revision)throw new FiscalPaymentError('A confirmação mudou. Recarregue a página.');
 if(note.deleted&&input.status==='confirmado')throw new FiscalPaymentError('Esta nota foi excluída. Somente a reversão da confirmação está disponível.');
 if(input.paidOn){
  const [today]=await tx`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text date`;
  if(input.paidOn>today.date)throw new FiscalPaymentError('A data do pagamento não pode ser futura.');
 }
 if(input.projectId){const [project]=await tx`SELECT id FROM project WHERE id=${input.projectId}`;if(!project)throw new FiscalPaymentError('Projeto não encontrado.');}
 if(input.status==='confirmado'&&input.paymentEntryId){
  const payment=payments.find(p=>p.id===input.paymentEntryId);
  if(!payment?.confirmed||payment.projectId!==input.projectId||BigInt(payment.amountCents)!==BigInt(note.amountCents)||payment.paidOn!==input.paidOn)throw new FiscalPaymentError('O pagamento vinculado precisa estar confirmado, com o mesmo projeto, valor e data.');
  if(notes.some(n=>n.id!==note.id&&n.declaration?.status==='confirmado'&&n.declaration.paymentEntryId===input.paymentEntryId))throw new FiscalPaymentError('Esse pagamento já está vinculado a outra nota.');
 }else if(input.status==='confirmado'&&!input.separatePayment&&possibleExistingPayments(note,payments).length){
  throw new FiscalPaymentError('Existe pagamento com o mesmo valor. Vincule o lançamento ou declare explicitamente que são pagamentos distintos.');
 }
 const prior=note.declaration;
 const amount=input.status==='revertido'&&prior?prior.amountCents:note.amountCents;
 await tx`INSERT INTO fiscal_payment_declaration(fiscal_note_id,revision,status,amount_cents,project_id,paid_on,payment_entry_id,separate_payment,note_revision,note_number,issue_date,reason)
  VALUES(${note.id},${(BigInt(input.revision)+1n).toString()},${input.status},${amount},${input.projectId},${input.paidOn},${input.paymentEntryId},${input.separatePayment},${note.noteRevision},${note.number},${note.issueDate},${input.reason})`;
 for(const id of new Set([prior?.projectId,input.projectId].filter((id):id is string=>Boolean(id)))){
  await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=${id}`;
  await tx`INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at) VALUES(${randomUUID()},${id},'Pagamento de nota fiscal atualizado',${`NF ${note.number}: ${input.status}. ${input.reason}`},'Rodrigo',now())`;
 }
}
export async function saveInvoicePayment(input:FiscalPaymentInput) {
 return getSql().begin(async tx=>{await lock(tx);const data=await readInvoiceCash(tx);const note=data.notes.find(n=>n.id===input.id);
  if(!note)throw new FiscalPaymentError('Nota não encontrada.');await writeDeclaration(tx,note,input,data.payments,data.notes);
 });
}
export async function confirmInvoicePayments(basisHash:string,reason:string) {
 return getSql().begin(async tx=>{
  await lock(tx);const data=await readInvoiceCash(tx);
  if(data.basisHash!==basisHash)throw new FiscalPaymentError('As notas ou pagamentos mudaram. Recarregue e confira a lista.');
  let confirmed=0,skipped=0;
  for(const note of data.notes){
   if(note.deleted||note.declaration)continue;
   if(possibleExistingPayments(note,data.payments).length){skipped++;continue;}
   await writeDeclaration(tx,note,{id:note.id,revision:'0',status:'confirmado',projectId:note.projectId,paidOn:null,paymentEntryId:null,separatePayment:false,reason},data.payments,data.notes);confirmed++;
  }
  return {confirmed,skipped};
 });
}
