"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { getSourceLedgerService, getSourceReconciliationService, SourceReconciliationError } from "@/modules/source-ledger/public";
import { SourceLedgerError } from "@/modules/source-ledger/public";
import { syntheticRegistryIds } from "@/modules/source-ledger/public";
import { SERVER_OWNED_RECONCILIATION_POLICY_VERSION } from "@/modules/source-ledger/public";
import type { AbsencePage, ImportError, MatchingPolicy, Preview, PreviewConfirmation, PublicReconciliation, ReconciliationDecision, ReconciliationDecisionReceipt, PublicReconciliationApplyResult, SourceInspection, EffectiveSnapshot, StableRecordPage } from "@/modules/source-ledger/public";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const registrySchema = z.object({
  schemaId: z.enum([syntheticRegistryIds.schemaId]),
  parserProfileId: z.enum([syntheticRegistryIds.parserProfileId]),
  transformationId: z.enum([syntheticRegistryIds.transformationId]),
  limitsProfileId: z.enum([syntheticRegistryIds.limitsProfileId]),
}).strict();
const sheetSchema = z.object({ sheetId: z.string().min(1).max(200), name: z.string().min(1).max(120), ordinal: z.number().int().nonnegative().max(31), visible: z.boolean() }).strict();
const csvSchema = z.object({
  encoding: z.enum(["utf-8", "utf-8-bom"]),
  delimiter: z.enum([",", ";", "\t", "|"]),
  quote: z.union([z.literal('"'), z.null()]),
  escape: z.literal("double-quote"),
  allowMultilineQuotedField: z.boolean(),
}).strict();
const mappingSchema = z.object({ sourceHeaderId: z.string().regex(/^[0-9a-f]{64}$/i), sourceOrdinal: z.number().int().nonnegative().max(255), logicalFieldId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/) }).strict();
const registryPayload = { registry: registrySchema, sourceFileId: uuid, sheetSelection: sheetSchema.optional(), csvParseOptions: csvSchema.optional() };
const inspectSchema = z.object(registryPayload).strict();
const prepareSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  ...registryPayload,
  mappingSelections: z.array(mappingSchema).max(256),
}).strict();
const confirmationSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  batchId: uuid,
  sourceFormat: z.enum(["CSV", "XLSX"]),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/i),
  rowResultHash: z.string().regex(/^[0-9a-f]{64}$/i),
  previewId: uuid,
  sourceFileId: uuid,
  fileVersionId: uuid,
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  contractHash: z.string().regex(/^[0-9a-f]{64}$/i),
  transformationHash: z.string().regex(/^[0-9a-f]{64}$/i),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();
const reopenSchema = z.object({ previewId: uuid }).strict();
/** Stable evidence is carried by the immutable preview row, never by input. */
function serverOwnedPolicy(preview: Preview): MatchingPolicy {
  const fields = [...new Set(preview.rows.flatMap((row) => Object.keys(row.matchingAttributes ?? {})))].sort();
  return { version: SERVER_OWNED_RECONCILIATION_POLICY_VERSION, fields, evidence: "explicit-stable-attributes" };
}
const reconcileSchema = z.object({ idempotencyKey: z.string().min(1).max(200), previewId: uuid }).strict();
const decisionSchema = z.object({ reconciliationId: uuid, observationId: uuid, locator: z.string().min(1).max(200).optional(), stableRecordId: uuid.optional(), outcome: z.enum(["link", "create", "keep-current", "reject"]), policyVersion: z.string().min(1).max(120), rationale: z.string().trim().min(3).max(1000), version: z.string().min(1).max(120) }).strict();
const applySchema = z.object({ reconciliationId: uuid, idempotencyKey: z.string().min(1).max(200) }).strict();
const snapshotSelectorSchema = z.object({ reconciliationId: uuid.optional(), batchId: uuid.optional() }).strict().refine((value) => Boolean(value.reconciliationId) !== Boolean(value.batchId), { message: "Informe exatamente a reconciliação ou o lote do snapshot." });
const opaqueCursor = z.string().min(40).max(2048);
const paginationShape = {
  cursor: opaqueCursor.optional(),
  page: z.number().int().nonnegative().max(100000).optional(),
  pageSize: z.number().int().positive().max(100).optional(),
};
function enforceCursorContract(value: { page?: number; cursor?: string }, context: z.RefinementCtx) {
  const page = value.page ?? 0;
  if ((page === 0 && value.cursor !== undefined) || (page > 0 && !value.cursor)) context.addIssue({ code: "custom", message: "O cursor deve corresponder exatamente à página solicitada.", path: ["cursor"] });
}
const stableSearchSchema = z.object({ reconciliationId: uuid, query: z.string().trim().max(120).optional(), ...paginationShape }).strict().superRefine(enforceCursorContract);
const absencePageSchema = z.object({ reconciliationId: uuid, ...paginationShape }).strict().superRefine(enforceCursorContract);

