"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmConsolidatedPreviewAction, inspectConsolidatedSourceAction, prepareConsolidatedSourceAction, reopenConsolidatedPreviewAction } from "@/app/fontes/base-consolidada/actions";
import type { CsvParseOptions, Preview, PreviewConfirmation, RegistrySelection, SheetSelection, SourceInspection } from "@/modules/source-ledger/public";
import { ConsolidatedSourceReconciliation } from "./consolidated-source-reconciliation";

const registry: RegistrySelection = { schemaId: "synthetic-source-schema-v1", parserProfileId: "synthetic-safe-v1", transformationId: "remove-course-track-v1", limitsProfileId: "synthetic-safe-v1" };
const defaults: CsvParseOptions = { encoding: "utf-8", delimiter: ",", quote: '"', escape: "double-quote", allowMultilineQuotedField: false };
const control = "mt-1 block min-w-0 max-w-full w-full rounded-lg border border-slate-300 p-2";
const button = "rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300";
export const PREVIEW_PAGE_SIZE = 50;

export function paginatePreviewRows<T>(rows: T[], page: number) {
  const safePage = Math.max(0, Math.floor(page));
  return rows.slice(safePage * PREVIEW_PAGE_SIZE, (safePage + 1) * PREVIEW_PAGE_SIZE);
}

