import { TriaMark } from "./tria-mark";
import Link from "next/link";
import type { ReactNode } from "react";
import { isDatabaseConfigured } from "@/lib/database";
import { logoutAction } from "@/app/actions";

export function AppShell({ children }: { children: ReactNode }) {
  const localData = isDatabaseConfigured();
  return (
    <div className="min-h-screen bg-[var(--surface-subtle)]">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="TRIA — página inicial">
            <TriaMark />
            <span>
              <span className="block text-lg font-bold leading-5 text-[var(--ink)]">TRIA</span>
              <span className="block text-xs text-[var(--ink-muted)]">Prestação de contas</span>
            </span>
          </Link>
          <nav aria-label="Navegação principal" className="hidden items-center gap-1 lg:flex">
            <Link href="/" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Visão geral</Link>
            <Link href="/contexto" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Contexto</Link>
            <Link href="/projetos" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Projetos</Link>
            <Link href="/fontes/base-consolidada" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Fontes</Link>
            <Link href="/notas-fiscais" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Notas fiscais</Link>
            <Link href="/publicacoes" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Publicações</Link>
            <a href="/backup" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Backup</a>
          </nav>
          <div className="flex items-center gap-3">
            <span className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex ${localData ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {localData ? "Dados locais privados" : "Dados fictícios"}
            </span>
            <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700" aria-label="Conta de XCON">X</span>
            <form action={logoutAction}><button className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Sair</button></form>
          </div>
        </div>
      </header>
      <nav aria-label="Navegação principal móvel" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-white px-5 py-2 lg:hidden">
        <Link href="/" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Visão geral</Link>
        <Link href="/contexto" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Contexto</Link>
        <Link href="/projetos" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Projetos</Link>
        <Link href="/fontes/base-consolidada" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Fontes</Link>
        <Link href="/notas-fiscais" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Notas fiscais</Link>
        <Link href="/publicacoes" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Publicações</Link>
        <a href="/backup" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-700">Backup</a>
      </nav>
      <div className={`border-b ${localData ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <p className={`mx-auto max-w-7xl px-5 py-2 text-sm lg:px-8 ${localData ? "text-emerald-900" : "text-amber-900"}`}>
          {localData
            ? "Seu ambiente de trabalho privado. Alterações e arquivos são preservados."
            : "Ambiente de demonstração. Nenhum dado real foi carregado."}
        </p>
      </div>
      {children}
    </div>
  );
}
