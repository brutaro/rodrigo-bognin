"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDemoFinancialEntry,
  financialOrigins,
  manualFinancialKinds,
  parseBrlToCents,
  saveDemoNarrative,
} from "@/lib/demo-workspace";

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
  if (narrative.length < 10 || narrative.length > 20_000) {
    redirect(projectPath(projectId, "invalid-narrative"));
  }
  await saveDemoNarrative(projectId, narrative);
  revalidatePath(projectPath(projectId));
  redirect(projectPath(projectId, "narrative-saved"));
}

export async function addFinancialEntryAction(projectId: string, formData: FormData) {
  assertLocalDemoWrites(projectId);
  const kind = readText(formData, "kind");
  const description = readText(formData, "description");
  const amountCents = parseBrlToCents(readText(formData, "amount"));
  const origin = readText(formData, "origin");

  if (
    !manualFinancialKinds.includes(kind as (typeof manualFinancialKinds)[number]) ||
    !financialOrigins.includes(origin as (typeof financialOrigins)[number]) ||
    description.length < 3 ||
    description.length > 200 ||
    amountCents === null
  ) {
    redirect(projectPath(projectId, "invalid-financial-entry"));
  }

  await addDemoFinancialEntry(projectId, {
    kind: kind as (typeof manualFinancialKinds)[number],
    description,
    amountCents,
    origin: origin as (typeof financialOrigins)[number],
    documentState: "Sem arquivo associado",
  });
  revalidatePath(projectPath(projectId));
  redirect(projectPath(projectId, "financial-entry-saved"));
}
