"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cashMoney, costConfirmationLabel, type CostConfirmation } from "@/lib/cash-domain";
export function CostConfirmationEditor({projectId,entryId,kind,value,costs}:{projectId:string;entryId:string;kind:string;value?:CostConfirmation;costs:Array<{id:string;description:string;amountCents:string}>}) {
  const router=useRouter();
  const [status,setStatus]=useState(value?.status ?? 'nao_informado');
  const [date,setDate]=useState(value?.effectiveOn ?? '');
  const [costId,setCostId]=useState(value?.costEntryId ?? '');
  const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function save(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/cash`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'confirm',entryId,revision:value?.revision ?? '0',status,effectiveOn:status==='confirmado' ? date : null,costEntryId:status==='confirmado' && kind==='Pagamento' ? costId || null : null,reason})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setMessage('Confirmação salva. Confira a cobertura para atualizar o resultado de caixa.');router.refresh();
    }catch(error){setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.');}finally{setBusy(false);}
  }
  return <details className="mt-4 border-t border-[var(--border)] pt-3">
    <summary className="cursor-pointer text-sm font-semibold text-[var(--brand)]">{costConfirmationLabel(kind,value)}</summary>
    <form onSubmit={event=>{event.preventDefault();void save();}} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Confirmação<select aria-label="Confirmação" value={status} disabled={busy} onChange={e=>setStatus(e.target.value as CostConfirmation['status'])} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"><option value="nao_informado">Situação não informada</option><option value="confirmado">{kind==='Pagamento' ? 'Dinheiro saiu para pagar custo' : 'Custo realizado / incorrido'}</option><option value="revertido">Desconsiderado / revertido</option></select></label>
      {status==='confirmado' && <label className="text-sm">{kind==='Pagamento' ? 'Data da saída' : 'Data do custo realizado'}<input type="date" required value={date} disabled={busy} onChange={e=>setDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>}
      {status==='confirmado' && kind==='Pagamento' && <label className="text-sm sm:col-span-2">Custo pago por este lançamento<select aria-label="Custo pago por este lançamento" value={costId} disabled={busy} onChange={e=>setCostId(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"><option value="">Sem vínculo — não calcula ainda a pagar</option>{costId && !costs.some(c=>c.id===costId) && <option value={costId}>Custo não está mais confirmado — escolha outro ou retire o vínculo</option>}{costs.map(c=><option key={c.id} value={c.id}>{c.description} · {cashMoney(c.amountCents)}</option>)}</select></label>}
      <label className="text-sm sm:col-span-2">Motivo ou referência da confirmação<input required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>
      <p className="text-xs text-slate-500 sm:col-span-2">{kind==='Pagamento' ? 'Confirme somente saída efetiva de dinheiro. Cada pagamento parcial é um lançamento separado, vinculado ao mesmo custo.' : 'Confirmar o custo realizado não registra pagamento. Registre a saída separadamente como Pagamento.'} Para corrigir um valor, desconsidere este lançamento e registre o valor correto. O histórico será preservado.</p>
      <div className="sm:col-span-2"><button disabled={busy} className="rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--brand)] disabled:opacity-40">{busy ? 'Salvando…' : 'Salvar confirmação'}</button><p role="status" className="mt-2 text-sm">{message}</p></div>
    </form>
  </details>;
}
