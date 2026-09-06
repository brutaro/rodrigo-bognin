"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reimbursementLabels, reimbursementLabel, type ReimbursementStatus } from "@/lib/reimbursement-status";
export function ReimbursementEditor({projectId,entryId,value}:{projectId:string;entryId:string;value?:ReimbursementStatus}) {
  const router=useRouter();
  const [status,setStatus]=useState<ReimbursementStatus["status"]>(value?.status ?? "nao_informado");
  const [receivedOn,setReceivedOn]=useState(value?.receivedOn ?? "");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function save() {
    setBusy(true);setMessage("");
    try {
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/reimbursement`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({entryId,status,receivedOn:status==='recebido_confirmado' ? receivedOn : null,revision:value?.revision ?? "0",reason})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setMessage("Situação registrada no histórico.");router.refresh();
    } catch(error){setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");} finally {setBusy(false);}
  }
  return <details className="mt-4 border-t border-[var(--border)] pt-3">
    <summary className="cursor-pointer text-sm font-semibold text-[var(--brand)]">Reembolso: {reimbursementLabel(value)}</summary>
    <form onSubmit={event=>{event.preventDefault();void save();}} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Situação<select value={status} disabled={busy} onChange={event=>setStatus(event.target.value as ReimbursementStatus['status'])} className="mt-1 block w-full rounded-lg border border-slate-300 p-2">{Object.entries(reimbursementLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {status==='recebido_confirmado' && <label className="text-sm">Data do recebimento<input type="date" required value={receivedOn} disabled={busy} onChange={event=>setReceivedOn(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>}
      <label className="text-sm sm:col-span-2">Motivo ou referência da confirmação<input required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>
      <p className="text-xs text-slate-500 sm:col-span-2">O estado vale para o valor integral deste lançamento. Para recebimento parcial, retire a classificação do lançamento integral e registre as parcelas separadamente. Para desfazer uma confirmação, selecione a situação correta e informe o motivo; o histórico será preservado.</p>
      <div className="sm:col-span-2"><button disabled={busy} className="rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--brand)] disabled:opacity-40">{busy ? "Salvando…" : "Salvar situação"}</button><p role="status" className="mt-2 text-sm">{message}</p></div>
    </form>
  </details>;
}
