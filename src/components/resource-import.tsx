"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConsolidatedSourceUpload } from "./consolidated-source-upload";
import { resourceFields, type ResourceMapping, type ResourceRow, type ResourceDifference } from "@/lib/resource-import-domain";
import { ResourceDifferences } from "./resource-differences";
type Sheet = { name: string; ordinal: number; headers: string[]; count: number; mapping: ResourceMapping };
type Preview = { differences: ResourceDifference[]; resolved?: boolean; id: string; hash: string; count: number; errors: string[]; errorCount: number; sample: ResourceRow[]; totalCents: string; added: number; changed: number; unchanged: number; absent: number };
export function ResourceImport() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [ordinal, setOrdinal] = useState(0);
  const [mapping, setMapping] = useState<ResourceMapping>({});
  const [delimiter, setDelimiter] = useState(";");
  const [preview, setPreview] = useState<Preview>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  async function request(payload: object) {
    const response = await fetch("/api/sources/resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : "Tente novamente."); } finally { setBusy(false); } }
  function choose(index: number, values = sheets) { setOrdinal(index); setMapping(values.find(s => s.ordinal === index)?.mapping ?? {}); setPreview(undefined); setConfirmed(false); }
  const sheet = sheets.find(s => s.ordinal === ordinal);
  return <div className="space-y-6">
    <ConsolidatedSourceUpload enabled real onProtected={receipt => { const next = receipt?.receiptId ?? ""; if (source !== next) { setSource(next); setSheets([]); setPreview(undefined); setConfirmed(false); } }} />
    {source && <section className="rounded-lg border border-[var(--border)] bg-white p-6 space-y-4">
      <h2 className="text-xl font-bold">2. Escolher os dados</h2>
      <label className="block text-sm">Separador, se o arquivo for CSV <select aria-label="Separador CSV" value={delimiter} onChange={e => { setDelimiter(e.target.value); setSheets([]); setPreview(undefined); }} className="ml-3 border p-2"><option value=";">Ponto e vírgula</option><option value=",">Vírgula</option><option value={'\t'}>Tabulação</option></select></label>
      <button disabled={busy} className="rounded-lg bg-[var(--brand)] text-white px-4 py-3 disabled:opacity-50" onClick={() => run(async () => { const values: Sheet[] = await request({ action: "inspect", sourceId: source, delimiter }); setSheets(values); choose(values.find(s => /base tratada/i.test(s.name))?.ordinal ?? values[0].ordinal, values); })}>Ler abas e colunas</button>
      {sheets.length > 0 && <><label className="block">Aba <select aria-label="Aba da planilha" value={ordinal} onChange={e => choose(Number(e.target.value))} className="ml-3 max-w-full border p-2">{sheets.map(s => <option key={s.ordinal} value={s.ordinal}>{s.name} ({s.count} linhas)</option>)}</select></label>
      <p className="text-sm text-[var(--ink-muted)]">Use a aba Base Tratada, com cabeçalhos na primeira linha. Confira o mapeamento abaixo. Datas ou atividades ausentes são preservadas como não informadas. Executor, Curso, Trilha e demais colunas não selecionadas ficam fora da base de trabalho.</p>
      <div className="grid gap-3 sm:grid-cols-2">{resourceFields.map(field => <label key={field.key} className="text-sm font-semibold">{field.label}<select aria-label={field.label} value={mapping[field.key] ?? -1} onChange={e => { setMapping({ ...mapping, [field.key]: Number(e.target.value) }); setPreview(undefined); setConfirmed(false); }} className="mt-1 block w-full border rounded p-2"><option value={-1}>Não importar</option>{sheet?.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}</select></label>)}</div>
      <button disabled={busy} className="rounded-lg bg-[var(--brand)] text-white px-4 py-3 disabled:opacity-50" onClick={() => run(async () => { setPreview(await request({ action: "prepare", sourceId: source, ordinal, mapping, delimiter })); setConfirmed(false); })}>Preparar prévia</button></>}
    </section>}
    {preview && <section className="rounded-lg border border-[var(--border)] bg-white p-6 space-y-4">
      <h2 className="text-xl font-bold">3. Conferir e aplicar</h2>
      <p>{preview.count} linhas válidas · {preview.errorCount} erros</p>
      <p className="text-sm">Novas: {preview.added} · Alteradas: {preview.changed} · Iguais: {preview.unchanged} · Ausentes: {preview.absent}</p>
      <p className="font-semibold">Valor da base: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(preview.totalCents) / 100)}</p>
      {preview.errors.length > 0 && <div role="alert" className="text-red-800">{preview.errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left pb-2">Primeiras {preview.sample.length} linhas da prévia</caption><thead><tr><th>ID</th><th>Projeto</th><th>Data</th><th>Valor</th></tr></thead><tbody>{preview.sample.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.id}</td><td className="p-2">{row.project}</td><td className="p-2 whitespace-nowrap">{row.date || "Não informado"}</td><td className="p-2">{row.amount}</td></tr>)}</tbody></table></div>
      {preview.differences.length > 0 && !preview.errorCount && <ResourceDifferences key={preview.id} differences={preview.differences} busy={busy} onResolve={decisions => void run(async () => { setPreview(await request({action:"resolve",id:preview.id,hash:preview.hash,decisions})); setConfirmed(false); })} />}
      {preview.resolved && <p className="text-sm font-semibold">Suas decisões foram incorporadas. Confira o total final antes de confirmar.</p>}
      <label className="flex gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi a prévia. Esta versão integral passa a ser a base vigente; as decisões conferidas determinam quais registros ficam no recorte atual, e as versões anteriores permanecem no histórico. Medições anteriores, notas, pagamentos, ajustes e publicações são preservados e não serão somados automaticamente à nova base.</label>
      <button disabled={busy || !confirmed || preview.errorCount > 0 || preview.differences.length > 0} className="rounded-lg bg-[var(--brand)] text-white px-4 py-3 disabled:opacity-40" onClick={() => run(async () => { const result = await request({ action: "apply", id: preview.id, hash: preview.hash, confirmed: true }); setMessage(result.reused ? "Esta versão já foi aplicada. Nenhuma duplicação." : "Base aplicada. Os dados já estão disponíveis na visão geral e nos projetos correspondentes."); setPreview(undefined); router.refresh(); })}>Confirmar e aplicar base</button>
    </section>}
    {busy && <p role="status">Processando…</p>}{message && <p role="status" className="border-l-4 border-[#CB5C2B] bg-white p-4">{message}</p>}
  </div>;
}