export type SourceLedgerActionResult<T> = { ok: true; data: T } | { ok: false; error: ImportError };

async function authorize(requestId: string) {
  const authentication = await apiAuthenticationStatus();
  if (authentication !== "authenticated") throw new SourceLedgerError(authentication === "unavailable" ? "AUTHENTICATION_UNAVAILABLE" : "AUTHENTICATION_REQUIRED", "A sessão do proprietário não está disponível.", requestId);
  await assertSameOrigin();
}

function errorResult(error: unknown, requestId: string): SourceLedgerActionResult<never> {
  if (error instanceof SourceLedgerError) return { ok: false, error: error.toDTO() };
  if (error instanceof SourceReconciliationError) return { ok: false, error: { code: error.code, message: error.message, requestId, kind: "structural", ...(error.leafReconciliationId ? { leafReconciliationId: error.leafReconciliationId } : {}) } };
  return { ok: false, error: { code: "SOURCE_PREPARATION_UNAVAILABLE", message: "A preparação não está disponível neste ambiente.", requestId, kind: "structural" } };
}

export async function inspectConsolidatedSourceAction(input: unknown): Promise<SourceLedgerActionResult<SourceInspection>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = inspectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "IMPORT_CONTRACT_INVALID", message: "A seleção da fonte não é válida.", requestId, kind: "structural" } };
    const data = await getSourceLedgerService().inspectSource({ actor: "Rodrigo", requestId, payload: parsed.data });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function prepareConsolidatedSourceAction(input: unknown): Promise<SourceLedgerActionResult<{ preview: Preview; reused: boolean }>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = prepareSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "IMPORT_CONTRACT_INVALID", message: "O mapeamento da fonte não é válido.", requestId, kind: "structural" } };
    const { idempotencyKey, ...payload } = parsed.data;
    const data = await getSourceLedgerService().prepareImportPreview({ actor: "Rodrigo", requestId, idempotencyKey, payload });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function confirmConsolidatedPreviewAction(input: unknown): Promise<SourceLedgerActionResult<PreviewConfirmation>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = confirmationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "CONFIRMATION_INVALID", message: "A confirmação não é válida.", requestId, kind: "structural" } };
    const { idempotencyKey, ...payload } = parsed.data;
    const data = await getSourceLedgerService().confirmImportPreview({ actor: "Rodrigo", requestId, idempotencyKey, payload });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function reopenConsolidatedPreviewAction(input: unknown): Promise<SourceLedgerActionResult<Preview>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = reopenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PREVIEW_NOT_FOUND", message: "A prévia não está disponível.", requestId, kind: "structural" } };
    const data = await getSourceLedgerService().reopenPreview({ actor: "Rodrigo", requestId, previewId: parsed.data.previewId });
    if (!data) return { ok: false, error: { code: "PREVIEW_NOT_FOUND", message: "A prévia não está disponível.", requestId, kind: "structural" } };
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function reconcileConsolidatedPreviewAction(input: unknown): Promise<SourceLedgerActionResult<{ reconciliation: PublicReconciliation; reused: boolean }>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = reconcileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_INVALID", message: "A política ou a prévia não é válida.", requestId, kind: "structural" } };
    const confirmed = await getSourceLedgerService().reopenConfirmedPreview({ actor: "Rodrigo", requestId, previewId: parsed.data.previewId });
    if (!confirmed) return { ok: false, error: { code: "PREVIEW_NOT_CONFIRMED", message: "Confirme a prévia antes de reconciliar.", requestId, kind: "structural" } };
    const { idempotencyKey } = parsed.data;
    const data = await getSourceReconciliationService().reconcileConfirmedPreview({ actor: "Rodrigo", requestId, idempotencyKey, preview: confirmed.preview, confirmation: confirmed.confirmation, policy: serverOwnedPolicy(confirmed.preview) });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

