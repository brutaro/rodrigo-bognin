"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addFinancialEntry,
  financialOrigins,
  manualFinancialKinds,
  parseBrlToCents,
  saveNarrative,
} from "@/lib/workspace";

function projectPath(projectId: string, notice?: string) {
  const base = `/projetos/${encodeURIComponent(projectId)}`;
  return notice ? `${base}?notice=${encodeURIComponent(notice)}` : base;
}

function assertLocalDemoWrites(projectId: string) {
  if (process.env.TRIA_DEMO_WRITES !== "enabled") {
    redirect(projectPath(projectId, "writes-disabled"));
  }
}

function readText(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveNarrativeAction(projectId: string, formData: FormData) {
  assertLocalDemoWrites(projectId);
  const narrative = readText(formData, "narrative");
  const expectedRevision = readText(formData, "expectedRevision");
  if (narrative.length < 10 || narrative.length > 20_000 || !/^\d+$/.test(expectedRevision)) {
    redirect(projectPath(projectId, "invalid-narrative"));
  }
  try {
    await saveNarrative(projectId, narrative, expectedRevision);
  } catch (error) {
    if (error instanceof Error && error.message.includes("mudou depois")) {
      redirect(projectPath(projectId, "narrative-stale"));
    }
    throw error;
  }
  revalidatePath(projectPath(projectId));
  redirect(projectPath(projectId, "narrative-saved"));
}

export async function addFinancialEntryAction(projectId: string, formData: FormData) {
  assertLocalDemoWrites(projectId);
  const kind = readText(formData, "kind");
  const description = readText(formData, "description");
  const amountCents = parseBrlToCents(readText(formData, "amount"));
  const origin = readText(formData, "origin");
  const requestId = readText(formData, "requestId");

  if (
    !manualFinancialKinds.includes(kind as (typeof manualFinancialKinds)[number]) ||
    !financialOrigins.includes(origin as (typeof financialOrigins)[number]) ||
    description.length < 3 ||
    description.length > 200 ||
    amountCents === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    redirect(projectPath(projectId, "invalid-financial-entry"));
  }

  await addFinancialEntry(projectId, {
    kind: kind as (typeof manualFinancialKinds)[number],
    description,
    amountCents,
    origin: origin as (typeof financialOrigins)[number],
    documentState: "Sem arquivo associado",
  }, requestId);
  revalidatePath(projectPath(projectId));
  redirect(projectPath(projectId, "financial-entry-saved"));
}
