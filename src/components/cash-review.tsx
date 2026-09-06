"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CashReview, CoverageState } from "@/lib/cash-domain";
export function CashReviewEditor({projectId,basisHash,review}:{projectId:string;basisHash:string;review:CashReview|null}) {
  const router=useRouter();
  const [coverage,setCoverage]=useState({costs:review?.costs ?? 'nao_conferido',payments:review?.payments ?? 'nao_conferido',reimbursements:review?.reimbursements ?? 'nao_conferido'});
  const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function save(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/cash`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'review',basisHash,revision:review?.revision ?? '0',...coverage,reason})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage('Cobertura registrada.');router.refresh();
    }catch(error){setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.');}finally{setBusy(false);}
  }
  return <details className="mb-6 rounded-lg border border-[var(--border)] bg-white p-5">
    <summary className="cursor-pointer font-semibold text-[var(--brand)]">Conferir cobertura financeira</summary>
    <p className="mt-3 text-sm text-[var(--ink-muted)]">Confira os lançamentos deste projeto com suas fontes, sem duplicar valores. A declaração cobre o projeto inteiro até hoje. Uma alteração nos lançamentos ou comprovantes exige nova conferência.</p>
    <form onSubmit={e=>{e.preventDefault();void save();}} className="mt-4 grid gap-4 sm:grid-cols-3">
      {([['costs','Custos realizados','Não houve custo realizado'],['payments','Saídas de custo','Não houve saída de custo'],['reimbursements','Reembolsos recebidos','Não houve recebimento de reembolso']] as const).map(([key,label,zero])=><label key={key} className="text-sm">{label}<select aria-label={label} disabled={busy} value={coverage[key]} onChange={e=>setCoverage({...coverage,[key]:e.target.value as CoverageState})} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"><option value="nao_conferido">Ainda não conferi</option><option value="completo">Todos os movimentos estão registrados</option><option value="sem_movimento">{zero}</option></select></label>)}
      <label className="text-sm sm:col-span-3">Referência da conferência<input required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>
      <p className="text-xs text-slate-500 sm:col-span-3">“Não houve recebimento” pode coexistir com reembolsos aprovados ainda a receber. Lançamentos sem situação precisam ser confirmados ou desconsiderados. Os registros originais permanecem no histórico.</p>
      <div className="sm:col-span-3"><button disabled={busy} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Salvando…' : 'Salvar conferência financeira'}</button><p role="status" className="mt-2 text-sm">{message}</p></div>
    </form>
  </details>;
}
