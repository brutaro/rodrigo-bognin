import { requireAuthenticatedPage } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ProjectList } from "@/components/project-list";
import { listProjectSummaries } from "@/lib/project-repository";
import { isDatabaseConfigured } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await requireAuthenticatedPage();
  const projects = await listProjectSummaries();
  const localData = isDatabaseConfigured();
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Base de projetos</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Projetos</h1>
        <div className="mb-7 mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-[var(--ink-muted)]">{projects.length} projetos carregados por fonte controlada.</p>{localData ? <a href="/api/reports/global" className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-bold text-white">Baixar relatório global PDF</a> : null}</div>
        <ProjectList projects={projects} />
      </main>
    </AppShell>
  );
}
