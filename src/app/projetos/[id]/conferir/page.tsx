import {ContractSummary} from "@/components/contract-summary";
import { CashSummary } from "@/components/cash-summary";
import { costConfirmationLabel } from "@/lib/cash-domain";
import { reimbursementLabel } from "@/lib/reimbursement-status";
import { requireAuthenticatedPage } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ActivityPagination, activityPageSize, normalizeActivityPage } from "@/components/activity-pagination";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { getProjectDetails } from "@/lib/project-repository";
import { isDatabaseConfigured } from "@/lib/database";
import { currentPublishedFiles, listProjectFiles } from "@/lib/file-repository";
import {
  buildWorkspaceCompositionHash,
  formatBrlFromCents,
  listProjectPublications,
  readProjectDraft,
} from "@/lib/workspace";
import { publishProjectAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewProjectPage({ params, searchParams }: PageProps<"/projetos/[id]/conferir">) {
  await requireAuthenticatedPage();
  const { id } = await params;
  const project = await getProjectDetails(id);
  if (!project) notFound();
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const draft = await readProjectDraft(project.id);
  const fileDocuments = isDatabaseConfigured() ? await listProjectFiles(project.id) : [];
  const publishedFiles = currentPublishedFiles(fileDocuments,draft.manualFinancialEntries.flatMap(entry=>entry.proofVersionId ? [entry.proofVersionId] : []));
  const publications = await listProjectPublications(project.id);
  const pendingEvidence = project.evidence.filter((item) => item.availability === "Pendente");
  const undocumentedPayments = draft.manualFinancialEntries.filter(
    (entry) => ["Pagamento","Reembolso"].includes(entry.kind) && entry.documentState === "Sem arquivo associado",
  );
  const uncertainReferences = project.financialReferences.filter(
    (entry) => entry.relation === "Fraca" || entry.relation === "Sem relação confirmada",
  );
  const canPublish = draft.narrative.trim().length >= 20;
  const compositionHash = buildWorkspaceCompositionHash(project, draft, isDatabaseConfigured() ? publishedFiles : undefined);
  const activityPage = normalizeActivityPage(typeof query.activityPage === "string" ? query.activityPage : undefined, project.activities.length);
  const activityStart = (activityPage - 1) * activityPageSize;
  const visibleActivities = project.activities.slice(activityStart, activityStart + activityPageSize);
  const publish = publishProjectAction.bind(null, project.id, compositionHash, draft.revision ?? "0");

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <Link href={`/projetos/${project.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] hover:underline">
          <span aria-hidden>←</span> Voltar para editar
        </Link>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,.75fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm lg:p-8">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--brand)]">Conferir e publicar</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--ink)]">{project.name}</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">Esta prévia preserva a origem e a situação de cada registro. A publicação cria uma cópia imutável.</p>
              {publications[0] ? (
                <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Última publicação: <Link className="font-bold underline" href={`/publicacoes/${publications[0].id}`}>V{publications[0].version}</Link>. Qualquer correção publicada gera a próxima versão.
                </p>
              ) : null}
            </section>

            <Notice code={notice} />
            {draft.contract && <ContractSummary contract={draft.contract} />}
            {draft.cash && <CashSummary result={draft.cash} />}

            <section aria-labelledby="preview-narrative" className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
              <h2 id="preview-narrative" className="text-xl font-bold text-[var(--ink)]">O que foi feito</h2>
              <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-slate-700">{draft.narrative}</p>
            </section>

            <section aria-labelledby="preview-activities" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="preview-activities" className="text-xl font-bold text-[var(--ink)]">Atividades e medições</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Medição não comprova faturamento ou pagamento. Mostrando {visibleActivities.length ? activityStart + 1 : 0}–{activityStart + visibleActivities.length} de {project.activities.length} atividades.</p></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Atividade</th><th className="px-5 py-3">BM</th><th className="px-5 py-3">Horas</th><th className="px-5 py-3 text-right">Medido</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{visibleActivities.map((item) => <tr key={item.id}><td className="px-5 py-4"><strong className="block">{item.description}</strong><span className="text-xs text-slate-500">{item.id}</span></td><td className="px-5 py-4">{item.bm}</td><td className="px-5 py-4">{item.hours}</td><td className="px-5 py-4 text-right font-semibold">{item.measuredValue}</td></tr>)}</tbody></table></div>
              <ActivityPagination basePath={`/projetos/${encodeURIComponent(project.id)}/conferir`} page={activityPage} total={project.activities.length} anchor="preview-activities" />
            </section>

            <section aria-labelledby="preview-financial" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="preview-financial" className="text-xl font-bold text-[var(--ink)]">Referências financeiras</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">As naturezas não são somadas automaticamente.</p></div>
              <div className="divide-y divide-[var(--border)]">
                {project.financialReferences.map((item) => <article key={item.id} className="p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-xs font-bold uppercase text-[var(--brand)]">Referência importada · {item.kind}</p><h3 className="mt-1 font-semibold">{item.label}</h3><dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><div><dt>Base do vínculo</dt><dd className="font-semibold">{item.relationBasis ?? "Não informada"}</dd></div><div><dt>Relação</dt><dd className="font-semibold">{item.relation}</dd></div><div><dt>Valor relacionado</dt><dd className="font-semibold">{item.relatedAmount ?? "Não informado"}</dd></div><div><dt>Valor integral elegível</dt><dd className="font-semibold">{item.fullValueEligible === true ? "Sim" : item.fullValueEligible === false ? "Não" : "Não avaliado"}</dd></div><div><dt>Pagamento</dt><dd className="font-semibold">{item.payment}</dd></div></dl></div><div className="sm:text-right"><span className="text-xs text-slate-500">Valor bruto da nota</span><strong className="block">{item.amount}</strong></div></div></article>)}
                {draft.manualFinancialEntries.map((item) => <article key={item.id} className="border-l-4 border-l-[#CB5C2B] p-5"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold uppercase text-blue-800">Cadastro manual · {item.kind}</p><h3 className="mt-1 font-semibold">{item.description}</h3><p className="mt-2 text-xs text-slate-500">{item.origin} · {item.documentState}{item.confirmation ? ` · ${costConfirmationLabel(item.kind,item.confirmation)}` : ""}{item.kind === "Reembolso" ? ` · ${reimbursementLabel(item.reimbursement)}` : ""}{item.proofVersionId ? ` · ${publishedFiles.find(file=>file.versionId===item.proofVersionId)?.title ?? "Comprovante"}` : ""}</p></div><strong>{formatBrlFromCents(item.amountCents)}</strong></div></article>)}
                {!project.financialReferences.length && !draft.manualFinancialEntries.length ? <p className="p-5 text-sm text-slate-500">Nenhuma referência financeira.</p> : null}
              </div>
            </section>

            <section aria-labelledby="preview-evidence" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="preview-evidence" className="text-xl font-bold text-[var(--ink)]">Evidências</h2></div>
              <ul className="divide-y divide-[var(--border)]">{project.evidence.map((item) => <li key={item.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-sm">{item.name}</strong><p className="mt-1 text-xs text-slate-500">{item.id} · {item.kind}</p></div><span className={item.availability === "Disponível" ? "text-sm font-semibold text-emerald-700" : "text-sm font-semibold text-amber-700"}>{item.availability}</span></li>)}</ul>
            </section>

            <section aria-labelledby="preview-files" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="preview-files" className="text-xl font-bold text-[var(--ink)]">Arquivos incluídos</h2><p className="mt-1 text-sm text-slate-500">A versão ativa mais recente de cada arquivo será vinculada ao snapshot.</p></div>
              <ul className="divide-y divide-[var(--border)]">{publishedFiles.map((file) => <li key={file.versionId} className="p-5"><strong className="text-sm">{file.title}</strong><p className="mt-1 text-xs text-slate-500">V{file.version} · {file.originalName} · SHA-256 {file.sha256}</p></li>)}</ul>
              {!publishedFiles.length ? <p className="p-5 text-sm text-slate-500">Nenhum arquivo pessoal será incluído.</p> : null}
            </section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <section aria-labelledby="checklist-title" className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
              <h2 id="checklist-title" className="text-lg font-bold text-[var(--ink)]">Conferência</h2>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex gap-3"><span aria-hidden className={canPublish ? "text-emerald-700" : "text-red-700"}>{canPublish ? "✓" : "!"}</span><span>Narrativa com contexto suficiente.</span></li>
                <li className="flex gap-3"><span aria-hidden className="text-emerald-700">✓</span><span>{project.activities.length} atividade(s) identificada(s).</span></li>
                <li className="flex gap-3"><span aria-hidden className={pendingEvidence.length ? "text-amber-700" : "text-emerald-700"}>{pendingEvidence.length ? "!" : "✓"}</span><span>{pendingEvidence.length ? `${pendingEvidence.length} evidência(s) pendente(s), com situação preservada.` : "Evidências disponíveis."}</span></li>
                <li className="flex gap-3"><span aria-hidden className={undocumentedPayments.length ? "text-amber-700" : "text-emerald-700"}>{undocumentedPayments.length ? "!" : "✓"}</span><span>{undocumentedPayments.length ? `${undocumentedPayments.length} pagamento(s) ou reembolso(s) sem arquivo.` : "Nenhum pagamento ou reembolso manual sem arquivo."}</span></li>
                <li className="flex gap-3"><span aria-hidden className={uncertainReferences.length ? "text-amber-700" : "text-emerald-700"}>{uncertainReferences.length ? "!" : "✓"}</span><span>{uncertainReferences.length ? `${uncertainReferences.length} referência(s) sem vínculo forte; não serão tratadas como comprovação.` : "Relações financeiras identificadas."}</span></li>
              </ul>
            </section>

            <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <h2 className="font-bold text-blue-950">Publicação imutável</h2>
              <p className="mt-2 text-sm leading-6 text-blue-900">Depois de publicar, esta versão não poderá ser alterada. Correções futuras criarão uma nova versão.</p>
              <form action={publish} className="mt-5">
                <label className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-white p-3 text-sm leading-5 text-blue-950">
                  <input type="checkbox" name="acknowledgeCaveats" value="yes" required className="mt-1 size-4 shrink-0" />
                  <span>Conferi esta composição, inclusive os arquivos listados, e entendi os alertas acima. Itens pendentes e relações incertas continuarão identificados como tais.</span>
                </label>
                <SubmitButton idleLabel={publications.length ? "Publicar nova versão" : "Publicar versão 1"} pendingLabel="Publicando…" />
              </form>
              {!canPublish ? <p className="mt-3 text-xs font-semibold text-red-800">Amplie a narrativa antes de publicar.</p> : null}
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
