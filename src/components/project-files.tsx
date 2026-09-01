"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
type FileDocumentRecord = {
  id: string; title: string; status: "active" | "purging"; includeInPublication: boolean;
  versions: Array<{ id: string; version: number; originalName: string; sizeBytes: number; sha256: string; status: "active" | "purging" }>;
};

function formatBytes(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "byte", unitDisplay: "narrow" }).format(value);
}

export function ProjectFiles({ projectId, documents }: { projectId: string; documents: FileDocumentRecord[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return setMessage("Escolha um arquivo não vazio.");
    setBusy(true); setMessage("Enviando e verificando…");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-TRIA-File-Name": encodeURIComponent(file.name),
          "X-TRIA-File-Title": encodeURIComponent(String(data.get("title") ?? "")),
          ...(data.get("documentId") ? { "X-TRIA-Document-Id": String(data.get("documentId")) } : {}),
        },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Falha no upload.");
      form.reset(); setMessage("Arquivo guardado e hash conferido."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha no upload."); }
    finally { setBusy(false); }
  }

  async function setInclusion(documentId: string, include: boolean) {
    setBusy(true); setMessage(include ? "Incluindo na próxima publicação…" : "Retirando da próxima publicação…");
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(documentId)}/publication`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Falha ao alterar a inclusão.");
      setMessage(include ? "Arquivo incluído na próxima publicação." : "Arquivo fora da próxima publicação.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao alterar a inclusão."); }
    finally { setBusy(false); }
  }

  async function purge(event: FormEvent<HTMLFormElement>, documentId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMessage("Executando expurgo retomável…");
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(documentId)}/purge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: data.get("codigo"), confirmacao: data.get("confirmacao") }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Falha no expurgo.");
      setMessage("Arquivo, versões, vínculos e publicações dependentes foram expurgados."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha no expurgo."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="vault-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
    <div className="border-b border-[var(--border)] p-5"><h2 id="vault-title" className="text-lg font-bold">Arquivos</h2><p className="mt-1 text-sm text-slate-500">Cada envio cria um objeto opaco e uma versão verificável.</p></div>
    {message ? <p role="status" className="border-b border-[var(--border)] bg-blue-50 p-4 text-sm text-blue-950">{message}</p> : null}
    <div className="divide-y divide-[var(--border)]">
      {documents.map((document) => <article key={document.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{document.title}</h3><p className="mt-1 text-xs text-slate-500">{document.versions.length} versão(ões) · {document.status === "purging" ? "expurgo pendente" : "ativo"}</p></div>{document.status === "active" ? <button type="button" disabled={busy} onClick={() => setInclusion(document.id, !document.includeInPublication)} className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${document.includeInPublication ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-300 bg-white text-slate-700"}`}>{document.includeInPublication ? "Incluído na publicação" : "Não incluir na publicação"}</button> : null}</div>
        <ul className="mt-3 space-y-2">{document.versions.map((version) => <li key={version.id} className="rounded-lg bg-slate-50 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span>V{version.version} · {version.originalName} · {formatBytes(version.sizeBytes)}</span>{version.status === "active" ? <a className="font-bold text-[var(--brand)] hover:underline" href={`/api/files/${version.id}/download`}>Baixar</a> : <span className="font-semibold text-amber-800">Expurgando</span>}</div><code className="mt-2 block break-all text-[10px] text-slate-500">SHA-256 {version.sha256}</code></li>)}</ul>
        <details className="mt-4"><summary className="cursor-pointer text-xs font-bold text-red-800">Expurgar definitivamente</summary><form onSubmit={(event) => purge(event, document.id)} className="mt-3 grid gap-2 rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs text-red-900">Remove todas as versões e a primeira publicação que usa o arquivo, além das versões posteriores. Backups já baixados permanecem sob seu controle.</p><input name="codigo" type="password" required placeholder="Código permanente" className="h-10 rounded-lg border border-red-300 bg-white px-3 text-sm"/><input name="confirmacao" required pattern="EXCLUIR" placeholder="Digite EXCLUIR" className="h-10 rounded-lg border border-red-300 bg-white px-3 text-sm"/><button disabled={busy} className="rounded-lg bg-red-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Confirmar expurgo</button></form></details>
      </article>)}
      {!documents.length ? <p className="p-5 text-sm text-slate-500">Nenhum arquivo guardado.</p> : null}
    </div>
    <form onSubmit={upload} className="grid gap-3 border-t border-[var(--border)] p-5">
      <label className="text-sm font-semibold">Título<input name="title" required maxLength={200} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" placeholder="Descrição do arquivo" /></label>
      <label className="text-sm font-semibold">Destino<select name="documentId" className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">Novo arquivo</option>{documents.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>Nova versão de: {item.title}</option>)}</select></label>
      <label className="text-sm font-semibold">Arquivo local<input name="file" type="file" required className="mt-1 block w-full text-sm font-normal" /></label>
      <button disabled={busy} className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Processando…" : "Adicionar arquivo"}</button>
    </form>
  </section>;
}
