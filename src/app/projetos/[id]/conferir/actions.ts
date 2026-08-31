"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { publishProject } from "@/lib/workspace";

function projectPath(projectId: string, notice?: string) {
  const base = `/projetos/${encodeURIComponent(projectId)}/conferir`;
  return notice ? `${base}?notice=${encodeURIComponent(notice)}` : base;
}

export async function publishProjectAction(projectId: string, expectedCompositionHash: string, expectedRevision: string, formData: FormData) {
  if (process.env.TRIA_DEMO_WRITES !== "enabled") {
    redirect(projectPath(projectId, "writes-disabled"));
  }
  try {
    const acknowledged = formData.get("acknowledgeCaveats") === "yes";
    const result = await publishProject(projectId, expectedCompositionHash, acknowledged, expectedRevision);
    revalidatePath(`/projetos/${encodeURIComponent(projectId)}`);
    revalidatePath(projectPath(projectId));
    redirect(`/publicacoes/${encodeURIComponent(result.publication.id)}?notice=${result.created ? "published" : "already-published"}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("pelo menos 20")) {
      redirect(projectPath(projectId, "publication-invalid-narrative"));
    }
    if (error instanceof Error && error.message.includes("composição mudou")) {
      redirect(projectPath(projectId, "publication-stale-review"));
    }
    if (error instanceof Error && error.message.includes("conferência explícita")) {
      redirect(projectPath(projectId, "publication-ack-required"));
    }
    throw error;
  }
}
