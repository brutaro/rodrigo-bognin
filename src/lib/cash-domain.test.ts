import { describe,it,expect } from 'vitest';
import { calculateCash, aggregateCash, cashMoney, type CashEntry, type CashReview } from './cash-domain';
const review:CashReview={revision:'1',basisHash:'basis',cutoffDate:'2026-09-05',costs:'completo',payments:'completo',reimbursements:'completo',reason:'Conferido com fontes',actor:'Rodrigo',createdAt:'2026-09-05T12:00:00Z'};
function entries():CashEntry[]{return [
 {id:'cost',kind:'Custo ou valor do projeto',amountCents:'20000',confirmation:{status:'confirmado',effectiveOn:'2026-09-01',costEntryId:null,revision:'1'}},
 {id:'paid',kind:'Pagamento',amountCents:'10000',confirmation:{status:'confirmado',effectiveOn:'2026-09-02',costEntryId:'cost',revision:'1'}},
 {id:'refund',kind:'Reembolso',amountCents:'6000',reimbursement:{status:'recebido_confirmado',receivedOn:'2026-09-03',revision:'1'}},
 {id:'pending',kind:'Reembolso',amountCents:'4000',reimbursement:{status:'sinalizado_pendente',receivedOn:null,revision:'1'}},
];}
describe('caixa explícito do projeto',()=>{
 it('calcula déficit, cobertura e custo ainda a pagar sem somar o reembolso pendente',()=>{
  const r=calculateCash(entries(),review,'basis');expect(r).toMatchObject({incurredCents:'20000',paidCents:'10000',receivedCents:'6000',pendingCents:'4000',outstandingCents:'10000',resultCents:'-4000',coveragePercent:'60,00%',issues:[]});expect(cashMoney(r.resultCents)).toBe('−R$ 40,00');
 });
 it('mantém desconhecido diferente de zero e invalida conferência após alterações',()=>{
  const unknown=calculateCash([{id:'legacy',kind:'Pagamento',amountCents:'10000'}],null,'basis');expect(unknown.paidCents).toBeNull();expect(unknown.resultCents).toBeNull();
  expect(calculateCash(entries(),review,'changed').resultCents).toBeNull();
  const unset=entries();delete unset[2].reimbursement;expect(calculateCash(unset,review,'basis').resultCents).toBeNull();
 });
 it('aceita ausência de recebimento declarada com aprovado pendente e não inventa divisão por zero',()=>{
  const data=entries().filter(e=>e.id!=='refund');const r=calculateCash(data,{...review,reimbursements:'sem_movimento'},'basis');expect(r.resultCents).toBe('-10000');expect(r.receivedCents).toBe('0');expect(r.pendingCents).toBe('4000');
  const zero=calculateCash([],{...review,costs:'sem_movimento',payments:'sem_movimento',reimbursements:'sem_movimento'},'basis');expect(zero.resultCents).toBe('0');expect(zero.coveragePercent).toBeNull();expect(zero.outstandingCents).toBe('0');
 });
 it('não aceita zero declarado contradizendo confirmações ou registros sem situação',()=>{
  expect(calculateCash(entries(),{...review,reimbursements:'sem_movimento'},'basis').resultCents).toBeNull();
  expect(calculateCash([{id:'legacy',kind:'Reembolso',amountCents:'0'}],{...review,payments:'sem_movimento',reimbursements:'sem_movimento'},'basis').resultCents).toBeNull();
 });
 it('calcula pagamentos parciais ligados ao mesmo custo e exige vínculo para restante',()=>{
  const data=entries();data.push({id:'paid-2',kind:'Pagamento',amountCents:'5000',confirmation:{...data[1].confirmation!,revision:'1'}});
  expect(calculateCash(data,review,'basis').outstandingCents).toBe('5000');
  data[1].confirmation!.costEntryId=null;const unmatched=calculateCash(data,review,'basis');expect(unmatched.outstandingCents).toBeNull();expect(unmatched.resultCents).toBe('-9000');
 });
 it('preserva excedente e cobertura acima de 100%, sem truncar valores',()=>{
  const data=entries();data[2].amountCents='15000';expect(calculateCash(data,review,'basis')).toMatchObject({resultCents:'5000',coveragePercent:'150,00%'});
  data[1].amountCents='25000';const overpaid=calculateCash(data,review,'basis');expect(overpaid.outstandingCents).toBeNull();expect(overpaid.resultCents).toBe('-10000');
 });
 it('exclui reversões e recusa corte incompatível',()=>{
  const data=entries();data[2].reimbursement={status:'revertido',receivedOn:null,revision:'2'};
  expect(calculateCash(data,{...review,reimbursements:'sem_movimento'},'basis').receivedCents).toBe('0');
  expect(calculateCash(entries(),{...review,cutoffDate:'2026-09-01'},'basis').resultCents).toBeNull();
 });
 it('mantém precisão acima do limite seguro de Number',()=>{
  const data=entries();data[1].amountCents='900719925474099301';data[2].amountCents='900719925474099300';expect(calculateCash(data,review,'basis').resultCents).toBe('-1');
 });
 it('totaliza o portfólio somente quando todos os projetos estão conferidos no mesmo corte',()=>{
  const ready=calculateCash(entries(),review,'basis');expect(aggregateCash([ready,ready]).resultCents).toBe('-8000');
  expect(aggregateCash([ready,calculateCash(entries(),null,'basis')]).resultCents).toBeNull();
  expect(aggregateCash([ready,calculateCash(entries(),{...review,cutoffDate:'2026-09-04'},'basis')]).resultCents).toBeNull();
 });
});
