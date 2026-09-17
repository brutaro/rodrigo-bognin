import type {ManualFinancialEntry} from './demo-workspace';
export type FiscalPaymentDeclaration={revision:string;status:'confirmado'|'revertido';amountCents:string;projectId:string|null;paidOn:string|null;paymentEntryId:string|null;separatePayment:boolean;noteRevision:string;number:string;issueDate:string;reason:string;actor:string;createdAt:string};
export type InvoiceCashRow={id:string;number:string;issueDate:string;amountCents:string;projectId:string|null;projectTitle:string|null;noteRevision:string;deleted:boolean;declaration:FiscalPaymentDeclaration|null};
export type ExistingPayment={id:string;projectId:string;description:string;amountCents:string;paidOn:string|null;confirmed:boolean};
export function invoicePaymentEntry(note:InvoiceCashRow,payments:ExistingPayment[]=[]):ManualFinancialEntry|null {
 const value=note.declaration;
 if(value?.status!=='confirmado'||value.paymentEntryId)return null;
 if(!value.separatePayment&&payments.some(p=>p.amountCents===value.amountCents))return null;
 return {id:`nf:${note.id}`,fiscalNoteId:note.id,kind:'Pagamento',description:`NF ${value.number} · pagamento confirmado por ${value.actor}. ${value.reason}`,
  amountCents:value.amountCents,origin:'Informado por Rodrigo',documentState:'Sem arquivo associado',createdAt:value.createdAt,
  confirmation:{status:'confirmado',effectiveOn:value.paidOn,costEntryId:null,revision:value.revision}};
}
export function invoicePaymentIssues(note:InvoiceCashRow,payments:ExistingPayment[]) {
 const d=note.declaration;if(d?.status!=='confirmado')return [];
 const issues:string[]=[];
 if(invoiceChangedAfterPayment(note))issues.push(`NF ${d.number}: dados fiscais alterados ou nota excluída após a declaração. Confira o vínculo; o pagamento histórico foi preservado.`);
 if(d.paymentEntryId){
  const linked=payments.find(p=>p.id===d.paymentEntryId);
  if(!linked?.confirmed||linked.projectId!==d.projectId||linked.amountCents!==d.amountCents||linked.paidOn!==d.paidOn)issues.push(`NF ${d.number}: o pagamento vinculado mudou. Confira a conciliação.`);
 }else if(!d.separatePayment&&payments.some(p=>p.amountCents===d.amountCents))issues.push(`NF ${d.number}: pagamento do mesmo valor precisa de conciliação. A nota não foi somada novamente.`);
 return issues;
}
export function invoiceChangedAfterPayment(note:InvoiceCashRow) {
 const d=note.declaration;
 return d?.status==='confirmado' && (note.deleted||d.noteRevision!==note.noteRevision||d.amountCents!==note.amountCents);
}
export function possibleExistingPayments(note:InvoiceCashRow,payments:ExistingPayment[]) {
 return payments.filter(payment=>BigInt(payment.amountCents)===BigInt(note.amountCents));
}
export function invoiceCashTotals(notes:InvoiceCashRow[]) {
 const confirmed=notes.filter(n=>n.declaration?.status==='confirmado');
 return {count:confirmed.length,totalCents:confirmed.reduce((sum,n)=>sum+BigInt(n.declaration!.amountCents),0n).toString(),
  undated:confirmed.filter(n=>!n.declaration!.paidOn).length,unassigned:confirmed.filter(n=>!n.declaration!.projectId).length,
  changed:confirmed.filter(invoiceChangedAfterPayment).length};
}
