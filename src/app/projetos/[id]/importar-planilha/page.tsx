import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceImport } from "@/components/resource-import";
import { requireAuthenticatedPage } from "@/lib/auth";
import { getProjectDetails } from "@/lib/project-repository";
import { realSourceUploadEnabled } from "@/lib/consolidated-source-repository";

export const dynamic = "force-dynamic";
export default async function ProjectResourceImportPage({ params }: PageProps<"/projetos/[id]/importar-planilha">) {
  await requireAuthenticatedPage();
  const { id } = await params;
  const project = await getProjectDetails(id);
  if (!project) notFound();
  return <AppShell><main className="mx-auto max-w-4xl px-5 py-8 lg:px-8">
    <Link href={`/projetos/${encodeURIComponent(project.id)}`} className="text-sm font-semibold text-[var(--brand)] underline">Voltar ao projeto</Link>
    <h1 className="mt-5 text-3xl font-bold">Importar planilha neste projeto</h1>
    <p className="my-5 text-[var(--ink-muted)]">{project.name} · Recursos em XLSX ou CSV, com prévia antes de aplicar.</p>
    {realSourceUploadEnabled() ? <ResourceImport project={{ id: project.id, title: project.name }} /> : <p>A importação não está habilitada neste ambiente.</p>}
  </main></AppShell>;
}
