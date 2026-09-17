import Link from "next/link";
import {resourceProjectCatalog} from '@/lib/resource-project-import';
import {resourceProjectTitles} from '@/lib/resource-project-resolution';
import { currentResources } from "@/lib/resource-import";
import { isDatabaseConfigured } from "@/lib/database";
import { formatBrlFromCents } from "@/lib/workspace";
import { cents, resourceHourlyRateCents, resourcePeriod, resourceTotalCents } from "@/lib/resource-import-domain";
export async function ResourceSummary({ projectTitle, projectId }: { projectTitle?: string; projectId?: string }) {
  if (!isDatabaseConfigured()) return null;
  const current = await currentResources();
  const titles = projectId ? resourceProjectTitles(await resourceProjectCatalog(),projectId) : projectTitle ? [projectTitle] : null;
  const rows = current?.rows.filter(row => !titles || titles.includes(row.project)) ?? [];
  const period = !projectTitle && current ? resourcePeriod(current.rows) : null;
  if (projectTitle && !rows.length) return null;
  return <section className="my-6 rounded-lg border border-[var(--border)] bg-white p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-[var(--ink)]">Aplicação de recursos</h2><Link href={projectId ? `/projetos/${encodeURIComponent(projectId)}/importar-planilha` : "/fontes/base-consolidada"} className="text-sm font-semibold text-[var(--brand)] underline">Atualizar planilha</Link></div>
    {!current ? <p className="mt-3 text-sm text-[var(--ink-muted)]">Importe a Base Tratada para acompanhar a aplicação de recursos. Os projetos e registros já existentes continuam disponíveis abaixo.</p> : <>
      {!projectTitle && <p className="mt-3 text-sm text-[var(--ink-muted)]">Período apurado: <span className="font-semibold text-[var(--ink)]">{period ?? "Não informado"}</span></p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-3"><div><p className="text-sm text-[var(--ink-muted)]">{projectTitle ? "Valor da base do projeto" : "Valor da base consolidada"}</p><p className="mt-1 text-3xl font-bold text-[#A94722]">{formatBrlFromCents(resourceTotalCents(rows).toString())}</p></div><div><p className="text-sm text-[var(--ink-muted)]">Lançamentos no recorte</p><p className="mt-1 text-3xl font-bold">{rows.length.toLocaleString("pt-BR")}</p></div><div><p className="text-sm text-[var(--ink-muted)]">Última versão da base</p><p className="mt-2 font-semibold">{new Date(current.appliedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p></div></div>
      <p className="mt-4 text-sm text-[var(--ink-muted)]">Última importação da base: {current.sheet}. Este valor representa a aplicação registrada na planilha; não comprova pagamento ou reembolso e não é somado às medições anteriores.</p>
      <a className="mt-4 inline-block text-sm underline text-[var(--brand)]" href={`/api/sources/resources/export?id=${current.id}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`}>Baixar base em CSV</a>
      <details className="mt-4"><summary className="cursor-pointer font-semibold text-sm">Ver lançamentos e origem</summary><p className="mt-2 text-xs text-[var(--ink-muted)]">Valor/hora calculado por Valor ÷ Horas da carga vigente. Sem horas positivas, a taxa fica não informada.</p><div className="mt-3 max-h-80 overflow-auto"><table className="w-full min-w-[900px] table-fixed text-left text-sm"><colgroup><col className="w-[8%]" /><col className="w-[32%]" /><col span={4} className="w-[15%]" /></colgroup><thead><tr><th className="p-2">ID</th><th className="p-2">Projeto / atividade</th><th className="p-2">Data</th><th className="p-2">Executor</th><th className="p-2">Valor/hora</th><th className="p-2">Valor</th></tr></thead><tbody>{rows.slice(0,100).map(row=>{const rate=resourceHourlyRateCents(row);return <tr key={row.id} className="border-t"><td className="p-2">{row.id}</td><td className="p-2">{row.project}<span className="block text-[var(--ink-muted)]">{row.activity}</span></td><td className="p-2 whitespace-nowrap">{row.date ? row.date.split("-").reverse().join("/") : "Não informado"}</td><td className="p-2">{row.executor?.trim() || "Não informado"}</td><td className="p-2 whitespace-nowrap" title={rate===null ? "Sem horas positivas para calcular a taxa" : "Valor do lançamento dividido pelas horas"}>{rate===null ? "Não informado" : formatBrlFromCents(rate.toString())}</td><td className="p-2 whitespace-nowrap">{formatBrlFromCents(cents(row.amount).toString())}</td></tr>;})}</tbody></table></div>{rows.length>100 && <p className="text-xs mt-2">Exibindo os primeiros 100 de {rows.length} lançamentos.</p>}</details>
    </>}
  </section>;
}
