import { requireAuthenticatedPage } from "@/lib/auth";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ProjectList } from "@/components/project-list";
import { StatusBadge } from "@/components/status-badge";
import { listProjectSummaries } from "@/lib/project-repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthenticatedPage();
  const projects = await listProjectSummaries();
  const currentProject = projects[0];

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <section className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Meu trabalho</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">Olá, Rodrigo</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
              Continue um projeto ou encontre o que precisa organizar.
            </p>
          </div>
          <button type="button" disabled className="h-11 cursor-not-allowed rounded-xl bg-slate-200 px-4 text-sm font-semibold text-slate-500" title="Disponível quando a edição for ativada">
            Novo projeto
          </button>
        </section>

        {currentProject ? (
          <section aria-labelledby="continue-title" className="mb-7 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
            <p id="continue-title" className="text-xs font-bold uppercase tracking-[0.16em] text-blue-800">Continuar de onde parei</p>
            <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-bold text-[var(--ink)]">{currentProject.name}</h2>
                  <StatusBadge status={currentProject.status} />
                </div>
                <p className="mt-2 text-sm text-slate-600">Próxima ação: conferir narrativa, valores e arquivos.</p>
              </div>
              <Link href={`/projetos/${currentProject.id}`} className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:bg-blue-900">
                Abrir projeto
              </Link>
            </div>
          </section>
        ) : null}

        <ProjectList projects={projects} />

        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          Publicações anteriores aparecerão aqui quando a primeira versão for gerada.
        </p>
      </main>
    </AppShell>
  );
}
