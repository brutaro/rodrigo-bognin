"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, requireAuthenticatedPage } from "@/lib/auth";
import { deleteFiscalNote, adjustFiscalNote, restoreFiscalNote, AdjustmentConflictError, DuplicateFiscalNoteError } from "@/lib/source-adjustment-repository";
import { assertAdjustmentReason, assertFiscalRelationTuple, assertRequestId, assertRevision, parseFiscalBrlDecimal, parseNullableProject, parseNullableText, parseOptionalFiscalBrlDecimal, parseTriState, parseIsoDate } from "@/lib/source-adjustment-validation";
import type { AdjustmentActionState } from "@/lib/source-adjustment-types";

function text(formData: FormData, name: string) { const value = formData.get(name); return typeof value === "string" ? value.trim() : ""; }
function unavailable() { return { status: "unavailable", message: "Não foi possível gravar a NFS-e agora." } as const; }
function safeValidationMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  const prefixes = ["Ano de emissão", "A data", "Informe", "O valor", "Projeto inválido", "O texto", "Elegibilidade inválida",
    "Os dados da NFS-e", "Não foi possível restaurar a NFS-e", "A revisão esperada", "A identificação da tentativa"];
  return prefixes.some((prefix) => error.message.startsWith(prefix)) ? error.message : null;
}

export async function saveFiscalNoteAdjustmentAction(_previous: AdjustmentActionState, formData: FormData): Promise<AdjustmentActionState> {
  await requireAuthenticatedPage(); await assertSameOrigin();
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return unavailable();
  try {
    const issueYearText = text(formData, "issueYear");
    if (!/^\d{4}$/.test(issueYearText) || Number(issueYearText) < 1900 || Number(issueYearText) > 2200) throw new Error("Ano de emissão inválido.");
    const issueDate = parseIsoDate(text(formData, "issueDate"));
    if (Number(issueDate.slice(0, 4)) !== Number(issueYearText)) throw new Error("A data e o ano de emissão devem coincidir.");
    const candidateProjectId = parseNullableProject(text(formData, "candidateProjectId"));
    const fullValueEligible = parseTriState(text(formData, "fullValueEligible"));
    const verifiedRelatedValue = parseOptionalFiscalBrlDecimal(text(formData, "verifiedRelatedValue"));
    const amount = parseFiscalBrlDecimal(text(formData, "amount"));
    const strength = parseNullableText(text(formData, "strength"), 100) ?? "Sem relação verificável";
    const relationState = parseNullableText(text(formData, "relationState"), 100) ?? "Não informado";
    const criterion = parseNullableText(text(formData, "criterion"), 500);
    assertFiscalRelationTuple({ amount, candidateProjectId, relationStrength: strength, relationState, criterion,
      fullValueEligible, verifiedRelatedValue });
    await adjustFiscalNote({
      id: text(formData, "fiscalNoteId"), expectedRevision: assertRevision(text(formData, "expectedRevision")),
      requestId: assertRequestId(text(formData, "requestId")), reason: assertAdjustmentReason(text(formData, "reason")),
      issueYear: Number(issueYearText), number: parseNullableText(text(formData, "number"), 100) ?? "",
      issueDate, amount, category: parseNullableText(text(formData, "category"), 200),
      declaredProjectId: parseNullableProject(text(formData, "declaredProjectId")), candidateProjectId,
      strength, relationState, criterion, fullValueEligible, verifiedRelatedValue,
      confirmDuplicate: formData.get("confirmDuplicate") === "yes",
    });
    revalidatePath("/notas-fiscais"); revalidatePath("/projetos");
    return { status: "saved", message: "Revisão fiscal salva atomicamente. As fontes permaneceram intactas." };
  } catch (error) {
    if (error instanceof AdjustmentConflictError) return { status: "conflict", message: error.message, currentRevision: error.current.revision, currentSummary: error.current.summary };
    if (error instanceof DuplicateFiscalNoteError) return { status: "duplicate", message: `${error.message} Marque a confirmação explícita para salvar mesmo assim.` };
    const message = safeValidationMessage(error);
    if (message) return { status: "invalid", message };
    return unavailable();
  }
}

export async function restoreFiscalNoteAction(_previous: AdjustmentActionState, formData: FormData): Promise<AdjustmentActionState> {
  await requireAuthenticatedPage(); await assertSameOrigin();
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return unavailable();
  try {
    await restoreFiscalNote({ id: text(formData, "fiscalNoteId"), expectedRevision: assertRevision(text(formData, "expectedRevision")),
      requestId: assertRequestId(text(formData, "requestId")), reason: assertAdjustmentReason(text(formData, "reason")),
      confirmDuplicate: formData.get("confirmDuplicate") === "yes" });
    revalidatePath("/notas-fiscais"); revalidatePath("/projetos");
    return { status: "saved", message: "A fonte importada foi restaurada por uma nova revisão." };
  } catch (error) {
    if (error instanceof AdjustmentConflictError) return { status: "conflict", message: error.message, currentRevision: error.current.revision, currentSummary: error.current.summary };
    if (error instanceof DuplicateFiscalNoteError) return { status: "duplicate", message: `${error.message} Confirme a duplicidade para restaurar.` };
    const message = safeValidationMessage(error);
    if (message) return { status: "invalid", message };
    return unavailable();
  }
}

export async function deleteFiscalNoteAction(_previous:AdjustmentActionState,formData:FormData):Promise<AdjustmentActionState>{
 await requireAuthenticatedPage();await assertSameOrigin();
 if(process.env.TRIA_DEMO_WRITES!=="enabled")return unavailable();
 try{
  const projects=await deleteFiscalNote({id:text(formData,'fiscalNoteId'),expectedRevision:assertRevision(text(formData,'expectedRevision')),requestId:assertRequestId(text(formData,'requestId')),reason:assertAdjustmentReason(text(formData,'reason'))});
  revalidatePath('/');revalidatePath('/notas-fiscais');revalidatePath('/projetos');
  for(const id of projects){revalidatePath(`/projetos/${id}`);revalidatePath(`/projetos/${id}/conferir`);}
  return {status:'saved',message:'Nota excluída dos valores vigentes. Histórico e pagamentos preservados.'};
 }catch(error){
  if(error instanceof AdjustmentConflictError)return {status:'conflict',message:error.message,currentRevision:error.current.revision};
  const message=safeValidationMessage(error);return message?{status:'invalid',message}:unavailable();
 }
}
