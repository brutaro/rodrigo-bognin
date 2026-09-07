"use client";
import { useActionState } from "react";
export function ProjectSettings({ title, start, end, archived, revision, action }: { title: string; start: string; end: string; archived: boolean; revision: string; action: (state: {message:string}, form: FormData) => Promise<{message:string}> }) {
  const [state, submit, pending] = useActionState(action, {message:""});
  return <details className="mt-5 border-t border-[var(--border)] pt-4">
    <summary className="cursor-pointer text-sm font-semibold text-[var(--brand)]">Editar projeto{archived ? " · Arquivado" : ""}</summary>
    <form action={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="revision" value={revision} />
      <label className="text-sm sm:col-span-2">Nome do projeto<input name="title" defaultValue={title} required minLength={3} maxLength={200} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm">Início<input type="date" name="start" defaultValue={start} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm">Fim<input type="date" name="end" defaultValue={end} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="archived" type="checkbox" defaultChecked={archived} /> Arquivar projeto (mantém arquivos, valores e publicações)</label>
      <p role="status" className="text-sm text-red-800">{state.message}</p>
      <button disabled={pending} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white sm:justify-self-end">{pending ? "Salvando…" : "Salvar dados do projeto"}</button>
    </form>
  </details>;
}
