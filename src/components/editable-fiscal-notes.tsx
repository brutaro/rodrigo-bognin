"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import type { FiscalNoteSummary, ProjectOption } from "@/lib/project-repository";
import type { AdjustmentActionState } from "@/lib/source-adjustment-types";

type Note = FiscalNoteSummary & { adjustmentRequestId: string; restoreRequestId: string };
type Action = (state: AdjustmentActionState, data: FormData) => Promise<AdjustmentActionState>;
const initial: AdjustmentActionState = { status: "idle", message: "" };

function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : ""; }
function triState(value: boolean | null) { return value === true ? "yes" : value === false ? "no" : "unknown"; }
function projectTitle(id: string | null, projects: ProjectOption[]) { return id ? projects.find((item) => item.id === id)?.title ?? id : "Não informado"; }

function FiscalHistory({ note }: { note: Note }) {
  if (!note.adjustmentHistory.length) return null;
  return <details className="mt-3 rounded-lg border border-slate-200 p-3 text-xs"><summary className="cursor-pointer font-bold text-slate-800">Cadeia completa antes/depois ({note.adjustmentHistory.length})</summary>
    <ol className="mt-3 space-y-3">{note.adjustmentHistory.map((item) => <li key={item.revision} className="border-l-2 border-blue-200 pl-3">
      <strong>Revisão {item.revision} · {item.operation === "restore" ? "restauração" : "ajuste"}</strong>
      <span className="block"><b>Antes:</b> {item.before}</span><span className="block"><b>Depois:</b> {item.after}</span>
      <span className="block">{item.actor} · {dateTime(item.adjustedAt)} · Motivo: {item.reason}</span>
    </li>)}</ol>
  </details>;
}

