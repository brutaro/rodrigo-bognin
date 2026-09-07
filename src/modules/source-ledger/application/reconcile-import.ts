import { randomUUID } from "node:crypto";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import {
  canonicalTimestamp,
  createStableRecordId,
  orderOfficialLines,
  reconcileConfirmedPreview,
  rootRequestHashFor,
  validateConfirmedPreviewRequest,
  type MatchingPolicy,
  type Reconciliation,
  type PublicReconciliation,
  type ReconciliationDecision,
} from "../domain/reconciliation";
import { ReconciliationDeadlockFailure, ReconciliationDecisionInvalid, ReconciliationIdempotencyConflict, ReconciliationIntegrityFailure, ReconciliationNotFoundFailure, ReconciliationProjectionConflict, ReconciliationRevisionConflict, type AbsencePage, type SourceReconciliationRepository, type ReconciliationDecisionReceipt, type StableRecordPage } from "./reconciliation-repository";
import type { EffectiveSnapshot } from "../domain/reconciliation";
import type { StableRecord } from "../domain/reconciliation";

export type PublicReconciliationApplyResult = { reconciliation: PublicReconciliation; projectionVersion: string; reused: boolean; eventCount: number };

const namespacePattern = /^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/;

export function syntheticReconciliationEnabled() {
  return process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD === "synthetic-fixtures-only" &&
    process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
    process.env.TRIA_RUNTIME !== "railway" &&
    namespacePattern.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
}

export class SourceReconciliationError extends Error {
  constructor(readonly code: string, message: string, readonly requestId: string, readonly leafReconciliationId?: string) {
    super(message);
    this.name = "SourceReconciliationError";
  }
}

function gate(requestId: string) {
  if (!syntheticReconciliationEnabled()) throw new SourceReconciliationError("SOURCE_PROCESSING_DISABLED", "A reconciliação está disponível somente para fixtures sintéticas isoladas.", requestId);
}

function safeError(error: unknown, requestId: string) {
  if (error instanceof SourceReconciliationError) return error;
  if (error instanceof ReconciliationDeadlockFailure) return new SourceReconciliationError("RECONCILIATION_DEADLOCK", "A reconciliação foi interrompida por contenção concorrente. Tente novamente.", requestId);
  if (error instanceof ReconciliationDecisionInvalid) return new SourceReconciliationError("DECISION_INVALID", "A decisão não é válida para o estado atual da reconciliação.", requestId);
  if (error instanceof ReconciliationNotFoundFailure) return new SourceReconciliationError("RECONCILIATION_NOT_FOUND", "A reconciliação não foi encontrada.", requestId);
  if (error instanceof ReconciliationIntegrityFailure) return new SourceReconciliationError("RECONCILIATION_INTEGRITY_FAILURE", "O estado derivado da reconciliação está indisponível.", requestId);
  if (error instanceof ReconciliationIdempotencyConflict) return new SourceReconciliationError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro pedido.", requestId);
  if (error instanceof ReconciliationProjectionConflict) return new SourceReconciliationError("PROJECTION_VERSION_CONFLICT", "A projeção mudou enquanto a decisão era registrada. Reabra a revisão atual para continuar.", requestId);
  if (error instanceof ReconciliationRevisionConflict) return new SourceReconciliationError("REVISION_CONFLICT", "Uma decisão mais recente já foi registrada. Reabra a revisão atual para continuar.", requestId, error.leafReconciliationId);
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "40001") return new SourceReconciliationError("PROJECTION_VERSION_CONFLICT", "A projeção mudou. Reabra a prévia para reconciliar sobre a versão atual.", requestId);
  if (error instanceof Error) return new SourceReconciliationError("RECONCILIATION_INVALID", "A reconciliação não pôde ser concluída.", requestId);
  return new SourceReconciliationError("RECONCILIATION_UNAVAILABLE", "A reconciliação não está disponível neste ambiente.", requestId);
}

