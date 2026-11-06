import Link from "next/link";
import { getSql, isDatabaseConfigured } from "@/lib/database";
import { readCashProjects } from "@/lib/cash-repository";
import { aggregateCash, cashMoney, cashResultLabel } from "@/lib/cash-domain";
import { CashSummary } from "./cash-summary";
export async function FinancialSummary() {
  if(!isDatabaseConfigured())return null;
  const data=await getSql().begin('read only isolation level repeatable read',async tx=>{
    const projects=await readCashProjects(tx);
    const [invoices]=await tx`SELECT coalesce(round(sum(amount)*100),0)::text cents FROM effective_fiscal_note`;
    const [base]=await tx`SELECT coalesce(round(sum((resource_row->>'amount')::numeric)*100),0)::text cents FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id CROSS JOIN LATERAL jsonb_array_elements(i.rows) AS resource_row`;
    return {projects,invoiceCents:invoices.cents as string,baseCents:base.cents as string};
  });
  const projects=data.projects;
  const cash=aggregateCash(projects.map(p=>p.result));
  const invoiceTotal=BigInt(data.invoiceCents);
  const paid=BigInt(cash.paidCents ?? "0");
  const receivable=BigInt(data.baseCents)-paid;
  const result={...cash,formulaVersion:"tria-caixa-v2" as const,incurredCents:invoiceTotal.toString(),receivedCents:paid.toString(),pendingCents:receivable.toString(),resultCents:"0",issues:[],outstandingIssue:null};
  return <>
    <p className="mt-5 text-sm"><Link href="/caixa/notas-fiscais" className="font-semibold text-[var(--brand)] underline">Conferir pagamentos das notas fiscais e vínculos com projetos</Link></p>
    <CashSummary result={result} scope="Visão geral dos projetos" portfolioFormula />
    <details className="mb-6 rounded-lg border border-[var(--border)] bg-white p-5"><summary className="cursor-pointer font-semibold text-[var(--brand)]">Conferir caixa por projeto</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Projeto</th><th className="p-2">Situação</th><th className="p-2">Resultado</th></tr></thead><tbody>{projects.map(p=><tr key={p.id} className="border-t"><td className="p-2"><Link className="underline" href={p.id === "fiscal-unallocated" ? "/caixa/notas-fiscais" : `/projetos/${p.id}`}>{p.title}</Link></td><td className="p-2">{cashResultLabel(p.result)}</td><td className="whitespace-nowrap p-2">{p.result.resultCents===null ? 'Não calculável' : cashMoney(p.result.resultCents)}</td></tr>)}</tbody></table></div>
    </details>
  </>;
}
