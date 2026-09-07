import type { ReimbursementStatus } from "./reimbursement-status";
export type CostConfirmation = {
  status: "nao_informado" | "confirmado" | "revertido";
  effectiveOn: string | null;
  costEntryId: string | null;
  revision: string;
};
export type CashEntry = {
  id: string; kind: string; amountCents: string; proofVersionId?: string;
  confirmation?: CostConfirmation; reimbursement?: ReimbursementStatus;
};
export type CoverageState = "nao_conferido" | "completo" | "sem_movimento";
export type CashReview = {
  revision: string; basisHash: string; cutoffDate: string;
  costs: CoverageState; payments: CoverageState; reimbursements: CoverageState;
  reason: string; actor: string; createdAt: string;
};
export type CashResult = {
  formulaVersion: "tria-caixa-v1";
  sourceHash: string;
  review: CashReview | null;
  reviewCurrent: boolean;
  incurredCents: string | null;
  paidCents: string | null;
  receivedCents: string | null;
  pendingCents: string | null;
  outstandingCents: string | null;
  resultCents: string | null;
  coveragePercent: string | null;
  issues: string[];
  outstandingIssue: string | null;
};
export function costConfirmationLabel(kind: string, value?: CostConfirmation) {
  if (!value || value.status === "nao_informado") return "Situação não informada";
  if (value.status === "revertido") return "Desconsiderado / revertido";
  return (kind === "Pagamento" ? "Saída de custo confirmada" : "Custo realizado confirmado") + ` · ${value.effectiveOn!.split("-").reverse().join("/")}`;
}
const sum = (entries: CashEntry[]) => entries.reduce((total, entry) => total + BigInt(entry.amountCents), 0n);
export function calculateCash(entries: CashEntry[], review: CashReview | null, sourceHash: string): CashResult {
  const costs=entries.filter(e=>e.kind==='Custo ou valor do projeto');
  const payments=entries.filter(e=>e.kind==='Pagamento');
  const refunds=entries.filter(e=>e.kind==='Reembolso');
  const incurred=costs.filter(e=>e.confirmation?.status==='confirmado');
  const paid=payments.filter(e=>e.confirmation?.status==='confirmado');
  const received=refunds.filter(e=>e.reimbursement?.status==='recebido_confirmado');
  const pending=refunds.filter(e=>e.reimbursement?.status==='sinalizado_pendente');
  const unknownCosts=costs.some(e=>!e.confirmation || e.confirmation.status==='nao_informado');
  const unknownPayments=payments.some(e=>!e.confirmation || e.confirmation.status==='nao_informado');
  const unknownRefunds=refunds.some(e=>!e.reimbursement || e.reimbursement.status==='nao_informado');
  const reviewCurrent=Boolean(review && review.basisHash===sourceHash);
  function categoryComplete(state: CoverageState | undefined, confirmed: CashEntry[], unknown: boolean) {
    return reviewCurrent && !unknown && (state==='sem_movimento' ? confirmed.length===0 : state==='completo' && confirmed.length>0);
  }
  const costsComplete=categoryComplete(review?.costs,incurred,unknownCosts);
  const paymentsComplete=categoryComplete(review?.payments,paid,unknownPayments);
  const refundsComplete=categoryComplete(review?.reimbursements,received,unknownRefunds);
  const issues: string[]=[];
  if (!review) issues.push("Confirme a cobertura dos registros do projeto.");
  else if (!reviewCurrent) issues.push("Os registros mudaram após a conferência. Confira novamente.");
  if (!paymentsComplete) issues.push("Saídas de custo incompletas ou não conferidas.");
  if (!refundsComplete) issues.push("Situação do reembolso não informada ou cobertura não conferida.");
  const dates=[...incurred,...paid].map(e=>e.confirmation?.effectiveOn).concat(received.map(e=>e.reimbursement?.receivedOn));
  const invalidCutoff=Boolean(review && dates.some(date=>!date || date>review.cutoffDate));
  if(invalidCutoff) issues.push("Há confirmação fora da data de corte. Confira novamente.");
  const ready=paymentsComplete && refundsComplete && !invalidCutoff;
  const paidTotal=sum(paid),receivedTotal=sum(received),incurredTotal=sum(incurred);
  let outstandingIssue: string | null=null;
  if(!costsComplete || !paymentsComplete || invalidCutoff) outstandingIssue="Confira os custos realizados e os pagamentos para calcular o que falta pagar.";
  else if(paid.some(e=>!e.confirmation?.costEntryId || !incurred.some(c=>c.id===e.confirmation!.costEntryId))) outstandingIssue="Vincule cada saída ao custo realizado correspondente.";
  else if(incurred.some(c=>sum(paid.filter(e=>e.confirmation?.costEntryId===c.id))>BigInt(c.amountCents))) outstandingIssue="Há pagamento vinculado acima do custo. Confira a relação antes de calcular o restante.";
  const percent=ready && paidTotal>0n ? (receivedTotal*10000n+paidTotal/2n)/paidTotal : null;
  return {
    formulaVersion:"tria-caixa-v1",sourceHash,review,reviewCurrent,
    incurredCents:incurred.length || costsComplete ? incurredTotal.toString() : null,
    paidCents:paid.length || paymentsComplete ? paidTotal.toString() : null,
    receivedCents:received.length || refundsComplete ? receivedTotal.toString() : null,
    pendingCents:pending.length || refundsComplete ? sum(pending).toString() : null,
    outstandingCents:outstandingIssue ? null : (incurredTotal-paidTotal).toString(),
    resultCents:ready ? (receivedTotal-paidTotal).toString() : null,
    coveragePercent:percent===null ? null : `${percent/100n},${(percent%100n).toString().padStart(2,"0")}%`,
    issues,outstandingIssue,
  };
}
export function cashMoney(value: string | null) {
  if(value===null) return "Não informado";
  const cents=BigInt(value),abs=cents<0n ? -cents : cents;
  return `${cents<0n ? "−" : ""}R$ ${(abs/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,".")},${(abs%100n).toString().padStart(2,"0")}`;
}
export function cashResultLabel(result: CashResult) {
  return result.resultCents===null ? "Resultado de caixa não calculável" : BigInt(result.resultCents)<0n ? "Déficit de caixa" : BigInt(result.resultCents)===0n ? "Equilíbrio de caixa" : "Saldo positivo de caixa";
}
export function cashMetrics(result: CashResult) {
  return [
    {name:"Custo realizado",value:cashMoney(result.incurredCents),explanation:"Custo reconhecido explicitamente; não é dinheiro pago."},
    {name:"Valor pago",value:cashMoney(result.paidCents),explanation:"Somente saídas de custo confirmadas com data."},
    {name:"Ainda a pagar",value:result.outstandingCents===null ? "Não calculável" : cashMoney(result.outstandingCents),explanation:result.outstandingIssue ?? "Custos realizados menos pagamentos vinculados, com cobertura conferida."},
    {name:"Reembolso recebido",value:cashMoney(result.receivedCents),explanation:"Entrada confirmada ou ausência de recebimento declarada explicitamente."},
    {name:"Reembolso a receber",value:cashMoney(result.pendingCents),explanation:"Reembolso aprovado pendente; não integra recebido nem caixa."},
    {name:cashResultLabel(result),value:result.resultCents===null ? "Não calculável" : cashMoney(result.resultCents),explanation:"Reembolso recebido − valor pago. Um saldo positivo não elimina as pendências."},
    {name:"Cobertura do valor pago",value:result.coveragePercent ?? "Não calculável",explanation:result.paidCents==='0' ? "Não calculável quando o valor pago é zero." : "Reembolso recebido ÷ valor pago × 100. Não mede conclusão do projeto." + (result.receivedCents!==null && result.paidCents!==null && BigInt(result.receivedCents)>BigInt(result.paidCents) ? " Recebido acima do pago: confira os registros." : "")},
  ];
}
export function aggregateCash(results: CashResult[]): CashResult {
  const complete=results.length>0 && results.every(r=>r.resultCents!==null);
  const cutoffs=new Set(results.map(r=>r.review?.cutoffDate));
  const sameCutoff=cutoffs.size===1 && !cutoffs.has(undefined);
  const total=(field: 'incurredCents'|'paidCents'|'receivedCents'|'pendingCents'|'outstandingCents')=>results.length && results.every(r=>r[field]!==null) ? results.reduce((s,r)=>s+BigInt(r[field]!),0n).toString() : null;
  const paid=total('paidCents'),received=total('receivedCents');
  const ready=complete && sameCutoff;
  const percent=ready && paid!==null && BigInt(paid)>0n && received!==null ? (BigInt(received)*10000n+BigInt(paid)/2n)/BigInt(paid) : null;
  return {formulaVersion:"tria-caixa-v1",sourceHash:"portfolio",review:null,reviewCurrent:ready,
    incurredCents:sameCutoff ? total('incurredCents') : null,paidCents:sameCutoff ? paid : null,receivedCents:sameCutoff ? received : null,pendingCents:sameCutoff ? total('pendingCents') : null,outstandingCents:sameCutoff ? total('outstandingCents') : null,
    resultCents:ready ? results.reduce((sum,r)=>sum+BigInt(r.resultCents!),0n).toString() : null,
    coveragePercent:percent===null ? null : `${percent/100n},${(percent%100n).toString().padStart(2,"0")}%`,
    issues:ready ? [] : [`${results.filter(r=>r.resultCents!==null).length} de ${results.length} projetos ativos com caixa conferido. O total exige todos conferidos na mesma data de corte.`],
    outstandingIssue:results.every(r=>r.outstandingCents!==null) && sameCutoff ? null : "Há projetos sem conciliação completa dos custos e pagamentos."};
}
