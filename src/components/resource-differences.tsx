"use client";
import { useState } from "react";
import { resourceFields, type ResourceDifference, type ResourceDecisions } from "@/lib/resource-import-domain";
export function ResourceDifferences({ differences, busy, onResolve }: { differences: ResourceDifference[]; busy: boolean; onResolve: (decisions: ResourceDecisions) => void }) {
  const [decisions, setDecisions] = useState<ResourceDecisions>({});
  const [page, setPage] = useState(0);
  const pageSize = 10;
  return <div className="space-y-4 border-y border-[var(--border)] py-4">
    <h3 className="font-bold">Conferir {differences.length} registros alterados ou ausentes</h3>
    <p className="text-sm">Para cada ID, escolha manter os dados atuais ou usar a nova planilha. Se o ID estiver ausente, usar a planilha retira o registro da base vigente e preserva o histórico.</p>
    <div className="flex flex-wrap gap-3 text-sm"><button type="button" disabled={busy} onClick={() => setDecisions(Object.fromEntries(differences.map(row => [row.id,"incoming"])))} className="rounded border px-3 py-2">Usar planilha em todos</button><button type="button" disabled={busy} onClick={() => setDecisions(Object.fromEntries(differences.map(row => [row.id,"keep"])))} className="rounded border px-3 py-2">Manter atuais em todos</button></div>
    {differences.slice(page*pageSize,(page+1)*pageSize).map(row => <article key={row.id} className="rounded border p-3 text-sm">
      <p className="font-semibold">{row.id} · {row.before.project}{!row.after ? " · Ausente na planilha" : ""}</p>
      <dl className="my-3 space-y-2">{resourceFields.filter(field => field.key !== "id" && (!row.after || row.before[field.key] !== row.after[field.key])).map(field => <div key={field.key}><dt className="font-semibold">{field.label}</dt><dd className="break-words">Atual: {row.before[field.key] || "Não informado"}<br/>Planilha: {row.after ? row.after[field.key] || "Não informado" : "Ausente"}</dd></div>)}</dl>
      <label className="block">Decisão para {row.id}<select disabled={busy} aria-label={`Decisão para ${row.id}`} value={decisions[row.id] ?? ""} onChange={event => setDecisions({...decisions,[row.id]:event.target.value as "keep"|"incoming"})} className="ml-2 rounded border p-2"><option value="" disabled>Escolha</option><option value="keep">Manter atual</option><option value="incoming">{row.after ? "Usar planilha" : "Retirar da base vigente"}</option></select></label>
    </article>)}
    {differences.length>pageSize && <div className="flex items-center gap-4 text-sm"><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>{page+1} de {Math.ceil(differences.length/pageSize)}</span><button disabled={(page+1)*pageSize>=differences.length} onClick={()=>setPage(page+1)}>Próxima</button></div>}
    <button disabled={busy || Object.keys(decisions).length!==differences.length} onClick={()=>onResolve(decisions)} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-sm text-white disabled:opacity-40">Recalcular prévia com minhas decisões</button>
  </div>;
}
