import { cashMetrics, cashMoney, cashResultLabel, type CashResult } from "@/lib/cash-domain";
export function CashSummary({result,scope="Projeto inteiro"}:{result:CashResult;scope?:string}) {
  return <section aria-label="Resultado financeiro" className="my-6 rounded-lg border border-[var(--border)] bg-white p-5 sm:p-6">
    <h2 className="text-xl font-bold">Resultado financeiro — caixa</h2>
    <p className="mt-2 text-sm text-[var(--ink-muted)]">{scope}{result.review ? ` · conferência até ${result.review.cutoffDate.split('-').reverse().join('/')}` : ''}. Custos, notas fiscais e recebimentos permanecem separados.</p>
    <div className="mt-4 border-l-4 border-[#CB5C2B] bg-[var(--surface-subtle)] p-4">
      <p className="font-semibold">{cashResultLabel(result)}</p><p className="mt-1 text-2xl font-bold">{result.resultCents===null ? "Não calculável" : cashMoney(result.resultCents)}</p>
      <p className="mt-1 text-sm">Reembolso recebido − valor pago</p>
      {result.issues.map(issue=><p key={issue} className="mt-2 text-sm">{issue}</p>)}
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cashMetrics(result).filter((_,index)=>index!==5).map(metric=><div key={metric.name}>
      <p className="text-sm font-semibold">{metric.name}</p><p className="mt-1 text-xl font-bold">{metric.value}</p>
      <details className="mt-1 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">Como é calculado</summary><p className="mt-1">{metric.explanation}</p></details>
    </div>)}</div>
    {result.resultCents!==null && result.paidCents!==null && result.receivedCents!==null && BigInt(result.receivedCents)>BigInt(result.paidCents) && <p className="mt-4 text-sm font-semibold text-[#CB5C2B]">O recebido supera o valor pago. Confira os registros; isso não significa que o projeto está concluído.</p>}
    {result.outstandingIssue && <p className="mt-4 text-sm text-[var(--ink-muted)]">Ainda a pagar: {result.outstandingIssue}</p>}
    {result.review && <details className="mt-4 text-sm"><summary className="cursor-pointer text-[var(--brand)]">Conferência registrada</summary><p className="mt-2">{result.review.reason}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{result.review.actor} · R{result.review.revision} · {result.review.cutoffDate.split("-").reverse().join("/")}</p></details>}
    <p className="mt-4 text-xs text-[var(--ink-muted)]">Totais confirmados podem ser parciais enquanto a cobertura não for conferida.</p>
  </section>;
}
