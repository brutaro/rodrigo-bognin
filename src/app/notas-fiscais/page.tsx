import { requireAuthenticatedPage } from "@/lib/auth";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { listFiscalNotes } from "@/lib/project-repository";

export const dynamic = "force-dynamic";

export default async function FiscalNotesPage() {
  await requireAuthenticatedPage();
  const notes = await listFiscalNotes();
  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Universo fiscal bruto</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Notas fiscais</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{notes.length} registros. Uma nota não pertence automaticamente a um projeto e não comprova pagamento.</p>
        <section className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">NFS-e</th><th className="px-4 py-3">Emissão</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Projeto declarado</th><th className="px-4 py-3">Relação auditada</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">{notes.map((note) => <tr key={note.id}><td className="px-4 py-4 font-semibold">{note.year} · {note.number}</td><td className="px-4 py-4">{note.issueDate}</td><td className="px-4 py-4 font-semibold">{note.amount}</td><td className="px-4 py-4">{note.category}</td><td className="px-4 py-4">{note.declaredProject ? <Link href={`/projetos/${note.declaredProjectId}`} className="text-[var(--brand)] hover:underline">{note.declaredProject}</Link> : "Não declarado"}</td><td className="px-4 py-4"><span className="block font-semibold">{note.relationStrength}</span><span className="text-xs text-slate-500">{note.relationState}</span></td></tr>)}</tbody>
          </table></div>
          {!notes.length ? <p className="p-8 text-center text-sm text-slate-500">Notas fiscais disponíveis após a carga PostgreSQL local.</p> : null}
        </section>
      </main>
    </AppShell>
  );
}
