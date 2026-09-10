import { ownerDisplay } from "@/lib/owner-display";
import { currentResources } from "@/lib/resource-import";
import { projectExecutors } from "@/lib/resource-import-domain";
import {ContractEditor} from "@/components/contract-editor";
import {ContractSummary} from "@/components/contract-summary";
import { ReimbursementEditor } from "@/components/reimbursement-status";
import { FinancialProof } from "@/components/financial-proof";
import { CashSummary } from "@/components/cash-summary";
import { CashReviewEditor } from "@/components/cash-review";
import { CostConfirmationEditor } from "@/components/cost-confirmation";
import { NarrativeEditor } from "@/components/narrative-editor";
import { ProjectSettings } from "@/components/project-settings";
import { ResourceSummary } from "@/components/resource-summary";
import { requireAuthenticatedPage } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ActivityPagination, activityPageSize, normalizeActivityPage } from "@/components/activity-pagination";
import { Notice } from "@/components/notice";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { ProjectFiles } from "@/components/project-files";
import { ProjectEvidence } from "@/components/project-evidence";
import { EditableActivityTable } from "@/components/editable-activity-table";
import { getProjectDetails } from "@/lib/project-repository";
import { isDatabaseConfigured } from "@/lib/database";
import { listProjectFiles } from "@/lib/file-repository";
import {
  financialOrigins,
  formatBrlFromCents,
  manualFinancialKinds,
  listProjectPublications,
  readProjectDraft,
} from "@/lib/workspace";
import { addFinancialEntryAction, restoreActivityAction, saveActivityAdjustmentAction, editProjectAction } from "./actions";

export const dynamic = "force-dynamic";

function displayDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projetos/[id]">) {
  await requireAuthenticatedPage();
  const { id } = await params;
  const localData = isDatabaseConfigured();
  const project = await getProjectDetails(id);
  if (!project) notFound();
  const executors = localData ? projectExecutors((await currentResources())?.rows ?? [], project.sourceName ?? project.name) : [];
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const draft = await readProjectDraft(project.id);
  const storedFiles = localData ? await listProjectFiles(project.id) : [];
  const proofFiles = storedFiles.filter(file=>file.status==="active").flatMap(file=>file.versions.filter(version=>version.status==="active").map(version=>({id:version.id,label:`${file.title} · V${version.version}`})));
  const latestPublication = (await listProjectPublications(project.id))[0];
  const addFinancialEntry = addFinancialEntryAction.bind(null, project.id);
  const financialRequestId = randomUUID();
  const activityPage = normalizeActivityPage(typeof query.activityPage === "string" ? query.activityPage : undefined, project.activities.length);
  const activityStart = (activityPage - 1) * activityPageSize;
  const visibleActivities = project.activities.slice(activityStart, activityStart + activityPageSize).map((activity) => ({
    ...activity, adjustmentRequestId: randomUUID(), restoreRequestId: randomUUID(),
  }));
  const saveActivityAdjustment = saveActivityAdjustmentAction.bind(null, project.id);
  const restoreActivity = restoreActivityAction.bind(null, project.id);

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
                {draft.updatedAt ? `Salvo em ${displayDate(draft.updatedAt)}` : localData ? "Ainda sem alterações locais" : "Ainda sem alterações demonstrativas"}
              </p>
            </div>
            <div className="flex flex-wrap flex-col items-stretch gap-2 sm:flex-row">
              {localData ? <Link href={`/projetos/${encodeURIComponent(project.id)}/importar-planilha`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--brand)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand)]">Importar planilha neste projeto</Link> : null}
              {localData ? <a href={`/api/reports/projects/${encodeURIComponent(project.id)}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Baixar relatório PDF</a> : null}
              {latestPublication ? <Link href={`/publicacoes/${latestPublication.id}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100">Ver publicação V{latestPublication.version}</Link> : null}
              <Link href={`/projetos/${project.id}/conferir`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-blue-900">Ver como ficará</Link>
            </div>
          </div>
          {localData ? <ProjectSettings title={project.name} start={project.periodStart} end={project.periodEnd} archived={Boolean(project.archived)} revision={project.metadataRevision ?? "0"} action={editProjectAction.bind(null, project.id)} /> : null}
        </section>

        {executors.length > 0 && <section aria-label="Executores" className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-5"><h2 className="text-lg font-bold">Executores</h2><ul className="mt-2 flex flex-wrap gap-3">{executors.map(name => <li key={name} className="rounded-lg bg-slate-50 px-3 py-2">{name}</li>)}</ul></section>}
        <ResourceSummary projectId={project.id} projectTitle={project.sourceName ?? project.name} />
        <ContractSummary contract={draft.contract} /><ContractEditor key={draft.contract?.revision??"0"} projectId={project.id} contract={draft.contract} />
        {draft.cash && <><CashSummary result={draft.cash} /><CashReviewEditor key={`${draft.cash.sourceHash}-${draft.cash.review?.revision ?? "0"}`} projectId={project.id} basisHash={draft.cash.sourceHash} review={draft.cash.review} /></>}

        <div className="mt-6"><Notice code={notice} /></div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.9fr)]">
          <div className="space-y-6">
            <section aria-labelledby="narrative-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5">
                <h2 id="narrative-title" className="text-lg font-bold text-[var(--ink)]">O que foi feito</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Escreva em primeira pessoa. O texto é salvo automaticamente após uma pausa na digitação.</p>
              </div>
              <NarrativeEditor key={project.id} projectId={project.id} initialText={draft.narrative} initialRevision={draft.revision ?? "0"} />
            </section>

            <section aria-labelledby="activities-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5">
                <h2 id="activities-title" className="text-lg font-bold text-[var(--ink)]">Atividades e medições</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Os valores medidos não são tratados como pagamentos. Mostrando {visibleActivities.length ? activityStart + 1 : 0}–{activityStart + visibleActivities.length} de {project.activities.length}.</p>
              </div>
              {localData ? <EditableActivityTable activities={visibleActivities} saveAction={saveActivityAdjustment} restoreAction={restoreActivity} /> : (
                <div className="divide-y divide-[var(--border)]">{visibleActivities.map((activity) => <article key={activity.id} className="p-5"><strong>{activity.description}</strong><p className="mt-1 text-sm text-slate-600">{activity.bm} · {activity.hours} · {activity.measuredValue}</p></article>)}</div>
              )}
              <ActivityPagination basePath={`/projetos/${encodeURIComponent(project.id)}`} page={activityPage} total={project.activities.length} />
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
                      <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">{ownerDisplay(reference.kind)}</p><h3 className="mt-1 font-semibold text-[var(--ink)]">{reference.label}</h3><p className="mt-1 text-xs text-slate-500">Origem importada · {reference.id}</p></div>
                      <p className="text-lg font-bold text-[var(--ink)]">{reference.amount}</p>
                    </div>
                    <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-slate-500">Base do vínculo</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.relationBasis ?? "Não informada"}</dd></div>
                      <div><dt className="text-xs text-slate-500">Relação auditada</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.relation}</dd></div>
                      <div><dt className="text-xs text-slate-500">Valor relacionado verificado</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.relatedAmount ?? "Não informado"}</dd></div>
                      <div><dt className="text-xs text-slate-500">Valor integral elegível</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.fullValueEligible === true ? "Sim" : reference.fullValueEligible === false ? "Não" : "Não avaliado"}</dd></div>
                      <div><dt className="text-xs text-slate-500">Pagamento</dt><dd className="mt-1 text-sm font-semibold text-slate-700">{reference.payment}</dd></div>
                    </dl>
                  </article>
                ))}
                {draft.manualFinancialEntries.map((entry) => (
                  <article key={entry.id} className="border-l-4 border-l-[#CB5C2B] p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-blue-800">{entry.kind}</p><h3 className="mt-1 font-semibold text-[var(--ink)]">{entry.description}</h3><p className="mt-1 text-xs text-slate-500">{ownerDisplay(entry.origin)} · {entry.documentState}</p></div>
                      <p className="text-lg font-bold text-[var(--ink)]">{formatBrlFromCents(entry.amountCents)}</p>
                    </div>
                    {localData && ["Custo ou valor do projeto","Pagamento"].includes(entry.kind) && <CostConfirmationEditor key={`${entry.id}-cost-${entry.confirmation?.revision ?? "0"}`} projectId={project.id} entryId={entry.id} kind={entry.kind} value={entry.confirmation} costs={draft.manualFinancialEntries.filter(e=>e.kind==="Custo ou valor do projeto" && e.confirmation?.status==="confirmado").map(e=>({id:e.id,description:e.description,amountCents:e.amountCents}))} />}
                    {localData && entry.kind === "Reembolso" && <ReimbursementEditor key={`${entry.id}-reembolso-${entry.reimbursement?.revision ?? "0"}`} projectId={project.id} entryId={entry.id} value={entry.reimbursement} />}
                    {localData ? <FinancialProof key={`${entry.id}-${entry.proofVersionId ?? "none"}`} projectId={project.id} entryId={entry.id} versionId={entry.proofVersionId} files={proofFiles} /> : null}
                  </article>
                ))}
                {!project.financialReferences.length && !draft.manualFinancialEntries.length ? <p className="p-5 text-sm text-[var(--ink-muted)]">Nenhum valor registrado.</p> : null}
              </div>

              <details className="border-t border-[var(--border)] p-5">
                <summary className="cursor-pointer text-sm font-bold text-[var(--brand)]">Adicionar valor</summary>
                <form action={addFinancialEntry} className="mt-5 grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="requestId" value={financialRequestId} />
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
                      {financialOrigins.map((origin) => <option key={origin} value={origin}>{ownerDisplay(origin)}</option>)}
                    </select>
                  </label>
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Após registrar, confirme o que o valor representa e vincule o comprovante. Para pagamento parcial, registre somente o valor efetivamente pago nesta parcela.</p>
                  <div className="sm:col-span-2 sm:justify-self-end"><SubmitButton idleLabel="Registrar valor" pendingLabel="Registrando…" /></div>
                </form>
              </details>
            </section>
          </div>

          <aside className="space-y-6">
            {localData ? <ProjectFiles projectId={project.id} documents={storedFiles} proofVersionIds={draft.manualFinancialEntries.flatMap(entry=>entry.proofVersionId ? [entry.proofVersionId] : [])} /> : (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">O cofre exige PostgreSQL e o volume local íntegro.</section>
            )}

            <ProjectEvidence projectId={project.id} evidence={project.evidence} />

            <section aria-labelledby="history-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] p-5"><h2 id="history-title" className="text-lg font-bold text-[var(--ink)]">Histórico</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Quem registrou, o que mudou e quando.</p></div>
              {draft.history.length ? (
                <ol className="divide-y divide-[var(--border)]">
                  {draft.history.slice(0, 8).map((event) => (
                    <li key={event.id} className="p-5"><p className="text-sm font-semibold text-[var(--ink)]">{event.action}</p><p className="mt-1 text-xs leading-5 text-slate-500">{ownerDisplay(event.detail)}</p><p className="mt-2 text-xs text-slate-500">{ownerDisplay(event.actor)} · {displayDate(event.occurredAt)}</p></li>
                  ))}
                </ol>
              ) : <p className="p-5 text-sm text-[var(--ink-muted)]">{localData ? "Nenhuma alteração local registrada." : "Nenhuma alteração demonstrativa registrada."}</p>}
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