function sameDecisionSet(left: ReconciliationDecision[], right: ReconciliationDecision[]) {
  // The server owns decidedAt; compare the logical acts when deciding whether
  // a confirmation replay is equivalent.
  const normalize = (decisions: ReconciliationDecision[]) => decisions.map((decision) => ({ id: decision.id, observationId: decision.observationId, locator: decision.locator ?? null, stableRecordId: decision.stableRecordId ?? null, outcome: decision.outcome, actor: decision.actor, policyVersion: decision.policyVersion, rationale: decision.rationale, version: decision.version, revisionNo: decision.revisionNo ?? null })).sort((a, b) => `${a.observationId}:${a.locator ?? ""}:${a.id}`.localeCompare(`${b.observationId}:${b.locator ?? ""}:${b.id}`));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

type PublicStableContext = NonNullable<Reconciliation["availableStableRecords"]>[number];
const PUBLIC_MATCH_FIELDS = new Set(["referencia", "stable_key", "case_key"]);
const PUBLIC_CONTEXT_FIELDS = new Set(["codigo", "referencia", "data", "valor", "duracao", "stable_key", "case_key"]);
function allowlisted<T>(value: Record<string, T> | undefined, fields: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([field]) => fields.has(field))) as Record<string, T>;
}

function publicStableContexts(records: StableRecord[]): PublicStableContext[] {
  return records.filter((record) => record.state !== "disregarded").map((record) => ({
    id: record.id,
    matchingAttributes: allowlisted(record.matchingAttributes, PUBLIC_MATCH_FIELDS),
    effectiveLayer: record.effectiveLayer ?? "source",
    effectivePayload: allowlisted(record.effectivePayload ?? record.sourcePayload, PUBLIC_CONTEXT_FIELDS),
    ...(record.decimalSources ? { decimalSources: allowlisted(record.decimalSources, PUBLIC_CONTEXT_FIELDS) } : {}),
    ...(record.durationSources ? { durationSources: allowlisted(record.durationSources, PUBLIC_CONTEXT_FIELDS) } : {}),
    ...(record.effectiveVersion !== undefined ? { effectiveVersion: String(record.effectiveVersion) } : {}),
  }));
}

function publicStableContextsFromSnapshot(snapshot: EffectiveSnapshot): PublicStableContext[] {
  return snapshot.projection.filter((record) => record.state !== "disregarded").map((record) => ({
    id: record.recordId,
    matchingAttributes: {},
    effectiveLayer: record.decisionEventId ? "decision" as const : record.adjustmentEventId ? "adjustment" as const : "source" as const,
    effectivePayload: allowlisted(record.payload, PUBLIC_CONTEXT_FIELDS),
    ...(record.decimalSources ? { decimalSources: allowlisted(record.decimalSources, PUBLIC_CONTEXT_FIELDS) } : {}),
    ...(record.durationSources ? { durationSources: allowlisted(record.durationSources, PUBLIC_CONTEXT_FIELDS) } : {}),
    effectiveVersion: String(record.version),
  }));
}

function publicReconciliation(value: Reconciliation, records?: PublicStableContext[]): PublicReconciliation {
  const result = structuredClone(value);
  const decimalField = [...new Set(result.lines.flatMap((line) => Object.keys(line.observation.decimalSources ?? {})))].sort()[0];
  const durationField = [...new Set(result.lines.flatMap((line) => Object.keys(line.observation.durationSources ?? {})))].sort()[0];
  result.lines = orderOfficialLines(result.lines, decimalField ? { field: decimalField, kind: "decimal" } : durationField ? { field: durationField, kind: "duration" } : undefined, records ?? value.availableStableRecords);
  Reflect.deleteProperty(result, "availableStableRecordIds");
  Reflect.deleteProperty(result, "availableStableRecords");
  // Absence rows are a server-side page, while summary.absent remains the
  // authoritative global count. Keep the internal shape typed for domain
  // callers but omit the potentially large collection from the public DTO.
  Reflect.deleteProperty(result, "absences");
  Reflect.deleteProperty(result, "rootRequestHash");
  Reflect.deleteProperty(result, "absenceCommitment");
  return result as PublicReconciliation;
}

export type ReconcileConfirmedPreviewCommand = {
  actor: "Rodrigo";
  requestId: string;
  idempotencyKey: string;
  confirmation: PreviewConfirmation;
  preview: Preview;
  policy: MatchingPolicy;
  decisions?: ReconciliationDecision[];
  baseProjectionVersion?: string;
};

