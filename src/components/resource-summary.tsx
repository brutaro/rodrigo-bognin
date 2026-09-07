import Link from "next/link";
import { currentResources } from "@/lib/resource-import";
import { isDatabaseConfigured } from "@/lib/database";
import { formatBrlFromCents } from "@/lib/workspace";
import { cents, resourceTotalCents } from "@/lib/resource-import-domain";
export async function ResourceSummary({ projectTitle }: { projectTitle?: string }) {
  if (!isDatabaseConfigured()) return null;
  const current = await currentResources();
  const rows = current?.rows.filter(row => !projectTitle || row.project === projectTitle) ?? [];
  if (projectTitle && !rows.length) return null;
  return <section className="my-6 rounded-lg border border-[var(--border)] bg-white p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-[var(--ink)]">Aplicação de recursos</h2><Link href="/fontes/base-consolidada" className="text-sm font-semibold text-[var(--brand)] underline">Atualizar planilha</Link></div>
    {!current ? <p className="mt-3 text-sm text-[var(--ink-muted)]">Importe a Base Tratada para acompanhar a aplicação de recursos. Os projetos e registros já existentes continuam disponíveis abaixo.</p> : <>
      <div className="mt-5 grid gap-5 sm:grid-cols-3"><div><p className="text-sm text-[var(--ink-muted)]">Valor da base consolidada</p><p className="mt-1 text-3xl font-bold text-[#A94722]">{formatBrlFromCents(resourceTotalCents(rows).toString())}</p></div><div><p className="text-sm text-[var(--ink-muted)]">Lançamentos no recorte</p><p className="mt-1 text-3xl font-bold">{rows.length.toLocaleString("pt-BR")}</p></div><div><p className="text-sm text-[var(--ink-muted)]">Última atualização</p><p className="mt-2 font-semibold">{new Date(current.appliedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p></div></div>
      <p className="mt-4 text-sm text-[var(--ink-muted)]">Fonte: {current.sheet}. Este valor representa a aplicação registrada na planilha; não comprova pagamento ou reembolso e não é somado às medições anteriores.</p>
      <a className="mt-4 inline-block text-sm underline text-[var(--brand)]" href={`/api/sources/resources/export?id=${current.id}`}>Baixar base em CSV</a>
      <details className="mt-4"><summary className="cursor-pointer font-semibold text-sm">Ver lançamentos e origem</summary><div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">ID</th><th className="p-2">Projeto / atividade</th><th className="p-2">Valor</th></tr></thead><tbody>{rows.slice(0,100).map(row=><tr key={row.id} className="border-t"><td className="p-2">{row.id}</td><td className="p-2">{row.project}<span className="block text-[var(--ink-muted)]">{row.activity}</span></td><td className="p-2 whitespace-nowrap">{formatBrlFromCents(cents(row.amount).toString())}</td></tr>)}</tbody></table></div>{rows.length>100 && <p className="text-xs mt-2">Exibindo os primeiros 100 de {rows.length} lançamentos.</p>}</details>
    </>}
  </section>;
}
