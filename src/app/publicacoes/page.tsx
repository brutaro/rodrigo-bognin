import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { listPublicationSummaries } from "@/lib/project-repository";

export const dynamic = "force-dynamic";

export default async function PublicationsPage() {
  const publications = await listPublicationSummaries();
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Histórico imutável</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Publicações</h1>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">Cada correção publicada gera uma nova versão.</p>
        <section className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
          {publications.length ? <ul className="divide-y divide-[var(--border)]">{publications.map((item) => <li key={item.id}><Link href={`/publicacoes/${item.id}`} className="flex flex-col gap-3 p-5 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-[var(--ink)]">{item.projectTitle}</strong><p className="mt-1 text-xs text-slate-500">Versão {item.version} · {new Date(item.createdAt).toLocaleString("pt-BR")}</p></div><span className="text-sm font-semibold text-[var(--brand)]">Abrir publicação →</span></Link></li>)}</ul> : <p className="p-8 text-center text-sm text-slate-500">Nenhuma publicação local criada.</p>}
        </section>
      </main>
    </AppShell>
  );
}