export type RecordReconciliationDecisionCommand = {
  actor: "Rodrigo";
  requestId: string;
  reconciliationId: string;
  // The transport boundary deliberately has no decidedAt field. The instant
  // is issued immediately before persistence and the SECURITY DEFINER layer
  // validates that it is recent; callers cannot replay an arbitrary clock.
  decision: Omit<ReconciliationDecision, "id" | "actor" | "decidedAt"> & { id?: string };
};

function validateDecisionIntent(decision: RecordReconciliationDecisionCommand["decision"], requestId: string) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (decision.id !== undefined || !uuid.test(decision.observationId) || !decision.locator || decision.locator.length > 200 || decision.locator.trim() !== decision.locator ||
      !decision.rationale || decision.rationale.trim() !== decision.rationale || decision.rationale.length < 3 || decision.rationale.length > 1000 ||
      !decision.version || decision.version.length > 120 || !decision.policyVersion || decision.policyVersion.length > 120 ||
      !["link","create","keep-current","reject"].includes(decision.outcome) ||
      ((decision.outcome === "link" || decision.outcome === "keep-current") ? !decision.stableRecordId || !uuid.test(decision.stableRecordId) : decision.stableRecordId !== undefined)) {
    throw new SourceReconciliationError("DECISION_INVALID", "A decisão não tem a forma canônica esperada.", requestId);
  }
}

export type ApplyReconciliationCommand = {
  actor: "Rodrigo";
  requestId: string;
  reconciliationId: string;
  idempotencyKey: string;
};

function compactDecisionReceipt(before: Reconciliation, after: Reconciliation, reused: boolean, observationId?: string): ReconciliationDecisionReceipt {
  const beforeLines = new Map(before.lines.map((line) => [line.observation.id, JSON.stringify(line)]));
  let changedLines = after.lines.filter((line) => beforeLines.get(line.observation.id) !== JSON.stringify(line));
  if(reused)changedLines=[];
  const beforeAbsences = new Map(before.absences.map((item) => [item.stableRecordId, item]));
  const afterAbsences = new Map(after.absences.map((item) => [item.stableRecordId, item]));
  const absenceChanges = [
    ...[...beforeAbsences.keys()].filter((id) => !afterAbsences.has(id)).map((stableRecordId) => ({ stableRecordId, absent: false as const })),
    ...[...afterAbsences].filter(([id, item]) => JSON.stringify(beforeAbsences.get(id)) !== JSON.stringify(item)).map(([stableRecordId, item]) => ({ stableRecordId, absent: true as const, item })),
  ];
  if(reused)absenceChanges.length=0;
  const decision = after.lines.find((line) => line.observation.id === observationId)?.decision ?? changedLines.find((line) => line.decision)?.decision ?? [...after.decisions].sort((left, right) => (right.revisionNo ?? 0)-(left.revisionNo ?? 0))[0];
  if (!decision) throw new Error("A revisão não contém uma decisão efetiva.");
  return { id: after.id, reconciliationId: after.id, ...(after.parentReconciliationId ? { parentReconciliationId: after.parentReconciliationId } : {}),
    revisionNo: after.revisionNo ?? "1", fingerprint: after.fingerprint, status: after.status, summary: structuredClone(after.summary),
    ...(after.metrics ? { metrics: structuredClone(after.metrics) } : {}), decisionCount: after.decisions.length, reused,
    canonicalReopenRequired: true, createdAt: after.createdAt,
    decision: structuredClone(decision), changedLines: structuredClone(changedLines), absenceChanges: structuredClone(absenceChanges) };
}

export class SourceReconciliationService {
  constructor(private readonly repository: SourceReconciliationRepository) {}

  private async assertCurrentLeaf(reconciliationId: string) {
    const leafId = await this.repository.currentLeafId(reconciliationId);
    if (!leafId) throw new ReconciliationNotFoundFailure();
    if (leafId !== reconciliationId) throw new ReconciliationRevisionConflict(leafId);
  }