export function ConsolidatedSourcePreparation({ enabled, receiptId, sourceFormat }: { enabled: boolean; receiptId?: string; sourceFormat?: "XLS" | "XLSX" | "CSV" }) {
  const [inspection, setInspection] = useState<SourceInspection | null>(null);
  const [sheet, setSheet] = useState<SheetSelection>();
  const [csvOptions, setCsvOptions] = useState(defaults);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState<PreviewConfirmation | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const keys = useRef({ prepare: "", confirm: "" });
  const functionalHeaders = useMemo(() => (inspection?.headers ?? []).filter((h) => !["curso", "trilha"].includes(h.normalizedLabel)), [inspection]);
  const ready = Boolean(enabled && receiptId && sourceFormat);
  const storageKey = `tria-source-preview:${receiptId}`;

  function forgetPreview() {
    generation.current++;
    setPreview(null); setConfirmation(null); setReviewed(false); setBusy(false);
    setPage(0);
    keys.current = { prepare: `prepare-${crypto.randomUUID()}`, confirm: `confirm-${crypto.randomUUID()}` };
    try { sessionStorage.removeItem(storageKey); } catch { setMessage("Armazenamento local indisponível; continue nesta página."); }
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const current = generation.current;
    void (async () => {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (!saved) return;
        const { previewId, confirmation: savedConfirmation } = JSON.parse(saved);
        const result = await reopenConsolidatedPreviewAction({ previewId });
        if (cancelled || current !== generation.current) return;
        if (!result.ok) { setMessage(result.error.message); sessionStorage.removeItem(storageKey); return; }
        const restored = result.data;
        const inspected = await inspectConsolidatedSourceAction({ sourceFileId: receiptId, registry: restored.registry, ...(restored.csvParseOptions ? { csvParseOptions: restored.csvParseOptions } : { sheetSelection: restored.sheetSelection }) });
        if (cancelled || current !== generation.current) return;
        if (!inspected.ok) { setMessage(inspected.error.message); return; }
        setInspection(inspected.data); setSheet(restored.sheetSelection); setCsvOptions(restored.csvParseOptions ?? defaults);
        setMapping(Object.fromEntries(restored.contract.headerMapping.map((m) => [m.sourceHeaderId, m.logicalFieldId])));
        setPreview(restored); setPage(0);
        if (savedConfirmation) {
          const confirmed = await confirmConsolidatedPreviewAction({ ...confirmationPayload(restored), idempotencyKey: savedConfirmation });
          if (!cancelled && current === generation.current && confirmed.ok) { setConfirmation(confirmed.data); setReviewed(true); }
        }
        if (!cancelled && current === generation.current) setMessage("Prévia e contrato reabertos dentro do prazo de retenção.");
      } catch { if (!cancelled) setMessage("Não foi possível restaurar a prévia. Inspecione a fonte novamente; o armazenamento local pode estar indisponível."); }
    })();
    return () => { cancelled = true; };
  }, [ready, receiptId, storageKey]);

  async function inspect(selected?: SheetSelection) {
    if (!ready || !receiptId) return;
    forgetPreview(); setInspection(null); setMapping({}); setSheet(selected);
    const current = generation.current;
    setBusy(true); setMessage("Inspecionando a estrutura passivamente…");
    try {
      const result = await inspectConsolidatedSourceAction({ sourceFileId: receiptId, registry, ...(sourceFormat === "CSV" ? { csvParseOptions: csvOptions } : selected ? { sheetSelection: selected } : {}) });
      if (current !== generation.current) return;
      if (result.ok) { setInspection(result.data); setMessage(sourceFormat === "CSV" || selected ? "Mapeie cada coluna funcional para continuar." : "Escolha explicitamente uma única aba."); }
      else setMessage(`${result.error.message} (${result.error.code})`);
    } catch { if (current === generation.current) setMessage("Não foi possível inspecionar a fonte. Tente novamente."); }
    finally { if (current === generation.current) setBusy(false); }
  }

  function changeCsv(next: CsvParseOptions) { forgetPreview(); setCsvOptions(next); setInspection(null); setMapping({}); setMessage("Opções alteradas. Inspecione novamente para validar o contrato."); }

  async function prepare() {
    if (!receiptId || !inspection || (sourceFormat !== "CSV" && !sheet)) return;
    const current = generation.current;
    keys.current.prepare ||= `prepare-${crypto.randomUUID()}`;
    setBusy(true); setMessage("Preparando staging e prévia…");
    try {
      const result = await prepareConsolidatedSourceAction({ idempotencyKey: keys.current.prepare, sourceFileId: receiptId, registry, ...(sourceFormat === "CSV" ? { csvParseOptions: csvOptions } : { sheetSelection: sheet }), mappingSelections: functionalHeaders.flatMap((h) => mapping[h.headerId] ? [{ sourceHeaderId: h.headerId, sourceOrdinal: h.ordinal, logicalFieldId: mapping[h.headerId] }] : []) });
      if (current !== generation.current) return;
      if (result.ok) {
        setPreview(result.data.preview); setPage(0); setReviewed(false); setConfirmation(null); keys.current.confirm = `confirm-${crypto.randomUUID()}`;
        try { sessionStorage.setItem(storageKey, JSON.stringify({ previewId: result.data.preview.previewId })); } catch { setMessage("Prévia preparada; armazenamento local indisponível."); return; }
        setMessage(result.data.reused ? "Prévia reaberta de forma idempotente." : "Prévia preparada para conferência.");
      } else setMessage(`${result.error.message} (${result.error.code})`);
    } catch { if (current === generation.current) setMessage("Não foi possível preparar a prévia. Tente novamente."); }
    finally { if (current === generation.current) setBusy(false); }
  }

  function confirmationPayload(p: Preview) {
    return { batchId: p.batchId, sourceFormat: p.sourceFormat, contentHash: p.contentHash, rowResultHash: p.rowResultHash, previewId: p.previewId, sourceFileId: p.sourceFileId, fileVersionId: p.fileVersionId, sourceSha256: p.sourceSha256, contractHash: p.contractHash, transformationHash: p.transformationHash, previewHash: p.previewHash };
  }
  async function confirm() {
    if (!preview || !reviewed) return;
    const current = generation.current;
    keys.current.confirm ||= `confirm-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const result = await confirmConsolidatedPreviewAction({ idempotencyKey: keys.current.confirm, ...confirmationPayload(preview) });
      if (current !== generation.current) return;
      if (result.ok) {
        setConfirmation(result.data); setMessage("Prévia confirmada. Conferência registrada.");
        try { sessionStorage.setItem(storageKey, JSON.stringify({ previewId: preview.previewId, confirmation: keys.current.confirm })); } catch { setMessage("Confirmação registrada; armazenamento local indisponível."); }
      } else setMessage(`${result.error.message} (${result.error.code})`);
    } catch { if (current === generation.current) setMessage("Não foi possível confirmar. Tente novamente."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const step = !ready ? 0 : !inspection || (sourceFormat !== "CSV" && !sheet) ? 1 : !preview ? 2 : confirmation ? 5 : reviewed ? 4 : 3;
  const filteredRows = useMemo(() => preview?.rows.filter((row) => filter === "all" || (filter === "valid" ? row.status === "valid" : row.status === "rejected")) ?? [], [filter, preview]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PREVIEW_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = paginatePreviewRows(filteredRows, currentPage);
  return <section aria-labelledby="preparation-title" className="mt-6 min-w-0 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm sm:p-6">
    <h2 id="preparation-title" className="text-xl font-bold">Selecionar, mapear, validar e preparar a prévia</h2>
    <p className="mt-2 text-sm">Confira a fonte e confirme o recorte. Inserções, atualizações e ativação serão avaliadas em etapa posterior.</p>
    <ol aria-label="Etapas da preparação" className="my-5 grid gap-2 text-sm sm:grid-cols-3">{["Arquivo", "Seleção/CSV", "Mapeamento", "Prévia", "Confirmação", "Resultado"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={step === i ? "font-bold text-[var(--brand)]" : "text-slate-600"}>{i + 1}. {label}</li>)}</ol>
    {!ready && <p>Proteja uma fixture sintética para continuar.</p>}
    <p role="status" aria-live="polite" className="my-3 break-words text-sm">{message}</p>
    <div className="grid gap-4">
      {ready && sourceFormat === "CSV" && <fieldset className="grid min-w-0 gap-3 rounded-xl border p-4"><legend>Opções CSV</legend>
        <label>Codificação<select aria-label="Codificação" className={control} value={csvOptions.encoding} onChange={(e) => changeCsv({ ...csvOptions, encoding: e.target.value as CsvParseOptions["encoding"] })}><option value="utf-8">UTF-8 sem BOM</option><option value="utf-8-bom">UTF-8 com BOM</option></select></label>
        <label>Delimitador<select aria-label="Delimitador" className={control} value={csvOptions.delimiter} onChange={(e) => changeCsv({ ...csvOptions, delimiter: e.target.value as CsvParseOptions["delimiter"] })}><option value=",">Vírgula</option><option value=";">Ponto e vírgula</option><option value={"\t"}>Tabulação</option><option value="|">Barra vertical</option></select></label>
        <label>Aspas<select aria-label="Aspas" className={control} value={csvOptions.quote ?? "none"} onChange={(e) => changeCsv({ ...csvOptions, quote: e.target.value === "none" ? null : '"' })}><option value={'"'}>Aspas duplas (escape por duplicação)</option><option value="none">Sem aspas</option></select></label>
        <label><input type="checkbox" checked={csvOptions.allowMultilineQuotedField} onChange={(e) => changeCsv({ ...csvOptions, allowMultilineQuotedField: e.target.checked })} /> Permitir múltiplas linhas entre aspas</label>
      </fieldset>}
      <button className={button} disabled={!ready || busy} onClick={() => void inspect()}>Inspecionar estrutura</button>
      {inspection?.sheets && <label>Aba<select aria-label="Aba" className={control} value={sheet?.sheetId ?? ""} onChange={(e) => { const selected = inspection.sheets?.find((s) => s.sheetId === e.target.value); if (selected) void inspect(selected); else { forgetPreview(); setSheet(undefined); setMapping({}); } }}><option value="">Escolha uma aba</option>{inspection.sheets.map((s) => <option key={s.sheetId} value={s.sheetId}>{s.name}{!s.visible ? " (oculta)" : ""}</option>)}</select></label>}
      {inspection && (sourceFormat === "CSV" || sheet) && <fieldset className="grid min-w-0 gap-3 rounded-xl border p-4"><legend>Mapeamento explícito</legend>{functionalHeaders.map((h) => <label key={h.headerId}>Coluna {h.rawLabel}<select aria-label={`Coluna ${h.rawLabel}`} className={control} value={mapping[h.headerId] ?? ""} onChange={(e) => { forgetPreview(); setMapping({ ...mapping, [h.headerId]: e.target.value }); }}><option value="">Não mapear</option>{inspection.schema.fields.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.id})</option>)}</select></label>)}<p className="text-sm">Curso e trilha são excluídas antes da validação funcional.</p><button className={button} disabled={busy} onClick={() => void prepare()}>Preparar prévia</button></fieldset>}
      {preview && <article aria-label="Prévia preparada" className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-bold">4. Prévia preparada para conferência</h3>
        <div aria-label="Contagens da prévia" className="my-4 grid gap-2 sm:grid-cols-2">{[["Linhas encontradas", preview.summary.found, "all"], ["Linhas válidas", preview.summary.valid, "valid"], ["Com erro", preview.summary.withError, "error"], ["Rejeitadas", preview.summary.rejected, "rejected"]].map(([label, count, key]) => <button key={key} className="rounded-lg border bg-white p-3 text-left" aria-pressed={filter === key} onClick={() => { setFilter(String(key)); setPage(0); }}>{label}: {count}</button>)}</div>
        <p>Inseridas, atualizadas e inalteradas: Não avaliadas nesta etapa.</p>
        <details className="my-4"><summary>Conflitos: {preview.summary.conflicts.length}</summary>{preview.summary.conflicts.length ? preview.summary.conflicts.map((c, i) => <p key={i}>{c.message}</p>) : <p>Nenhum conflito nesta preparação. Correspondências serão avaliadas posteriormente.</p>}</details>
        <h4 className="my-2 font-semibold">Drill-down por linha</h4>
        {filteredRows.length > PREVIEW_PAGE_SIZE && <nav aria-label="Paginação das linhas da prévia" className="my-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, Math.min(current, pageCount - 1) - 1))}>Página anterior</button>
          <span aria-live="polite">Página {currentPage + 1} de {pageCount} — {filteredRows.length} linha(s) nesta seleção</span>
          <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={currentPage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, Math.max(0, current) + 1))}>Próxima página</button>
        </nav>}
        {rows.map((row) => <details key={row.locator} className="my-2 rounded-lg border bg-white p-3"><summary>{row.locator} — {row.status === "valid" ? "válida" : `${row.fieldErrors.length} erro(s)`}</summary><dl className="mt-3 grid gap-2 text-sm">{Object.entries(row.sourceValues).map(([field, original]) => <div key={field}><dt className="font-bold">{field}</dt><dd className="break-words">Original: {original || "(vazio)"}; normalizado: {row.normalizedPayload[field] ?? "não válido"}</dd></div>)}</dl>{row.fieldErrors.map((error) => <p key={`${error.fieldId}:${error.code}`} className="mt-2 break-words text-sm text-red-800">{error.fieldId}: {error.message} Original: {error.originalValue || "(vazio)"}. {error.action}</p>)}</details>)}
        {!confirmation && <fieldset className="mt-5 grid gap-3"><legend className="font-bold">5. Confirmação explícita</legend><label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> Conferi as contagens e as linhas desta prévia</label><button className={button} disabled={busy || !reviewed} onClick={() => void confirm()}>Confirmar esta prévia</button></fieldset>}
      </article>}
      {confirmation && <article aria-label="Resultado da confirmação" className="rounded-xl border border-emerald-300 p-4"><h3 className="font-bold">6. Conferência registrada</h3><p>A mesma fonte, versão, contrato e hashes foram confirmados.</p><p className="break-all font-mono text-xs">{confirmation.confirmationId}</p></article>}
      {confirmation && preview && <ConsolidatedSourceReconciliation preview={preview} confirmation={confirmation} />}
    </div>
  </section>;
}
