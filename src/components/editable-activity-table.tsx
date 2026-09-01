"use client";

import { useActionState, useEffect, useRef } from "react";
import type { AdjustmentActionState } from "@/lib/source-adjustment-types";

type ActivityRow = {
  id: string; description: string; bm: string; hours: string; measuredValue: string;
  sourceHours?: string; sourceMeasuredValue?: string; adjustmentRevision?: string; adjusted?: boolean;
  adjustmentOperation?: "adjust" | "restore" | null; adjustmentReason?: string | null; adjustedBy?: string | null; adjustedAt?: string | null;
  adjustmentRequestId: string; restoreRequestId: string;
};

type Action = (state: AdjustmentActionState, formData: FormData) => Promise<AdjustmentActionState>;
const initial: AdjustmentActionState = { status: "idle", message: "" };

function dateTime(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function ActionFeedback({ state }: { state: AdjustmentActionState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.status !== "idle") ref.current?.focus(); }, [state.status]);
  if (state.status === "idle") return null;
  return <div ref={ref} tabIndex={-1} role={state.status === "saved" ? "status" : "alert"} aria-live="polite"
    className={`mt-3 rounded-lg p-3 text-xs ${state.status === "saved" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>
    <strong>{state.message}</strong>
    {state.status === "conflict" ? <p className="mt-1">Atual: revisão {state.currentRevision}, horas {state.currentHours ?? "—"}, medição {state.currentMeasuredValue ?? "—"}. Reabra a página e compare antes de tentar novamente.</p> : null}
  </div>;
}

function Editor({ activity, saveAction, restoreAction }: { activity: ActivityRow; saveAction: Action; restoreAction: Action }) {
  const [saveState, submitSave, savePending] = useActionState(saveAction, initial);
  const [restoreState, submitRestore, restorePending] = useActionState(restoreAction, initial);
  const effectiveHoursPresent = activity.hours !== "Não informado";
  const effectiveMeasurementPresent = activity.measuredValue !== "Não informado";
  return <div className="space-y-4">
    <div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-2">
      <div><strong className="block text-slate-700">Auditoria importada</strong><span>Horas: {activity.sourceHours ?? activity.hours}</span><span className="block">Medição: {activity.sourceMeasuredValue ?? activity.measuredValue}</span></div>
      <div><strong className="block text-blue-900">{activity.adjustmentOperation === "restore" ? "Restaurado para a auditoria importada" : activity.adjusted ? "Ajustado por Rodrigo" : "Efetivo sem ajuste"}</strong><span>Horas: {activity.hours}</span><span className="block">Medição: {activity.measuredValue}</span></div>
    </div>
    {activity.adjusted ? <p className="text-xs leading-5 text-slate-600">Revisão {activity.adjustmentRevision} · {activity.adjustedBy} · {dateTime(activity.adjustedAt)}<br />Motivo: {activity.adjustmentReason}</p> : null}
    <form action={submitSave} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
      <input type="hidden" name="activityId" value={activity.id} /><input type="hidden" name="expectedRevision" value={activity.adjustmentRevision ?? "0"} /><input type="hidden" name="requestId" value={activity.adjustmentRequestId} />
      <fieldset><legend className="text-xs font-bold text-slate-700">Horas efetivas</legend><label className="mr-3 text-xs"><input type="radio" name="hoursMode" value="present" defaultChecked={effectiveHoursPresent} /> Informadas</label><label className="text-xs"><input type="radio" name="hoursMode" value="missing" defaultChecked={!effectiveHoursPresent} /> Ausentes</label><input name="hours" defaultValue={effectiveHoursPresent ? activity.hours : ""} placeholder="Ex.: 30:15" className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></fieldset>
      <fieldset><legend className="text-xs font-bold text-slate-700">Medição efetiva</legend><label className="mr-3 text-xs"><input type="radio" name="measurementMode" value="present" defaultChecked={effectiveMeasurementPresent} /> Informada</label><label className="text-xs"><input type="radio" name="measurementMode" value="missing" defaultChecked={!effectiveMeasurementPresent} /> Ausente</label><input name="measurement" defaultValue={effectiveMeasurementPresent ? activity.measuredValue : ""} placeholder="Ex.: -125,50" className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></fieldset>
      <label className="text-xs font-bold text-slate-700 sm:col-span-2">Motivo do ajuste<input name="reason" minLength={3} maxLength={500} required className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal" /></label>
      <button disabled={savePending} className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-end">{savePending ? "Salvando…" : "Salvar ajuste"}</button>
      <div className="sm:col-span-2"><ActionFeedback state={saveState} /></div>
    </form>
    {activity.adjusted && activity.adjustmentOperation !== "restore" ? <form action={submitRestore} className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="activityId" value={activity.id} /><input type="hidden" name="expectedRevision" value={activity.adjustmentRevision ?? "0"} /><input type="hidden" name="requestId" value={activity.restoreRequestId} />
      <label className="text-xs font-bold text-amber-950">Motivo da restauração<input name="reason" minLength={3} maxLength={500} required className="mt-2 h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm font-normal" /></label>
      <button disabled={restorePending} className="h-10 rounded-lg border border-amber-400 bg-white px-4 text-sm font-bold text-amber-950 disabled:opacity-60">{restorePending ? "Restaurando…" : "Restaurar importado"}</button>
      <div className="sm:col-span-2"><ActionFeedback state={restoreState} /></div>
    </form> : null}
  </div>;
}

export function EditableActivityTable({ activities, saveAction, restoreAction }: { activities: ActivityRow[]; saveAction: Action; restoreAction: Action }) {
  return <>
    <div className="hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Atividade</th><th className="px-5 py-3">BM</th><th className="px-5 py-3">Valores e edição auditável</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{activities.map((activity) => <tr key={activity.id}><td className="w-1/4 px-5 py-4 align-top"><strong className="block">{activity.description}</strong><span className="text-xs text-slate-500">{activity.id}</span></td><td className="px-5 py-4 align-top">{activity.bm}</td><td className="px-5 py-4"><Editor activity={activity} saveAction={saveAction} restoreAction={restoreAction} /></td></tr>)}</tbody></table></div>
    <div className="divide-y divide-[var(--border)] md:hidden">{activities.map((activity) => <article key={activity.id} className="p-4"><p className="font-semibold">{activity.description}</p><p className="mt-1 text-xs text-slate-500">{activity.bm} · {activity.id}</p><div className="mt-4"><Editor activity={activity} saveAction={saveAction} restoreAction={restoreAction} /></div></article>)}</div>
  </>;
}
