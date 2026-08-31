import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/notice";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { demoProjects, getDemoProject } from "@/lib/demo-data";
import {
  financialOrigins,
  formatBrlFromCents,
  manualFinancialKinds,
  listDemoProjectPublications,
  readDemoProjectDraft,
} from "@/lib/demo-workspace";
import { addFinancialEntryAction, saveNarrativeAction } from "./actions";

export function generateStaticParams() {
  return demoProjects.map((project) => ({ id: project.id }));
}

function displayDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projetos/[id]">) {
  const { id } = await params;
  const project = getDemoProject(id);
  if (!project) notFound();
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const draft = await readDemoProjectDraft(project.id);
  const latestPublication = (await listDemoProjectPublications(project.id))[0];
  const saveNarrative = saveNarrativeAction.bind(null, project.id);
  const addFinancialEntry = addFinancialEntryAction.bind(null, project.id);

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] hover:underline">
          <span aria-hidden>←</span> Voltar ao meu trabalho
        </Link>

        <section className="mt-5 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={project.status} />
                <span className="text-sm text-[var(--ink-muted)]">{project.period}</span>
              </div>
              <h1 className="mt-4 max-w-4xl text-3xl font-bold tracking-tight text-[var(--ink)]">{project.name}</h1>
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                {draft.updatedAt ? `Salvo em ${displayDate(draft.updatedAt)}` : "Ainda sem alterações demonstrativas"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row">
              {latestPublication ? <Link href={`/publicacoes/${latestPublication.id}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100">Ver publicação V{latestPublication.version}</Link> : null}
              <Link href={`/projetos/${project.id}/conferir`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-blue-900">Ver como ficará</Link>
            </div>
          </div>
        </section>

        <div className="mt-6"><Notice code={notice} /></div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.9fr)]">
          <div className="space-y-6">
            <section aria-labelledby="narrative-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5">
                <h2 id="narrative-title" className="text-lg font-bold text-[var(--ink)]">O que foi feito</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Escreva em primeira pessoa. Salvar cria um registro no histórico demonstrativo.</p>
              </div>
              <form action={saveNarrative} className="p-5">
                <label htmlFor="narrative" className="mb-2 block text-sm font-semibold text-[var(--ink)]">Narrativa do projeto</label>
                <textarea
                  id="narrative"
                  name="narrative"
                  defaultValue={draft.narrative}
                  minLength={10}
                  maxLength={20_000}
                  rows={9}
                  required
                  className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-blue-100"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">Dados fictícios. Nenhum texto real foi carregado.</p>
                  <SubmitButton idleLabel="Salvar narrativa" pendingLabel="Salvando…" />
                </div>
              </form>
            </section>

            <section aria-labelledby="activities-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5">
                <h2 id="activities-title" className="text-lg font-bold text-[var(--ink)]">Atividades e medições</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Os valores medidos não são tratados como pagamentos.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-5 py-3 font-semibold">Atividade</th><th className="px-5 py-3 font-semibold">BM</th><th className="px-5 py-3 font-semibold">Horas</th><th className="px-5 py-3 text-right font-semibold">Medido</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {project.activities.map((activity) => (
                      <tr key={activity.id}>
                        <td className="px-5 py-4"><span className="block font-medium text-[var(--ink)]">{activity.description}</span><span className="mt-1 block text-xs text-slate-500">{activity.id}</span></td>
                        <td className="px-5 py-4 text-slate-600">{activity.bm}</td>
                        <td className="px-5 py-4 text-slate-600">{activity.hours}</td>
                        <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">{activity.measuredValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="finance-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5">
                <h2 id="finance-title" className="text-lg font-bold text-[var(--ink)]">Valores</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Custos, notas, valores informados e pagamentos não são somados entre si.</p>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {project.financialReferences.map((reference) => (
                  <article key={reference.id} className="p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">{reference.kind}</p><h3 className="mt-1 font-semibold text-[var(--ink)]">{reference.label}</h3><p className="mt-1 text-xs text-slate-500">Origem importada · {reference.id}</p></div>
                      <p className="text-lg font-bold text-[var(--ink)]">{reference.amount}</p>
                    </div>
                    <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                      <div><dt className="text-xs text-slate-500">Relação</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.relation}</dd></div>
                      <div><dt className="text-xs text-slate-500">Pagamento</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.payment}</dd></div>
                    </dl>
                  </article>
                ))}
                {draft.manualFinancialEntries.map((entry) => (
                  <article key={entry.id} className="border-l-4 border-l-blue-400 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-blue-800">{entry.kind}</p><h3 className="mt-1 font-semibold text-[var(--ink)]">{entry.description}</h3><p className="mt-1 text-xs text-slate-500">{entry.origin} · {entry.documentState}</p></div>
                      <p className="text-lg font-bold text-[var(--ink)]">{formatBrlFromCents(entry.amountCents)}</p>
                    </div>
                  </article>
                ))}
                {!project.financialReferences.length && !draft.manualFinancialEntries.length ? <p className="p-5 text-sm text-[var(--ink-muted)]">Nenhum valor registrado.</p> : null}
              </div>

              <details className="border-t border-[var(--border)] p-5">
                <summary className="cursor-pointer text-sm font-bold text-[var(--brand)]">Adicionar valor</summary>
                <form action={addFinancialEntry} className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-[var(--ink)]">Tipo
                    <select name="kind" required defaultValue="" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">
                      <option value="" disabled>Escolha o que o valor representa</option>
                      {manualFinancialKinds.map((kind) => <option key={kind}>{kind}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-[var(--ink)]">Valor
                    <input name="amount" inputMode="decimal" placeholder="0,00" required className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" />
                  </label>
                  <label className="block text-sm font-semibold text-[var(--ink)] sm:col-span-2">Descrição
                    <input name="description" minLength={3} maxLength={200} required placeholder="O que este valor representa?" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" />
                  </label>
                  <label className="block text-sm font-semibold text-[var(--ink)] sm:col-span-2">Origem
                    <select name="origin" required defaultValue="Informado por Rodrigo" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">
                      {financialOrigins.map((origin) => <option key={origin}>{origin}</option>)}
                    </select>
                  </label>
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Até o upload ser implementado, qualquer pagamento permanece informado sem arquivo associado.</p>
                  <div className="sm:col-span-2 sm:justify-self-end"><SubmitButton idleLabel="Registrar valor" pendingLabel="Registrando…" /></div>
                </form>
              </details>
            </section>
          </div>

          <aside className="space-y-6">
            <section aria-labelledby="evidence-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="evidence-title" className="text-lg font-bold text-[var(--ink)]">Arquivos</h2></div>
              <ul className="divide-y divide-[var(--border)]">
                {project.evidence.map((item) => (
                  <li key={item.id} className="p-5"><p className="break-words text-sm font-semibold text-[var(--ink)]">{item.name}</p><div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">{item.kind}</span><span className={item.availability === "Disponível" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{item.availability}</span></div></li>
                ))}
              </ul>
              <div className="p-5"><button type="button" disabled className="w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-500">Adicionar arquivo</button></div>
            </section>

            <section aria-labelledby="history-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="history-title" className="text-lg font-bold text-[var(--ink)]">Histórico</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Quem registrou, o que mudou e quando.</p></div>
              {draft.history.length ? (
                <ol className="divide-y divide-[var(--border)]">
                  {draft.history.slice(0, 8).map((event) => (
                    <li key={event.id} className="p-5"><p className="text-sm font-semibold text-[var(--ink)]">{event.action}</p><p className="mt-1 text-xs leading-5 text-slate-500">{event.detail}</p><p className="mt-2 text-xs text-slate-500">{event.actor} · {displayDate(event.occurredAt)}</p></li>
                  ))}
                </ol>
              ) : <p className="p-5 text-sm text-[var(--ink-muted)]">Nenhuma alteração demonstrativa registrada.</p>}
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