function Feedback({ state }: { state: AdjustmentActionState }) {
  const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (state.status !== "idle") ref.current?.focus(); }, [state.status]);
  if (state.status === "idle") return null;
  return <div ref={ref} tabIndex={-1} role={state.status === "saved" ? "status" : "alert"} aria-live="polite" className={`mt-3 rounded-lg p-3 text-xs ${state.status === "saved" ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}><strong>{state.message}</strong>{state.status === "conflict" ? <p className="mt-1">A revisão atual é {state.currentRevision}. {state.currentSummary ?? "Recarregue para comparar todos os campos."} Os valores enviados continuam no formulário para comparação.</p> : null}</div>;
}

function ProjectSelect({ name, value, projects }: { name: string; value: string | null; projects: ProjectOption[] }) {
  return <select name={name} defaultValue={value ?? ""} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal"><option value="">Não informado</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>;
}

function Editor({ note, projects, saveAction, restoreAction }: { note: Note; projects: ProjectOption[]; saveAction: Action; restoreAction: Action }) {
  const [saveState, submitSave, pending] = useActionState(saveAction, initial);
  const [restoreState, submitRestore, restorePending] = useActionState(restoreAction, initial);
  return <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-bold text-[var(--brand)]">Editar linha completa</summary>
    <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-2"><div><strong className="block">Auditoria importada</strong><span>{note.source.year} · {note.source.number} · {note.source.issueDate}</span><span className="block">{note.source.amount} · {note.source.category ?? "Sem categoria"}</span><span className="block">Declarado: {projectTitle(note.source.declaredProjectId, projects)}</span><span className="block">Candidato: {projectTitle(note.source.candidateProjectId, projects)}</span></div><div><strong className="block text-blue-900">{note.adjustmentOperation === "restore" ? "Restaurado para a auditoria importada" : note.adjusted ? "Ajustado por Rodrigo" : "Efetivo sem ajuste"}</strong><span>{note.year} · {note.number} · {note.issueDate}</span><span className="block">{note.amount} · {note.category}</span><span className="block">Declarado: {note.declaredProject ?? "Não informado"}</span><span className="block">Candidato: {note.candidateProject ?? "Não informado"}</span></div></div>
    <FiscalHistory note={note} />
    {note.adjusted ? <p className="mt-3 text-xs leading-5 text-slate-600">Revisão {note.adjustmentRevision} · {note.adjustedBy} · {dateTime(note.adjustedAt)}<br />Motivo: {note.adjustmentReason}</p> : null}
    <form action={submitSave} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <input type="hidden" name="fiscalNoteId" value={note.id} /><input type="hidden" name="expectedRevision" value={note.adjustmentRevision} /><input type="hidden" name="requestId" value={note.adjustmentRequestId} />
      <label className="text-xs font-bold">Ano<input name="issueYear" inputMode="numeric" defaultValue={note.year} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">NFS-e<input name="number" defaultValue={note.number} maxLength={100} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Emissão<input type="date" name="issueDate" defaultValue={note.issueDate} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Valor bruto<input name="amount" inputMode="decimal" defaultValue={note.amount} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Categoria<input name="category" defaultValue={note.categoryValue ?? ""} maxLength={200} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Projeto declarado<ProjectSelect name="declaredProjectId" value={note.declaredProjectId} projects={projects} /></label>
      <label className="text-xs font-bold">Projeto candidato auditado<ProjectSelect name="candidateProjectId" value={note.candidateProjectId} projects={projects} /></label>
      <label className="text-xs font-bold">Força<input name="strength" defaultValue={note.relationStrength} maxLength={100} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Estado<input name="relationState" defaultValue={note.relationState} maxLength={100} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Critério<input name="criterion" defaultValue={note.criterion ?? ""} maxLength={500} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Valor integral elegível<select name="fullValueEligible" defaultValue={triState(note.fullValueEligible)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal"><option value="unknown">Não avaliado</option><option value="no">Não</option><option value="yes">Sim</option></select></label>
      <label className="text-xs font-bold">Valor relacionado<input name="verifiedRelatedValue" inputMode="decimal" defaultValue={note.verifiedRelatedValueDecimal ?? ""} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold sm:col-span-2 xl:col-span-3">Motivo<input name="reason" minLength={3} maxLength={500} required className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" /></label>
      <label className="flex items-start gap-2 text-xs sm:col-span-2 xl:col-span-3"><input type="checkbox" name="confirmDuplicate" value="yes" className="mt-0.5" />Confirmo manter ano e número iguais aos de outra NFS-e, se houver duplicidade.</label>
      <button disabled={pending} className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-end xl:col-span-3">{pending ? "Salvando…" : "Salvar revisão fiscal"}</button><div className="sm:col-span-2 xl:col-span-3"><Feedback state={saveState} /></div>
    </form>
    {note.adjusted && note.adjustmentOperation !== "restore" ? <form action={submitRestore} className="mt-4 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[1fr_auto] sm:items-end"><input type="hidden" name="fiscalNoteId" value={note.id} /><input type="hidden" name="expectedRevision" value={note.adjustmentRevision} /><input type="hidden" name="requestId" value={note.restoreRequestId} /><label className="text-xs font-bold text-amber-950">Motivo da restauração<input name="reason" minLength={3} maxLength={500} required className="mt-1 h-10 w-full rounded-lg border border-amber-300 bg-white px-2 text-sm font-normal" /></label><button disabled={restorePending} className="h-10 rounded-lg border border-amber-400 bg-white px-4 text-sm font-bold text-amber-950">{restorePending ? "Restaurando…" : "Restaurar importado"}</button><label className="text-xs sm:col-span-2"><input type="checkbox" name="confirmDuplicate" value="yes" className="mr-2" />Confirmo eventual duplicidade da fonte.</label><div className="sm:col-span-2"><Feedback state={restoreState} /></div></form> : null}
  </details>;
}

function Summary({ note }: { note: Note }) { return <><p className="font-semibold">{note.year} · {note.number}</p><p className="text-xs text-slate-500">{note.issueDate} · {note.id}</p>{note.adjusted ? <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-900">{note.adjustmentOperation === "restore" ? "Restaurado" : "Ajustado por Rodrigo"} · rev. {note.adjustmentRevision}</span> : <span className="mt-1 inline-block text-xs text-slate-500">Auditoria importada</span>}</>; }

export function EditableFiscalNotes({ notes, projects, saveAction, restoreAction }: { notes: Note[]; projects: ProjectOption[]; saveAction: Action; restoreAction: Action }) {
  return <section className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
    <div className="hidden lg:block"><table className="w-full table-fixed text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-[16%] px-4 py-3">NFS-e</th><th className="w-[14%] px-4 py-3">Valor</th><th className="w-[19%] px-4 py-3">Projetos</th><th className="w-[19%] px-4 py-3">Relação</th><th className="w-[32%] px-4 py-3">Revisão auditável</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{notes.map((note) => <tr key={note.id}><td className="px-4 py-4 align-top"><Summary note={note} /></td><td className="px-4 py-4 align-top"><strong>{note.amount}</strong><span className="block text-xs text-slate-500">{note.category}</span></td><td className="px-4 py-4 align-top text-xs"><strong>Declarado:</strong> {note.declaredProject ? <Link href={`/projetos/${encodeURIComponent(note.declaredProjectId ?? "")}`} className="text-[var(--brand)] hover:underline">{note.declaredProject}</Link> : "Não informado"}<span className="mt-1 block"><strong>Candidato:</strong> {note.candidateProject ?? "Não informado"}</span></td><td className="px-4 py-4 align-top"><strong>{note.relationStrength}</strong><span className="block text-xs text-slate-500">{note.relationState}</span></td><td className="px-4 py-4 align-top"><Editor note={note} projects={projects} saveAction={saveAction} restoreAction={restoreAction} /></td></tr>)}</tbody></table></div>
    <div className="divide-y divide-[var(--border)] lg:hidden">{notes.map((note) => <article key={note.id} className="p-4"><Summary note={note} /><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-slate-500">Valor e categoria</dt><dd className="font-semibold">{note.amount} · {note.category}</dd></div><div><dt className="text-slate-500">Projeto declarado</dt><dd>{note.declaredProject ? <Link href={`/projetos/${encodeURIComponent(note.declaredProjectId ?? "")}`} className="text-[var(--brand)] hover:underline">{note.declaredProject}</Link> : "Não informado"}</dd></div><div><dt className="text-slate-500">Relação auditada</dt><dd>{note.candidateProject ?? "Sem candidato"} · {note.relationStrength} · {note.relationState}</dd></div></dl><div className="mt-4"><Editor note={note} projects={projects} saveAction={saveAction} restoreAction={restoreAction} /></div></article>)}</div>
    {!notes.length ? <p className="p-8 text-center text-sm text-slate-500">Notas fiscais disponíveis após a carga PostgreSQL local.</p> : null}
  </section>;
}
