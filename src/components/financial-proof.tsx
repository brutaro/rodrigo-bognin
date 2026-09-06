"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function FinancialProof({projectId,entryId,versionId,files}:{projectId:string;entryId:string;versionId?:string;files:Array<{id:string;label:string}>}) {
 const router=useRouter();const [selected,setSelected]=useState(versionId ?? "");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 async function save() {
  setBusy(true);setMessage("");
  try {const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/financial-proof`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({entryId,versionId:selected || null,expectedVersionId:versionId ?? null})});const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage(selected ? "Comprovante vinculado." : "Vínculo removido. Arquivo preservado.");router.refresh();}
  catch(error){setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");}finally{setBusy(false);}
 }
 return <form onSubmit={event=>{event.preventDefault();void save();}} className="mt-4 border-t border-[var(--border)] pt-3">
  {versionId && <a href={`/api/files/${versionId}/download`} className="text-sm font-semibold text-[var(--brand)] underline">Baixar comprovante · {files.find(file=>file.id===versionId)?.label ?? "Versão vinculada"}</a>}
  <label className="mt-2 block text-sm">Comprovante<select aria-label={`Comprovante do lançamento ${entryId}`} value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"><option value="">Sem arquivo associado</option>{files.map(file=><option key={file.id} value={file.id}>{file.label}</option>)}</select></label>
  <div className="mt-2 flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || selected===(versionId ?? "")} className="rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--brand)] disabled:opacity-40">{busy ? "Salvando…" : "Salvar vínculo"}</button><span role="status" className="text-sm">{message}</span></div>
  <p className="mt-2 text-xs text-slate-500">{files.length ? "A versão escolhida acompanha a publicação. Vincular um arquivo não valida automaticamente o pagamento." : "Anexe o comprovante em Arquivos do projeto; depois selecione-o aqui."}</p>
 </form>;
}