/** Recovery key is allocated by the service from the current projection version. */
export async function recoverConsolidatedPreviewAction(input: unknown): Promise<SourceLedgerActionResult<{ reconciliation: PublicReconciliation; reused: boolean }>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = reopenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_INVALID", message: "A prévia não é válida para recuperação.", requestId, kind: "structural" } };
    const confirmed = await getSourceLedgerService().reopenConfirmedPreview({ actor: "Rodrigo", requestId, previewId: parsed.data.previewId });
    if (!confirmed) return { ok: false, error: { code: "PREVIEW_NOT_CONFIRMED", message: "Confirme a prévia antes de reconciliar.", requestId, kind: "structural" } };
    return { ok: true, data: await getSourceReconciliationService().recoverConfirmedPreview({ actor: "Rodrigo", requestId, preview: confirmed.preview, confirmation: confirmed.confirmation, policy: serverOwnedPolicy(confirmed.preview) }) };
  } catch (error) { return errorResult(error, requestId); }
}

export async function decideConsolidatedReconciliationAction(input: unknown): Promise<SourceLedgerActionResult<ReconciliationDecisionReceipt>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "DECISION_INVALID", message: "A decisão não é válida.", requestId, kind: "structural" } };
    const { reconciliationId, ...decision } = parsed.data;
    const data = await getSourceReconciliationService().recordDecision({ actor: "Rodrigo", requestId, reconciliationId, decision: decision as Omit<ReconciliationDecision, "id" | "actor" | "decidedAt"> });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function reopenConsolidatedReconciliationAction(input: unknown): Promise<SourceLedgerActionResult<PublicReconciliation>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = z.object({ reconciliationId: uuid }).strict().safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_NOT_FOUND", message: "A reconciliação não está disponível.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().reopenReconciliation({ actor: "Rodrigo", requestId, reconciliationId: parsed.data.reconciliationId });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function reopenConsolidatedReconciliationByPreviewAction(input: unknown): Promise<SourceLedgerActionResult<PublicReconciliation | undefined>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = reopenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_NOT_FOUND", message: "A reconciliação não está disponível.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().reopenLatestReconciliation({ actor: "Rodrigo", requestId, previewId: parsed.data.previewId });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function readConsolidatedReconciliationSnapshotAction(input: unknown): Promise<SourceLedgerActionResult<EffectiveSnapshot | undefined>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = snapshotSelectorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "SNAPSHOT_INVALID", message: "Informe a reconciliação ou o lote do snapshot.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().readOfficialSnapshot({ actor: "Rodrigo", requestId, ...parsed.data });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function searchConsolidatedStableRecordsAction(input: unknown): Promise<SourceLedgerActionResult<StableRecordPage>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = stableSearchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_INVALID", message: "A busca de registros estáveis não é válida.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().searchStableRecords({ actor: "Rodrigo", requestId, ...parsed.data });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function listConsolidatedAbsencesAction(input: unknown): Promise<SourceLedgerActionResult<AbsencePage>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = absencePageSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "RECONCILIATION_INVALID", message: "A página de ausências não é válida.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().listAbsences({ actor: "Rodrigo", requestId, ...parsed.data });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}

export async function applyConsolidatedReconciliationAction(input: unknown): Promise<SourceLedgerActionResult<PublicReconciliationApplyResult>> {
  const requestId = randomUUID();
  try {
    await authorize(requestId);
    const parsed = applySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "APPLICATION_INVALID", message: "A aplicação não é válida.", requestId, kind: "structural" } };
    const data = await getSourceReconciliationService().applyReconciliation({ actor: "Rodrigo", requestId, ...parsed.data });
    return { ok: true, data };
  } catch (error) { return errorResult(error, requestId); }
}
