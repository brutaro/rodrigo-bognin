import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/notice";
import {
  buildPublicationCsv,
  buildPublicationHtml,
  toPublicPublicationV1,
} from "@/lib/demo-publication-export";
import { readDemoPublication } from "@/lib/demo-workspace";

function displayDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export default async function PublicationPage({ params, searchParams }: PageProps<"/publicacoes/[publicationId]">) {
  const { publicationId } = await params;
  const publication = await readDemoPublication(publicationId);
  if (!publication) notFound();
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const view = toPublicPublicationV1(publication);
  const htmlHash = sha256(buildPublicationHtml(publication));
  const csvHash = sha256(buildPublicationCsv(publication));

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href={`/projetos/${publication.projectId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] hover:underline"><span aria-hidden>←</span> Voltar ao projeto</Link>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Publicada · imutável</span>
        </div>

        <section className="mt-5 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm lg:p-8">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--brand)]">Publicação V{view.version}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--ink)]">{view.title}</h1>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{view.period} · publicada em {displayDate(view.publishedAt)}</p>
          <dl className="mt-6 grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs uppercase text-slate-500">Código público</dt><dd className="mt-1 font-bold text-slate-800">{view.publicationCode}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Proveniência</dt><dd className="mt-1 font-bold text-slate-800">{view.provenance}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Corte inclusivo</dt><dd className="mt-1 font-bold text-slate-800">{view.cutoff.startDate} a {view.cutoff.endDate}</dd></div>
          </dl>
        </section>

        <div className="mt-6"><Notice code={notice} /></div>

        <section aria-labelledby="downloads-title" className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div><h2 id="downloads-title" className="text-lg font-bold text-blue-950">Exportações essenciais</h2><p className="mt-1 text-sm text-blue-900">Os arquivos são gerados somente a partir deste snapshot verificado.</p></div>
            <div className="flex flex-wrap gap-3">
              <a href={`/publicacoes/${publication.id}/exportacoes/html`} className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-900">Baixar HTML</a>
              <a href={`/publicacoes/${publication.id}/exportacoes/csv`} className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-bold text-blue-900 hover:bg-blue-100">Baixar CSV</a>
            </div>
          </div>
          <details className="mt-4 text-xs text-blue-950"><summary className="cursor-pointer font-semibold">Ver hashes dos artefatos</summary><dl className="mt-3 space-y-2 font-mono"><div><dt className="inline font-sans font-semibold">HTML: </dt><dd className="inline break-all">{htmlHash}</dd></div><div><dt className="inline font-sans font-semibold">CSV: </dt><dd className="inline break-all">{csvHash}</dd></div></dl></details>
        </section>

        <div className="mt-6 grid gap-6">
          <section aria-labelledby="published-narrative" className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm"><h2 id="published-narrative" className="text-xl font-bold">O que foi feito</h2><p className="mt-4 whitespace-pre-wrap text-base leading-7 text-slate-700">{view.narrative}</p></section>

          <section aria-labelledby="published-activities" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm"><div className="border-b border-[var(--border)] p-5"><h2 id="published-activities" className="text-xl font-bold">Atividades e medições</h2><p className="mt-1 text-sm text-slate-500">Medição não comprova faturamento ou pagamento.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Código</th><th className="px-5 py-3">Atividade</th><th className="px-5 py-3">BM</th><th className="px-5 py-3">Horas</th><th className="px-5 py-3 text-right">Medido</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{view.activities.map((item) => <tr key={item.code}><td className="px-5 py-4 text-xs text-slate-500">{item.code}</td><td className="px-5 py-4 font-semibold">{item.description}</td><td className="px-5 py-4">{item.bm}</td><td className="px-5 py-4">{item.hours}</td><td className="px-5 py-4 text-right font-semibold">{item.measuredValue}</td></tr>)}</tbody></table></div></section>

          <section aria-labelledby="published-finance" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm"><div className="border-b border-[var(--border)] p-5"><h2 id="published-finance" className="text-xl font-bold">Referências financeiras</h2><p className="mt-1 text-sm text-slate-500">Os grupos permanecem separados. Não há soma automática.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">Grupo</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Origem</th><th className="px-4 py-3">Relação</th><th className="px-4 py-3">Pagamento</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{view.financialEntries.map((item) => <tr key={item.code}><td className="px-4 py-4 text-xs text-slate-500">{item.code}</td><td className="px-4 py-4 font-mono text-xs">{item.groupCode}</td><td className="px-4 py-4"><strong className="block">{item.label}</strong><span className="text-xs text-slate-500">{item.sourceType} · {item.kind}</span></td><td className="px-4 py-4 font-semibold">{item.amount}</td><td className="px-4 py-4">{item.origin}</td><td className="px-4 py-4">{item.relation}</td><td className="px-4 py-4">{item.payment}</td></tr>)}</tbody></table></div></section>

          <section aria-labelledby="published-evidence" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm"><div className="border-b border-[var(--border)] p-5"><h2 id="published-evidence" className="text-xl font-bold">Registros de evidência</h2><p className="mt-1 text-sm text-slate-500">Nenhum arquivo faz parte desta demonstração. Somente metadados fictícios foram publicados.</p></div><ul className="divide-y divide-[var(--border)]">{view.evidence.map((item) => <li key={item.code} className="p-5"><div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><div><strong>{item.name}</strong><p className="mt-1 text-xs text-slate-500">{item.code} · {item.kind}</p></div><span className="text-sm font-semibold text-amber-800">{item.availability}</span></div><p className="mt-2 text-xs text-slate-500">{item.packageState}</p></li>)}</ul></section>
        </div>

        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-5 text-sm text-slate-600"><p><strong>Integridade:</strong> <span className="break-all font-mono text-xs">{view.contentHash}</span></p><p className="mt-2">Esquema {view.schemaVersion} · renderizador {view.rendererVersion}.</p><Link href={`/projetos/${publication.projectId}`} className="mt-4 inline-block font-bold text-[var(--brand)] hover:underline">Fazer uma correção no rascunho</Link></section>
      </main>
    </AppShell>
  );
}