  private async replayView(value: Reconciliation) {
    const tokenBefore=await this.repository.currentReadToken(value.id);
    if(!tokenBefore)throw new ReconciliationNotFoundFailure();
    const current=await this.repository.findReconciliation(tokenBefore.leafId);
    if(!current)throw new ReconciliationIntegrityFailure();
    if(current.reconciliation.status==="applied"){
      const snapshot=await this.repository.findSnapshotByReconciliation(current.reconciliation.id);
      if(!snapshot)throw new ReconciliationIntegrityFailure();
      return publicReconciliation(current.reconciliation,publicStableContextsFromSnapshot(snapshot));
    }
    const records=await this.repository.listStableRecords();
    const tokenAfter=await this.repository.currentReadToken(current.reconciliation.id);
    if(!tokenAfter||tokenAfter.leafId!==tokenBefore.leafId)throw new ReconciliationRevisionConflict(tokenAfter?.leafId??tokenBefore.leafId);
    if(tokenAfter.projectionVersion!==tokenBefore.projectionVersion)throw new ReconciliationProjectionConflict();
    return publicReconciliation(current.reconciliation,publicStableContexts(records));
  }

  private async publicView(value: Reconciliation) {
    if (value.status === "applied") {
      const snapshot = await this.repository.findSnapshotByReconciliation(value.id);
      if (!snapshot) throw new ReconciliationIntegrityFailure();
      return publicReconciliation(value, publicStableContextsFromSnapshot(snapshot));
    }
    const tokenBefore = await this.repository.currentReadToken(value.id);
    if (!tokenBefore) throw new ReconciliationNotFoundFailure();
    if (tokenBefore.leafId !== value.id) throw new ReconciliationRevisionConflict(tokenBefore.leafId);
    const refreshed=await this.repository.findReconciliation(tokenBefore.leafId);
    if(!refreshed)throw new ReconciliationIntegrityFailure();
    if(refreshed.reconciliation.status==="applied"){
      const snapshot=await this.repository.findSnapshotByReconciliation(refreshed.reconciliation.id);
      if(!snapshot)throw new ReconciliationIntegrityFailure();
      return publicReconciliation(refreshed.reconciliation,publicStableContextsFromSnapshot(snapshot));
    }
    if (refreshed.reconciliation.baseProjectionVersion !== tokenBefore.projectionVersion) throw new ReconciliationProjectionConflict();
    const records = await this.repository.listStableRecords();
    const tokenAfter = await this.repository.currentReadToken(value.id);
    if (!tokenAfter || tokenAfter.leafId !== tokenBefore.leafId) throw new ReconciliationRevisionConflict(tokenAfter?.leafId ?? tokenBefore.leafId);
    if (tokenAfter.projectionVersion !== tokenBefore.projectionVersion) throw new ReconciliationProjectionConflict();
    return publicReconciliation(refreshed.reconciliation, publicStableContexts(records));
  }

