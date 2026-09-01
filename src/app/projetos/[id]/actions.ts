"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, requireAuthenticatedPage } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  addFinancialEntry,
  financialOrigins,
  manualFinancialKinds,
  parseBrlToCents,
  saveNarrative,
} from "@/lib/workspace";
import { adjustActivity, restoreActivity, AdjustmentConflictError } from "@/lib/source-adjustment-repository";
import { assertAdjustmentReason, assertRequestId, assertRevision, parseDurationToSeconds, parseSignedBrlDecimal } from "@/lib/source-adjustment-validation";
import type { AdjustmentActionState } from "@/lib/source-adjustment-types";

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
  await requireAuthenticatedPage();
  await assertSameOrigin();
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
  await requireAuthenticatedPage();
  await assertSameOrigin();
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


export async function saveActivityAdjustmentAction(
  projectId: string, _previous: AdjustmentActionState, formData: FormData,
): Promise<AdjustmentActionState> {
  await requireAuthenticatedPage();
  await assertSameOrigin();
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return { status: "unavailable", message: "A gravação está desativada." };
  try {
    const id = readText(formData, "activityId");
    const requestId = assertRequestId(readText(formData, "requestId"));
    const expectedRevision = assertRevision(readText(formData, "expectedRevision"));
    const reason = assertAdjustmentReason(readText(formData, "reason"));
    const durationSeconds = parseDurationToSeconds(readText(formData, "hoursMode"), readText(formData, "hours"));
    const measuredValue = parseSignedBrlDecimal(readText(formData, "measurementMode"), readText(formData, "measurement"));
    await adjustActivity({ id, projectId, requestId, expectedRevision, reason, durationSeconds, measuredValue });
    revalidatePath(projectPath(projectId));
    revalidatePath(`/projetos/${encodeURIComponent(projectId)}/conferir`);
    return { status: "saved", message: "Ajuste salvo. A fonte importada permaneceu intacta." };
  } catch (error) {
    if (error instanceof AdjustmentConflictError) return {
      status: "conflict", message: error.message, currentRevision: error.current.revision,
      currentHours: error.current.hours, currentMeasuredValue: error.current.measuredValue,
    };
    if (error instanceof Error && ["inválid", "Informe", "Use horas", "muito grande"].some((text) => error.message.includes(text))) {
      return { status: "invalid", message: error.message };
    }
    return { status: "unavailable", message: "Não foi possível salvar o ajuste agora." };
  }
}

export async function restoreActivityAction(
  projectId: string, _previous: AdjustmentActionState, formData: FormData,
): Promise<AdjustmentActionState> {
  await requireAuthenticatedPage();
  await assertSameOrigin();
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return { status: "unavailable", message: "A gravação está desativada." };
  try {
    const id = readText(formData, "activityId");
    const requestId = assertRequestId(readText(formData, "requestId"));
    const expectedRevision = assertRevision(readText(formData, "expectedRevision"));
    const reason = assertAdjustmentReason(readText(formData, "reason"));
    await restoreActivity({ id, projectId, requestId, expectedRevision, reason });
    revalidatePath(projectPath(projectId));
    revalidatePath(`/projetos/${encodeURIComponent(projectId)}/conferir`);
    return { status: "saved", message: "Restauração registrada como nova revisão." };
  } catch (error) {
    if (error instanceof AdjustmentConflictError) return {
      status: "conflict", message: error.message, currentRevision: error.current.revision,
      currentHours: error.current.hours, currentMeasuredValue: error.current.measuredValue,
    };
    if (error instanceof Error && ["inválid", "Informe"].some((text) => error.message.includes(text))) {
      return { status: "invalid", message: error.message };
    }
    return { status: "unavailable", message: "Não foi possível restaurar a atividade agora." };
  }
}
