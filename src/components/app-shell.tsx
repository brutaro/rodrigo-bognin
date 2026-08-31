import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--surface-subtle)]">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="TRIA — página inicial">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand)] text-sm font-black tracking-tight text-white">
              TR
            </span>
            <span>
              <span className="block text-lg font-bold leading-5 text-[var(--ink)]">TRIA</span>
              <span className="block text-xs text-[var(--ink-muted)]">Prestação de contas</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 sm:inline-flex">
              Dados fictícios
            </span>
            <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700" aria-label="Conta de Rodrigo">
              R
            </span>
          </div>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50">
        <p className="mx-auto max-w-7xl px-5 py-2 text-sm text-amber-900 lg:px-8">
          Ambiente de demonstração. Nenhum dado real foi carregado.
        </p>
      </div>
      {children}
    </div>
  );
}