  async reconcileConfirmedPreview(command: ReconcileConfirmedPreviewCommand): Promise<{ reconciliation: PublicReconciliation; reused: boolean }> {
    gate(command.requestId);
    try {
      validateConfirmedPreviewRequest(command);
      const rootRequestHash = rootRequestHashFor(command);
      // Exact transport replay resolves before any live projection/catalog read.
      const byKey = await this.repository.findReconciliationByIdempotencyKey(command.idempotencyKey);
      if (byKey) {
        if ((command.decisions?.length ?? 0) > 0) throw new ReconciliationIdempotencyConflict();
        if (byKey.reconciliation.rootRequestHash !== rootRequestHash) throw new ReconciliationIdempotencyConflict();
        return { reconciliation: await this.replayView(byKey.reconciliation), reused: true };
      }
      const applied = await this.repository.findAppliedReconciliationByConfirmation(command.confirmation.confirmationId);
      if (applied) {
        if (applied.reconciliation.rootRequestHash !== rootRequestHash || !sameDecisionSet(command.decisions ?? [], applied.reconciliation.decisions)) throw new ReconciliationIdempotencyConflict();
        const aliased = await this.repository.saveReconciliation({ ...applied, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
        return { reconciliation: await this.publicView(aliased.reconciliation), reused: true };
      }
      if ((command.decisions?.length ?? 0) > 0) throw new SourceReconciliationError("RECONCILIATION_INVALID","Decisões devem ser registradas pelo comando separado.",command.requestId);
      const baseProjectionVersion = command.baseProjectionVersion ?? await this.repository.currentProjectionVersion();
      const records = await this.repository.listStableRecords();
      const reconciliation = reconcileConfirmedPreview({ confirmation: command.confirmation, preview: command.preview, records, policy: command.policy, decisions: command.decisions, baseProjectionVersion });
      if (reconciliation.rootRequestHash !== rootRequestHash) throw new ReconciliationIntegrityFailure();
      const byFingerprint = await this.repository.findReconciliationByFingerprint(reconciliation.fingerprint);
      if (byFingerprint) {
        if (byFingerprint.reconciliation.rootRequestHash !== rootRequestHash) throw new ReconciliationIdempotencyConflict();
        const saved = await this.repository.saveReconciliation({ ...byFingerprint, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
        return { reconciliation: await this.publicView(saved.reconciliation), reused: true };
      }
      const saved = await this.repository.saveReconciliation({ reconciliation, fingerprint: reconciliation.fingerprint, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
      return { reconciliation: saved.reconciliation.status === "applied" ? await this.publicView(saved.reconciliation) : publicReconciliation(saved.reconciliation, publicStableContexts(records)), reused: saved.reconciliation.id !== reconciliation.id };
    } catch (error) { throw safeError(error, command.requestId); }
  }

  /** Rebuilds an obsolete comparison with a server monotonic key. */
  async recoverConfirmedPreview(command: Omit<ReconcileConfirmedPreviewCommand, "idempotencyKey" | "baseProjectionVersion">): Promise<{ reconciliation: PublicReconciliation; reused: boolean }> {
    gate(command.requestId);
    try {
      // Recovery is one mandatory repository transaction. The attempt is
      // committed only with the rebuilt root, so a stale/failing rebuild never
      // consumes a durable attempt number.
      const result = await this.repository.recoverConfirmedPreviewAtomically(command);
      return { reconciliation: await this.publicView(result.reconciliation), reused: result.reused };
    } catch (error) {
      throw safeError(error, command.requestId);
    }
  }

  async recordDecision(command: RecordReconciliationDecisionCommand): Promise<ReconciliationDecisionReceipt> {
    gate(command.requestId);
    try {
      validateDecisionIntent(command.decision,command.requestId);
      if (this.repository.recordDecisionAtomically) {
        return await this.repository.recordDecisionAtomically({ reconciliationId: command.reconciliationId, requestId: command.requestId, decision: command.decision });
      }
      const current = await this.repository.findReconciliation(command.reconciliationId);
      if (!current) throw new SourceReconciliationError("RECONCILIATION_NOT_FOUND", "A reconciliação não foi encontrada.", command.requestId);
      if (command.decision.policyVersion !== current.reconciliation.policy.version) throw new SourceReconciliationError("DECISION_INVALID", "A decisão usa uma versão de política diferente da reconciliação.", command.requestId);
      const leaf = await this.repository.findReconciliationLeaf(command.reconciliationId);
      const currentRevision = leaf ?? current;
      if (currentRevision.reconciliation.id !== current.reconciliation.id) {
        const equivalent = currentRevision.reconciliation.decisions.find((existing) => existing.observationId === command.decision.observationId && existing.locator === command.decision.locator && existing.outcome === command.decision.outcome && (command.decision.outcome === "create" || existing.stableRecordId === command.decision.stableRecordId) && existing.policyVersion === command.decision.policyVersion && existing.rationale === command.decision.rationale && existing.version === command.decision.version);
        if (equivalent) return compactDecisionReceipt(current.reconciliation, currentRevision.reconciliation, true, command.decision.observationId);
        if (currentRevision.reconciliation.baseProjectionVersion !== await this.repository.currentProjectionVersion()) throw new ReconciliationProjectionConflict();
        throw new SourceReconciliationError("REVISION_CONFLICT", "Uma decisão mais recente já foi registrada. Reabra a revisão atual para continuar.", command.requestId, currentRevision.reconciliation.id);
      }
      if (currentRevision.reconciliation.status === "applied") {
        const equivalent = currentRevision.reconciliation.decisions.find((existing) => existing.observationId === command.decision.observationId && existing.locator === command.decision.locator && existing.outcome === command.decision.outcome && (command.decision.outcome === "create" || existing.stableRecordId === command.decision.stableRecordId) && existing.policyVersion === command.decision.policyVersion && existing.rationale === command.decision.rationale && existing.version === command.decision.version);
        if (equivalent) return compactDecisionReceipt(current.reconciliation, currentRevision.reconciliation, true, command.decision.observationId);
        throw new SourceReconciliationError("DECISION_INVALID", "A reconciliação já foi aplicada e não aceita novas decisões.", command.requestId);
      }
      const projectionVersion = await this.repository.currentProjectionVersion();
      if (currentRevision.reconciliation.baseProjectionVersion !== projectionVersion) throw new ReconciliationProjectionConflict();
      const working = currentRevision;
      const line = working.reconciliation.lines.find((candidate) => candidate.observation.id === command.decision.observationId);
      if (!line || !command.decision.locator || command.decision.locator !== line.observation.locator) throw new SourceReconciliationError("DECISION_INVALID", "A decisão precisa identificar exatamente a observação e seu locator.", command.requestId);
      const equivalent = working.reconciliation.decisions.find((existing) => existing.observationId === command.decision.observationId && existing.locator === command.decision.locator && existing.outcome === command.decision.outcome && (command.decision.outcome === "create" || existing.stableRecordId === command.decision.stableRecordId) && existing.policyVersion === command.decision.policyVersion && existing.rationale === command.decision.rationale && existing.version === command.decision.version);
      if (equivalent) return compactDecisionReceipt(working.reconciliation, working.reconciliation, true, command.decision.observationId);
      const conflict = working.reconciliation.conflicts.find((candidate) => candidate.observationId === line.observation.id && !candidate.resolution);
      if (!conflict) throw new SourceReconciliationError("DECISION_INVALID", "A decisão precisa resolver um conflito pendente desta reconciliação.", command.requestId);
      const allowed = conflict.code === "PROTECTED_LAYER" ? ["link", "keep-current", "reject"] : conflict.code === "DISREGARDED_RECORD" ? ["reject"] : ["link", "create", "reject"];
      if (!allowed.includes(command.decision.outcome)) throw new SourceReconciliationError("DECISION_INVALID", "Essa decisão não é válida para o conflito selecionado.", command.requestId);
      if (command.decision.outcome === "create" && command.decision.stableRecordId) throw new SourceReconciliationError("DECISION_INVALID", "A identidade será criada somente durante a aplicação.", command.requestId);
      if (command.decision.outcome === "reject" && command.decision.stableRecordId) throw new SourceReconciliationError("DECISION_INVALID", "Uma rejeição não pode carregar um registro estável.", command.requestId);
      if (command.decision.outcome === "link" || command.decision.outcome === "keep-current") {
        if (!command.decision.stableRecordId) throw new SourceReconciliationError("DECISION_INVALID", "Selecione explicitamente um registro estável para vincular.", command.requestId);
        const target = (await this.repository.listStableRecords()).find((record) => record.id === command.decision.stableRecordId);
        if (!target || target.state === "disregarded") throw new SourceReconciliationError("DECISION_INVALID", "O registro estável selecionado não está disponível.", command.requestId);
        if (command.decision.outcome === "keep-current" && command.decision.stableRecordId !== (line.stableRecordId ?? line.match.matchedRecordId)) {
          throw new SourceReconciliationError("DECISION_INVALID", "Manter o atual exige o registro da camada protegida.", command.requestId);
        }
      }
      const decision: ReconciliationDecision = { ...command.decision, ...(command.decision.outcome === "create" ? { stableRecordId: createStableRecordId() } : {}), id: command.decision.id ?? randomUUID(), actor: command.actor, decidedAt: canonicalTimestamp(new Date().toISOString()) };
      if (!this.repository.saveDecision) throw new Error("O repository não oferece um writer de decisão.");
      const saved = await this.repository.saveDecision(working.reconciliation.id, decision);
      return compactDecisionReceipt(working.reconciliation, saved.reconciliation, false, command.decision.observationId);
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async reopenReconciliation(command: { actor: "Rodrigo"; requestId: string; reconciliationId: string }): Promise<PublicReconciliation> {
    gate(command.requestId);
    try {
      const current = await this.repository.findReconciliation(command.reconciliationId);
      if (!current) throw new SourceReconciliationError("RECONCILIATION_NOT_FOUND", "A reconciliação não foi encontrada.", command.requestId);
      const leaf = await this.repository.findReconciliationLeaf(command.reconciliationId);
      const latest = leaf ?? current;
      const currentVersion = await this.repository.currentProjectionVersion();
      if (latest.reconciliation.status !== "applied" && latest.reconciliation.baseProjectionVersion !== currentVersion) {
        throw new SourceReconciliationError("PROJECTION_VERSION_CONFLICT", "A projeção mudou. Inicie uma nova comparação sobre a versão atual.", command.requestId);
      }
      return this.publicView(latest.reconciliation);
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async reopenLatestReconciliation(command: { actor: "Rodrigo"; requestId: string; previewId: string }): Promise<PublicReconciliation | undefined> {
    gate(command.requestId);
    try {
      const current = await this.repository.findReconciliationByPreview(command.previewId);
      if (!current) return undefined;
      const leaf = await this.repository.findReconciliationLeaf(current.reconciliation.id);
      const latest = leaf ?? current;
      const currentVersion = await this.repository.currentProjectionVersion();
      if (latest.reconciliation.status !== "applied" && latest.reconciliation.baseProjectionVersion !== currentVersion) {
        throw new SourceReconciliationError("PROJECTION_VERSION_CONFLICT", "A reconciliação reaberta ficou obsoleta; recupere a versão vigente.", command.requestId);
      }
      return this.publicView(latest.reconciliation);
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async readOfficialSnapshot(command: { actor: "Rodrigo"; requestId: string; reconciliationId?: string; batchId?: string }): Promise<EffectiveSnapshot | undefined> {
    gate(command.requestId);
    try {
      if (Boolean(command.reconciliationId) === Boolean(command.batchId)) throw new SourceReconciliationError("SNAPSHOT_INVALID", "Informe exatamente a reconciliação ou o lote do snapshot.", command.requestId);
      const snapshot = command.reconciliationId
        ? await this.repository.findSnapshotByReconciliation(command.reconciliationId)
        : await this.repository.findSnapshotByBatch(command.batchId!);
      return snapshot ? structuredClone(snapshot) : undefined;
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async applyReconciliation(command: ApplyReconciliationCommand): Promise<PublicReconciliationApplyResult> {
    gate(command.requestId);
    try {
      const current = await this.repository.findReconciliation(command.reconciliationId);
      if (!current) throw new SourceReconciliationError("RECONCILIATION_NOT_FOUND", "A reconciliação não foi encontrada.", command.requestId);
      const result = await this.repository.applyReconciliation(command);
      return { reconciliation: await this.publicView(result.reconciliation), projectionVersion: String(result.projectionVersion), reused: result.reused, eventCount: result.events.length };
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async searchStableRecords(command: { actor: "Rodrigo"; requestId: string; reconciliationId?: string; query?: string; cursor?: string; page?: number; pageSize?: number }): Promise<StableRecordPage> {
    gate(command.requestId);
    try {
      if (!command.reconciliationId) throw new SourceReconciliationError("RECONCILIATION_INVALID", "A busca exige a revisão vigente da reconciliação.", command.requestId);
      await this.assertCurrentLeaf(command.reconciliationId);
      const result = await this.repository.searchStableRecords({ ...command, reconciliationId: command.reconciliationId });
      return { ...result, records: publicStableContexts(result.records) };
    } catch (error) { throw safeError(error, command.requestId); }
  }

  async listAbsences(command: { actor: "Rodrigo"; requestId: string; reconciliationId: string; cursor?: string; page?: number; pageSize?: number }): Promise<AbsencePage> {
    gate(command.requestId);
    try {
      await this.assertCurrentLeaf(command.reconciliationId);
      const page = await this.repository.listAbsences(command.reconciliationId, command);
      await this.assertCurrentLeaf(command.reconciliationId);
      return page;
    } catch (error) { throw safeError(error, command.requestId); }
  }
}
