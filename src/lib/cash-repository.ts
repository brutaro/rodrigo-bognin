import {readContract} from './contract-repository';
import {readInvoiceCash} from './fiscal-payment-repository';
import {invoicePaymentEntry,invoicePaymentIssues} from './fiscal-payment-domain';
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getSql } from "./database";
import type { ManualFinancialEntry } from "./demo-workspace";
import { calculateCash, costConfirmationLabel, type CashReview, type CostConfirmation, type CoverageState } from "./cash-domain";
export class CashInputError extends Error {}
export class CashConflictError extends CashInputError {}
type Query = Sql | TransactionSql;
function basisHash(entries: ManualFinancialEntry[]) {
  return createHash('sha256').update(JSON.stringify(entries.map(e=>[e.id,e.kind,e.amountCents,e.proofVersionId ?? null,e.confirmation ?? null,e.reimbursement ?? null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
}
export async function readCashProjects(tx: Query, projectId?: string) {
  const projects=await tx<Array<{id:string;title:string;review:CashReview|null}>>`
    SELECT p.id,p.title,CASE WHEN r.project_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revision',r.revision::text,'basisHash',r.basis_hash,'cutoffDate',r.cutoff_date::text,
      'costs',r.costs,'payments',r.payments,'reimbursements',r.reimbursements,'reason',r.reason,'actor',r.actor,'createdAt',r.created_at::text) END review
    FROM project p LEFT JOIN current_project_cash_review r ON r.project_id=p.id
    WHERE (${projectId ?? null}::text IS NULL AND p.archived_at IS NULL) OR p.id=${projectId ?? null}
    ORDER BY p.title,p.id`;
  const rows=await tx<Array<{project_id:string;entry:ManualFinancialEntry}>>`
    SELECT m.project_id,jsonb_build_object('id',m.id::text,'kind',m.kind,'description',m.description,'amountCents',m.amount_cents::text,
      'origin',m.origin,'documentState',CASE WHEN v.id IS NULL THEN 'Sem arquivo associado' ELSE 'Com arquivo associado' END,
      'requestId',m.request_id::text,'createdAt',m.created_at::text)
      || CASE WHEN v.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('proofVersionId',v.id::text) END
      || CASE WHEN c.entry_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('confirmation',jsonb_build_object('status',c.status,'effectiveOn',c.effective_on::text,'costEntryId',c.cost_entry_id::text,'revision',c.revision::text)) END
      || CASE WHEN r.entry_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reimbursement',jsonb_build_object('status',r.status,'receivedOn',r.received_on::text,'revision',r.revision::text)) END entry
    FROM manual_financial_entry m JOIN project p ON p.id=m.project_id
    LEFT JOIN financial_entry_proof f ON f.entry_id=m.id LEFT JOIN file_version v ON v.id=f.file_version_id AND v.status='active'
    LEFT JOIN current_cost_confirmation c ON c.entry_id=m.id LEFT JOIN current_reimbursement_status r ON r.entry_id=m.id
    WHERE (${projectId ?? null}::text IS NULL AND p.archived_at IS NULL) OR p.id=${projectId ?? null}
    ORDER BY m.created_at,m.id`;
  const invoices=await readInvoiceCash(tx);
  const scoped=projects.map(project=>{
    const notes=invoices.notes.filter(note=>note.declaration?.projectId===project.id);
    const entries=[...rows.filter(row=>row.project_id===project.id).map(row=>row.entry),...notes.flatMap(note=>{const entry=invoicePaymentEntry(note,invoices.payments);return entry?[entry]:[];})];
    const sourceHash=notes.length ? createHash('sha256').update(basisHash(entries)+JSON.stringify(notes)).digest('hex') : basisHash(entries);
    const result=calculateCash(entries,project.review,sourceHash);
    const issues=notes.flatMap(note=>invoicePaymentIssues(note,invoices.payments));
    if(issues.length){result.issues.push(...issues);result.resultCents=null;result.outstandingCents=null;result.coveragePercent=null;result.outstandingIssue='Confira os vínculos de notas fiscais e pagamentos.';}
    return {...project,entries,sourceHash,result};
  });
  if(!projectId){
    const outside=invoices.notes.filter(note=>note.declaration?.status==='confirmado'&&!projects.some(project=>project.id===note.declaration!.projectId));
    const entries=outside.flatMap(note=>{
      const linked=invoices.payments.find(p=>p.id===note.declaration!.paymentEntryId&&p.confirmed);
      if(linked)return [{id:linked.id,kind:'Pagamento' as const,amountCents:linked.amountCents,description:linked.description,origin:'Informado por Rodrigo' as const,documentState:'Sem arquivo associado' as const,createdAt:note.declaration!.createdAt,confirmation:{status:'confirmado' as const,effectiveOn:linked.paidOn,costEntryId:null,revision:note.declaration!.revision}}];
      const entry=invoicePaymentEntry(note,invoices.payments);return entry?[entry]:[];
    });
    if(outside.length){
      const sourceHash=basisHash(entries),result=calculateCash(entries,null,sourceHash);
      result.issues.push('Há notas pagas sem projeto ativo associado. Confira a alocação antes de fechar o resultado.');
      result.issues.push(...outside.flatMap(note=>invoicePaymentIssues(note,invoices.payments)));
      scoped.push({id:'fiscal-unallocated',title:'Notas pagas — sem projeto ativo',review:null,entries,sourceHash,result});
    }
  }
  return scoped;
}
export async function readCashProject(tx: Query, projectId: string) {
  const [project]=await readCashProjects(tx,projectId);
  if(!project) throw new CashInputError("Projeto não encontrado.");
  return {...project,contract:await readContract(tx,projectId)};
}
async function recordChange(tx: TransactionSql, projectId: string, action: string, detail: string) {
  await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=${projectId}`;
  await tx`INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at) VALUES(${randomUUID()},${projectId},${action},${detail},'Rodrigo',now())`;
}
export async function confirmCost(projectId: string, entryId: string, value: CostConfirmation, reason: string) {
  return getSql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const project=await readCashProject(tx,projectId);
    const entry=project.entries.find(e=>e.id===entryId && ['Custo ou valor do projeto','Pagamento'].includes(e.kind));
    if(!entry) throw new CashInputError("Escolha um custo ou pagamento deste projeto.");
    const current=entry.confirmation;
    if(current?.status===value.status && current.effectiveOn===value.effectiveOn && current.costEntryId===value.costEntryId) return;
    if((current?.revision ?? '0')!==value.revision) throw new CashConflictError("A confirmação mudou. Recarregue o projeto antes de alterar.");
    if(value.costEntryId && (entry.kind!=='Pagamento' || !project.entries.some(e=>e.id===value.costEntryId && e.kind==='Custo ou valor do projeto' && e.confirmation?.status==='confirmado'))) throw new CashInputError("Vincule a um custo realizado confirmado deste projeto.");
    await tx`INSERT INTO cost_confirmation_history(entry_id,revision,status,effective_on,cost_entry_id,reason) VALUES(${entryId},${(BigInt(value.revision)+1n).toString()},${value.status},${value.effectiveOn},${value.costEntryId},${reason})`;
    await recordChange(tx,projectId,'Confirmação financeira atualizada',`${entry.description}: ${costConfirmationLabel(entry.kind,value)}. Motivo: ${reason}`);
  });
}
export type CashReviewInput = {revision:string;basisHash:string;costs:CoverageState;payments:CoverageState;reimbursements:CoverageState;reason:string};
export async function saveCashReview(projectId: string, input: CashReviewInput) {
  return getSql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const project=await readCashProject(tx,projectId);
    if(project.sourceHash!==input.basisHash || (project.review?.revision ?? '0')!==input.revision) throw new CashConflictError("Os registros ou a conferência mudaram. Recarregue e confira novamente.");
    const groups=[['costs','Custo ou valor do projeto'],['payments','Pagamento'],['reimbursements','Reembolso']] as const;
    for(const [key,kind] of groups) {
      const state=input[key];if(state==='nao_conferido')continue;
      const entries=project.entries.filter(e=>e.kind===kind);
      const unknown=entries.some(e=>kind==='Reembolso' ? !e.reimbursement || e.reimbursement.status==='nao_informado' : !e.confirmation || e.confirmation.status==='nao_informado');
      const confirmed=entries.filter(e=>kind==='Reembolso' ? e.reimbursement?.status==='recebido_confirmado' : e.confirmation?.status==='confirmado');
      if(unknown) throw new CashInputError(`Há lançamento de ${kind.toLowerCase()} sem situação. Confirme ou desconsidere antes de fechar a conferência.`);
      if(state==='sem_movimento' && confirmed.length) throw new CashInputError(`Há ${kind.toLowerCase()} confirmado. Não é possível declarar ausência de movimento.`);
      if(state==='completo' && !confirmed.length) throw new CashInputError(`Não há ${kind.toLowerCase()} confirmado. Declare ausência de movimento, se for o caso.`);
    }
    const revision=(BigInt(input.revision)+1n).toString();
    const [review]=await tx`INSERT INTO project_cash_review_history(project_id,revision,basis_hash,costs,payments,reimbursements,reason) VALUES(${projectId},${revision},${project.sourceHash},${input.costs},${input.payments},${input.reimbursements},${input.reason}) RETURNING cutoff_date::text`;
    const labels={nao_conferido:'não conferido',completo:'registros completos',sem_movimento:'sem movimento declarado'};
    await recordChange(tx,projectId,'Cobertura financeira conferida',`Até ${review.cutoff_date}: custos ${labels[input.costs]}; pagamentos ${labels[input.payments]}; recebimentos ${labels[input.reimbursements]}. Motivo: ${input.reason}`);
  });
}
