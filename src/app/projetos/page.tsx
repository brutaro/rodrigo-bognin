import { AppShell } from "@/components/app-shell";
import { ProjectList } from "@/components/project-list";
import { listProjectSummaries } from "@/lib/project-repository";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjectSummaries();
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Base de projetos</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Projetos</h1>
        <p className="mb-7 mt-3 text-sm text-[var(--ink-muted)]">{projects.length} projetos carregados por fonte controlada.</p>
        <ProjectList projects={projects} />
      </main>
    </AppShell>
  );
}
