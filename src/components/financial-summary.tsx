import Link from "next/link";
import { getSql, isDatabaseConfigured } from "@/lib/database";
import { readCashProjects } from "@/lib/cash-repository";
import { aggregateCash, cashMoney, cashResultLabel } from "@/lib/cash-domain";
import { CashSummary } from "./cash-summary";
export async function FinancialSummary() {
  if(!isDatabaseConfigured())return null;
  const projects=await getSql().begin('read only isolation level repeatable read',tx=>readCashProjects(tx));
  const result=aggregateCash(projects.map(p=>p.result));
  return <>
    <CashSummary result={result} scope="Projetos ativos" />
    <details className="mb-6 rounded-lg border border-[var(--border)] bg-white p-5"><summary className="cursor-pointer font-semibold text-[var(--brand)]">Conferir caixa por projeto</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Projeto</th><th className="p-2">Situação</th><th className="p-2">Resultado</th></tr></thead><tbody>{projects.map(p=><tr key={p.id} className="border-t"><td className="p-2"><Link className="underline" href={`/projetos/${p.id}`}>{p.title}</Link></td><td className="p-2">{cashResultLabel(p.result)}</td><td className="whitespace-nowrap p-2">{p.result.resultCents===null ? 'Não calculável' : cashMoney(p.result.resultCents)}</td></tr>)}</tbody></table></div>
    </details>
  </>;
}
