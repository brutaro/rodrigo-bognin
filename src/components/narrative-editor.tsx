"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function NarrativeEditor({ projectId, initialText, initialRevision }: { projectId: string; initialText: string; initialRevision: string }) {
  const [text, setText] = useState(initialText);
  const [message, setMessage] = useState("Salvamento automático ativado");
  const [failed, setFailed] = useState(false);
  const value = useRef(initialText);
  const saved = useRef(initialText);
  const revision = useRef(initialRevision);
  const pending = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const save = useCallback(async function flush(): Promise<boolean> {
    if (pending.current) { if (!await pending.current) return false; return flush(); }
    if (value.current === saved.current) return true;
    if (conflict.current) return false;
    const submitted = value.current;
    setMessage("Salvando…");
    pending.current = (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrative: submitted, revision: revision.current }) });
        const data = await response.json();
        if (!response.ok) { conflict.current = response.status === 409; throw new Error(data.error); }
        revision.current = data.revision;
        saved.current = submitted;
        setFailed(false);
        setMessage(value.current === submitted ? "Salvo" : "Alterações por salvar…");
        return true;
      } catch (error) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.");
        return false;
      } finally { pending.current = null; }
    })();
    return pending.current;
  }, [projectId]);

  useEffect(() => {
    if (BigInt(initialRevision) < BigInt(revision.current)) return;
    if (value.current === saved.current && !pending.current) {
      revision.current = initialRevision;
      saved.current = initialText;
      value.current = initialText;
      queueMicrotask(() => setText(initialText));
    } else if (!pending.current && initialText === saved.current) {
      // Outra operação alterou apenas metadados; o texto local continua válido.
      revision.current = initialRevision;
    }
  }, [initialRevision, initialText]);
  useEffect(() => {
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/visit`, { method: "POST" }).catch(() => {});
  }, [projectId]);
  useEffect(() => {
    if (text === saved.current) return;
    const timer = setTimeout(() => { void save(); }, 1200);
    return () => clearTimeout(timer);
  }, [text, save]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (value.current !== saved.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || value.current === saved.current) return;
      event.preventDefault(); event.stopPropagation();
      void (async () => { while (value.current !== saved.current) { if (!await save()) return; } window.location.assign(link.href); })();
    };
    const submit = (event: SubmitEvent) => {
      if (value.current !== saved.current) {
        event.preventDefault(); event.stopPropagation();
        const form = event.target as HTMLFormElement;
        const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
        void (async () => { while (value.current !== saved.current) { if (!await save()) return; } form.requestSubmit(submitter ?? undefined); })();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    document.addEventListener("submit", submit, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); document.removeEventListener("submit", submit, true); };
  }, [save]);
  return <div className="p-5">
    <label htmlFor="narrative" className="mb-2 block text-sm font-semibold">Narrativa do projeto</label>
    <textarea id="narrative" name="narrative" value={text} onChange={event => { value.current = event.target.value; setText(event.target.value); if (!conflict.current) setMessage("Alterações por salvar…"); }} maxLength={20000} rows={9} className="w-full resize-y rounded-xl border border-slate-300 p-3 text-sm leading-6" />
    <div className="mt-3 flex items-center justify-between gap-3">
      <p role="status" aria-live="polite" className={`text-sm ${failed ? "text-red-800" : "text-slate-600"}`}>{message}</p>
      <button type="button" onClick={() => void save()} className="shrink-0 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">Salvar agora</button>
    </div>
    {failed ? <p className="mt-2 text-xs text-slate-600">Mantenha a página aberta até salvar. Em caso de conflito, copie o texto antes de recarregar.</p> : null}
  </div>;
}
