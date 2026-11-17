import { ownerDisplay } from "@/lib/owner-display";
import { cashMetrics, cashMoney, cashResultLabel, type CashResult } from "@/lib/cash-domain";
export function CashSummary({result,scope="Projeto inteiro",portfolioFormula=false}:{result:CashResult;scope?:string;portfolioFormula?:boolean}) {
  const metrics=cashMetrics(result);
  if(portfolioFormula){
    metrics[0]={name:"Pagamento realizado",value:cashMoney(result.incurredCents),explanation:"Total das notas fiscais dos projetos."};
    metrics[1]={name:"Valor pago",value:cashMoney(result.paidCents),explanation:"Total de pagamentos registrados no caixa."};
    metrics[3]={name:"Reembolso recebido",value:cashMoney(result.receivedCents),explanation:"Considerado igual ao valor pago, conforme critério definido para esta visão geral."};
    metrics[4]={name:"Reembolso a receber",value:cashMoney(result.pendingCents),explanation:"Base consolidada menos o valor pago."};
    metrics[5]={name:"Resultado financeiro",value:cashMoney(result.resultCents),explanation:"Reembolso recebido menos valor pago."};
  }
  return <section aria-label="Resultado financeiro" className="my-6 rounded-lg border border-[var(--border)] bg-white p-5 sm:p-6">
    <h2 className="text-xl font-bold">Resultado financeiro — caixa</h2>
    <p className="mt-2 text-sm text-[var(--ink-muted)]">{portfolioFormula?"Visão consolidada dos projetos entregues: notas fiscais identificadas como valor realizado; pagamentos registrados no caixa; reembolsos recebidos pelo mesmo valor dos pagamentos; saldo a receber apurado pela diferença entre a base consolidada e o valor pago. Atividades mapeadas e evidências vinculadas aos registros e à documentação de cada projeto.":`${scope}${result.review ? ` · conferência até ${result.review.cutoffDate.split('-').reverse().join('/')}` : ''}. Custos, notas fiscais e recebimentos permanecem separados.`}</p>
    <div className="mt-4 border-l-4 border-[#CB5C2B] bg-[var(--surface-subtle)] p-4">
      <p className="font-semibold">{cashResultLabel(result)}</p><p className="mt-1 text-2xl font-bold">{result.resultCents===null ? "Não calculável" : cashMoney(result.resultCents)}</p>
      <p className="mt-1 text-sm">Reembolso recebido − valor pago</p>
      {result.issues.map(issue=><p key={issue} className="mt-2 text-sm">{issue}</p>)}
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.filter((_,index)=>index!==5).map(metric=><div key={metric.name}>
      <p className="text-sm font-semibold">{metric.name}</p><p className="mt-1 text-xl font-bold">{metric.value}</p>
      <details className="mt-1 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">Como é calculado</summary><p className="mt-1">{metric.explanation}</p></details>
    </div>)}</div>
    {result.resultCents!==null && result.paidCents!==null && result.receivedCents!==null && BigInt(result.receivedCents)>BigInt(result.paidCents) && <p className="mt-4 text-sm font-semibold text-[#CB5C2B]">O recebido supera o valor pago. Confira os registros; isso não significa que o projeto está concluído.</p>}
    {!portfolioFormula && result.outstandingIssue && <p className="mt-4 text-sm text-[var(--ink-muted)]">Ainda a pagar: {result.outstandingIssue}</p>}
    {result.review && <details className="mt-4 text-sm"><summary className="cursor-pointer text-[var(--brand)]">Conferência registrada</summary><p className="mt-2">{result.review.reason}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{ownerDisplay(result.review.actor)} · R{result.review.revision} · {result.review.cutoffDate.split("-").reverse().join("/")}</p></details>}
    {!portfolioFormula && <p className="mt-4 text-xs text-[var(--ink-muted)]">Totais confirmados podem ser parciais enquanto a cobertura não for conferida.</p>}
  </section>;
}
