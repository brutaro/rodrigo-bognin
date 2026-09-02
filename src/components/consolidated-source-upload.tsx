"use client";

import { FormEvent, useState } from "react";

export type ConsolidatedSourceReceipt = {
  receiptId: string;
  format: "XLS" | "XLSX" | "CSV";
  sizeBytes: number;
  receivedAt: string;
  status: "protected";
};

const limitBytes = 50 * 1024 * 1024;
const receiptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildConsolidatedSourceUploadRequest(file: File) {
  return {
    url: "/api/sources/consolidated",
    init: {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-TRIA-File-Name": encodeURIComponent(file.name),
        "X-TRIA-File-Size": String(file.size),
      },
      body: file,
    } satisfies RequestInit,
  };
}

export function parseConsolidatedSourceReceipt(value: unknown): ConsolidatedSourceReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as Record<string, unknown>;
  if (typeof receipt.receiptId !== "string" || !receiptIdPattern.test(receipt.receiptId) ||
      !["XLS", "XLSX", "CSV"].includes(String(receipt.format)) ||
      !Number.isSafeInteger(receipt.sizeBytes) || Number(receipt.sizeBytes) <= 0 || Number(receipt.sizeBytes) > limitBytes ||
      typeof receipt.receivedAt !== "string" || Number.isNaN(Date.parse(receipt.receivedAt)) ||
      new Date(receipt.receivedAt).toISOString() !== receipt.receivedAt || receipt.status !== "protected") return undefined;
  return {
    receiptId: receipt.receiptId,
    format: receipt.format as ConsolidatedSourceReceipt["format"],
    sizeBytes: Number(receipt.sizeBytes),
    receivedAt: receipt.receivedAt,
    status: "protected",
  };
}

function formatBytes(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "byte", unitDisplay: "narrow" }).format(value);
}

export function ConsolidatedSourceUpload({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<ConsolidatedSourceReceipt | null>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) return setMessage("Escolha um arquivo não vazio.");
    if (file.size > limitBytes) return setMessage("O arquivo excede o limite de 50 MiB.");
    setBusy(true);
    setReceipt(null);
    setMessage("Recebendo, preservando e verificando os bytes…");
    try {
      const uploadRequest = buildConsolidatedSourceUploadRequest(file);
      const response = await fetch(uploadRequest.url, uploadRequest.init);
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Falha no recebimento.");
      const parsedReceipt = parseConsolidatedSourceReceipt(result);
      if (!parsedReceipt) throw new Error("O recibo retornado é inválido.");
      setReceipt(parsedReceipt);
      setMessage("Fonte recebida e protegida.");
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no recebimento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="consolidated-source-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">Fonte protegida</p>
            <h2 id="consolidated-source-title" className="mt-2 text-xl font-bold text-[var(--ink)]">Base consolidada de aplicação de recursos</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">Receba uma fixture XLS, XLSX ou CSV sem abrir, interpretar ou executar seu conteúdo.</p>
          </div>
          <div className="group relative shrink-0">
            <button type="button" aria-label="Como a fonte é protegida" aria-describedby="consolidated-source-help" className="grid size-9 place-items-center rounded-full border border-slate-300 text-sm font-bold text-slate-700">?</button>
            <p id="consolidated-source-help" className="absolute right-0 z-10 mt-2 hidden w-72 rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-white shadow-lg group-hover:block group-focus-within:block">
              Somente os bytes são preservados. O arquivo recebe hash SHA-256 e referência privada; nenhuma aba, célula, fórmula ou macro é lida nesta etapa.
            </p>
          </div>
        </div>
      </div>

      {!enabled ? (
        <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Dados reais continuam bloqueados.</strong> O recebimento só é liberado para fixtures sintéticas em ambiente isolado.
        </div>
      ) : null}
      {message ? <p role="status" aria-live="polite" className="border-b border-[var(--border)] bg-blue-50 p-4 text-sm text-blue-950">{message}</p> : null}

      {receipt ? (
        <article aria-label="Recibo de proteção" className="m-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:m-6">
          <p className="font-bold text-emerald-950">Fonte protegida</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-emerald-800">Protocolo</dt><dd className="mt-1 font-mono text-xs text-emerald-950">{receipt.receiptId}</dd></div>
            <div><dt className="text-emerald-800">Formato</dt><dd className="mt-1 font-semibold text-emerald-950">{receipt.format}</dd></div>
            <div><dt className="text-emerald-800">Tamanho preservado</dt><dd className="mt-1 font-semibold text-emerald-950">{formatBytes(receipt.sizeBytes)}</dd></div>
            <div><dt className="text-emerald-800">Recebida em</dt><dd className="mt-1 font-semibold text-emerald-950">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(receipt.receivedAt))}</dd></div>
          </dl>
        </article>
      ) : null}

      <form onSubmit={upload} className="grid gap-4 p-5 sm:p-6">
        <label className="text-sm font-semibold text-[var(--ink)]">
          Arquivo sintético
          <input name="file" type="file" required disabled={!enabled || busy} accept=".xls,.xlsx,.csv" className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm font-normal disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">Até 50 MiB. O formato é definido pela extensão; o MIME é apenas um indício.</p>
        <button disabled={!enabled || busy} className="rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
          {busy ? "Protegendo…" : "Receber e proteger"}
        </button>
      </form>
    </section>
  );
}
