import {expect,it} from 'vitest';
import {invoicePaymentEntry,invoicePaymentIssues,invoiceCashTotals,type InvoiceCashRow,type ExistingPayment} from './fiscal-payment-domain';
import {calculateCash,aggregateCash} from './cash-domain';
const note:InvoiceCashRow={id:'synthetic-note',number:'SYN-100',issueDate:'2025-01-01',amountCents:'15000',projectId:'A',projectTitle:'Projeto sintético',noteRevision:'0',deleted:false,declaration:{revision:'1',status:'confirmado',amountCents:'15000',projectId:'A',paidOn:null,paymentEntryId:null,separatePayment:false,noteRevision:'0',number:'SYN-100',issueDate:'2025-01-01',reason:'Confirmado pelo proprietário',actor:'Rodrigo',createdAt:'2026-09-17T00:00:00Z'}};
const payment:ExistingPayment={id:'payment',projectId:'A',description:'Pagamento existente',amountCents:'15000',paidOn:'2025-01-03',confirmed:true};
it('registra pagamento por declaração sem usar emissão como data do pagamento',()=>{
 const entry=invoicePaymentEntry(note)!;expect(entry.confirmation?.effectiveOn).toBeNull();expect(entry.amountCents).toBe('15000');expect(entry.fiscalNoteId).toBe(note.id);
 const result=calculateCash([entry],null,'basis');expect(result.paidCents).toBe('15000');expect(result.resultCents).toBeNull();expect(result.issues.join(' ')).toContain('sem data');
});
it('não transforma nota sem declaração ou declaração revertida em pagamento',()=>{
 expect(invoicePaymentEntry({...note,declaration:null})).toBeNull();expect(invoicePaymentEntry({...note,declaration:{...note.declaration!,status:'revertido'}})).toBeNull();
});
it('não conta novamente um pagamento já vinculado',()=>{
 const linked={...note,declaration:{...note.declaration!,paymentEntryId:payment.id,paidOn:payment.paidOn}};
 expect(invoicePaymentEntry(linked,[payment])).toBeNull();expect(invoicePaymentIssues(linked,[payment])).toEqual([]);
 expect(invoicePaymentIssues(linked,[{...payment,confirmed:false}]).join(' ')).toContain('mudou');
});
it('interrompe dupla contagem se surgir pagamento manual equivalente',()=>{
 expect(invoicePaymentEntry(note,[payment])).toBeNull();expect(invoicePaymentIssues(note,[payment]).join(' ')).toContain('não foi somada novamente');
 const distinct={...note,declaration:{...note.declaration!,separatePayment:true}};
 expect(invoicePaymentEntry(distinct,[payment])?.amountCents).toBe('15000');
});
it('alteração fiscal ou exclusão não apaga nem recalcula pagamento histórico',()=>{
 for(const changed of [{...note,amountCents:'90000',noteRevision:'2'},{...note,deleted:true}]){
  expect(invoicePaymentEntry(changed)?.amountCents).toBe('15000');expect(invoicePaymentIssues(changed,[])).toHaveLength(1);
 }
});
it('mantém total conhecido no portfólio sem declarar cobertura completa',()=>{
 const paid=calculateCash([invoicePaymentEntry(note)!],null,'nf'),unknown=calculateCash([],null,'unknown');
 expect(aggregateCash([paid,unknown])).toMatchObject({paidCents:'15000',receivedCents:null,resultCents:null});
});
it('totaliza declarações com precisão e explicita lacunas',()=>{
 expect(invoiceCashTotals([note,{...note,id:'second',declaration:{...note.declaration!,amountCents:'900719925474099301',projectId:null}}])).toMatchObject({count:2,totalCents:'900719925474114301',undated:2,unassigned:1});
});
