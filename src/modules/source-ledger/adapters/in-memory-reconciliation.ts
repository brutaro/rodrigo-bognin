import { randomUUID } from "node:crypto";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import type {
  EffectiveRecordEvent,
  EffectiveRecordProjection,
  ReconciliationDecision,
  EffectiveSnapshot,
  MatchingPolicy,
  StableRecord,
} from "../domain/reconciliation";
import { applyReconciliationDecision, compareCanonicalText, compareRfc3339Instants, effectiveRecordContent, eventsForReconciliation, observedTargetForAbsence, reconcileConfirmedPreview, reduceEffectiveProjection } from "../domain/reconciliation";
import { ReconciliationPageCursorCodec, ReconciliationIdempotencyConflict, ReconciliationProjectionConflict, ReconciliationRevisionConflict, type ReconciliationApplyResult, type SourceReconciliationRepository, type StableRecordContext, type StableRecordPage, type StoredReconciliation } from "../application/reconciliation-repository";
import { matchesStableRecordSearch, normalizeStableRecordSearchQuery, stableRecordSearchAttributes } from "../application/stable-record-search";

export { ReconciliationIdempotencyConflict };

function decisionIdentity(decisions: ReconciliationDecision[]) {
  return JSON.stringify([...decisions]
    .sort((left, right) => compareCanonicalText(`${left.observationId}:${left.locator ?? ""}:${left.id}`, `${right.observationId}:${right.locator ?? ""}:${right.id}`))
    .map((decision) => [
      decision.id, decision.observationId, decision.locator ?? null, decision.stableRecordId ?? null,
      decision.outcome, decision.actor, decision.policyVersion, decision.rationale, decision.version,
      decision.revisionNo ?? null,
    ]));
}

export class ReconciliationFailureInjected extends Error {
  constructor(stage: string) { super(`Falha injetada em ${stage}.`); this.name = "ReconciliationFailureInjected"; }
}

function seedEventsForRecord(record: StableRecord): EffectiveRecordEvent[] {
  const current = effectiveRecordContent(record);
  const version = current.version ?? "0";
  const event = (layer: EffectiveRecordEvent["layer"], payload: Record<string, string | null>, id: string, occurredAt: string, finalLayer: boolean): EffectiveRecordEvent => ({
    id,
    recordId: record.id,
    type: layer === "source" ? "observation.accepted" : layer === "adjustment" ? "adjustment.revised" : "decision.audit",
    layer,
    ...(layer === "source" && record.sourceObservationId ? { observationId: record.sourceObservationId } : {}),
    payload: effectiveRecordContent({ id: record.id, sourcePayload: payload }).payload,
    ...(finalLayer && current.decimalSources !== undefined ? { decimalSources: structuredClone(current.decimalSources) } : {}),
    ...(finalLayer && current.durationSources !== undefined ? { durationSources: structuredClone(current.durationSources) } : {}),
    state: record.state ?? "active",
    actor: "Rodrigo",
    occurredAt,
    version,
  });
  const result: EffectiveRecordEvent[] = [];
  if (record.sourcePayload !== undefined || current.layer === "source" || record.sourceObservationId) {
    result.push(event("source", current.layer === "source" ? current.payload : record.sourcePayload ?? {}, `memory-seed-source:${record.id}`, "1970-01-01T00:00:00.000Z", current.layer === "source"));
  }
  if (record.adjustmentPayload !== undefined || current.layer === "adjustment" || record.adjustmentEventId) {
    result.push(event("adjustment", current.layer === "adjustment" ? current.payload : record.adjustmentPayload ?? {}, record.adjustmentEventId ?? `memory-seed-adjustment:${record.id}`, "1970-01-01T00:00:00.001Z", current.layer === "adjustment"));
  }
  if (record.auditedDecisionPayload !== undefined || current.layer === "decision" || record.decisionEventId) {
    result.push(event("decision", current.payload, record.decisionEventId ?? `memory-seed-decision:${record.id}`, "1970-01-01T00:00:00.002Z", true));
  }
  return result;
}

export type InMemoryReconciliationDiagnostics = {
  applyLineLookups: number;
  applySourceEventLookups: number;
  leafLookups: number;
  leafIndexUpdates: number;
  previewRootScans: number;
};

export class InMemorySourceReconciliationRepository implements SourceReconciliationRepository {
  private readonly byFingerprint = new Map<string, StoredReconciliation>();
  private readonly byKey = new Map<string, StoredReconciliation>();
  private readonly reconcileByKey = new Map<string, StoredReconciliation>();
  private readonly byId = new Map<string, StoredReconciliation>();
  private readonly rootByReconciliationId = new Map<string, string>();
  private readonly currentLeafByRoot = new Map<string, StoredReconciliation>();
  private readonly rootsByPreview = new Map<string, Set<string>>();
  readonly diagnostics: InMemoryReconciliationDiagnostics = { applyLineLookups: 0, applySourceEventLookups: 0, leafLookups: 0, leafIndexUpdates: 0, previewRootScans: 0 };
  private readonly decisionsByReconciliation = new Map<string, ReconciliationDecision[]>();
  private readonly records = new Map<string, StableRecord>();
  private readonly seedEvents: EffectiveRecordEvent[] = [];
  private events: EffectiveRecordEvent[] = [];
  private projections: EffectiveRecordProjection[] = [];
  private appliedByKey = new Map<string, ReconciliationApplyResult>();
  private readonly applicationsByReconciliation = new Map<string, ReconciliationApplyResult>();
  private readonly snapshots = new Map<string, EffectiveSnapshot>();
  private readonly recoveryAttempts = new Map<string, number>();
  private decisionWrites: Promise<void> = Promise.resolve();
  private recoveryWrites: Promise<void> = Promise.resolve();
  private version = 0n;
  private readonly cursorCodec: ReconciliationPageCursorCodec;
  /** Test-only hook: the next application fails at the named stage and rolls back. */
  failureStage?: "before-observation" | "after-event" | "after-projection" | "after-audit";

  constructor(records: StableRecord[] = [], cursorMasterKey?: Uint8Array) {
    this.cursorCodec = new ReconciliationPageCursorCodec(cursorMasterKey);
    for (const record of records) {
      const stored = structuredClone(record);
      this.records.set(record.id, stored);
      this.seedEvents.push(...seedEventsForRecord(stored));
    }
    this.projections = reduceEffectiveProjection(this.seedEvents);
  }

  get eventCount() { return this.events.length; }
  get projectionCount() { return this.projections.length; }
  get stableRecordCount() { return this.records.size; }
  get appliedCount() { return this.applicationsByReconciliation.size; }
  get auditEventCount() { return this.applicationsByReconciliation.size; }
  get allEvents() { return structuredClone([...this.seedEvents, ...this.events]); }
  get allProjections() { return structuredClone(this.projections); }

  async findReconciliationByFingerprint(fingerprint: string) {
    const stored = this.byFingerprint.get(fingerprint);
    if (!stored) return undefined;
    const leaf = await this.findReconciliationLeaf(stored.reconciliation.id);
    return structuredClone(leaf ? { ...leaf, idempotencyKey: stored.idempotencyKey } : stored);
  }
  async findReconciliationByIdempotencyKey(idempotencyKey: string) {
    const stored=this.reconcileByKey.get(idempotencyKey);
    if(!stored)return undefined;
    const rootId=this.rootByReconciliationId.get(stored.reconciliation.id)??stored.reconciliation.id;
    const leaf=this.currentLeafByRoot.get(rootId);
    return structuredClone(leaf?{...leaf,idempotencyKey}:stored);
  }
  async findReconciliationByPreview(previewId: string) {
    const rootIds = this.rootsByPreview.get(previewId) ?? new Set<string>();
    this.diagnostics.previewRootScans += rootIds.size;
    const matches = [...rootIds]
      .map((rootId) => this.currentLeafByRoot.get(rootId))
      .filter((stored): stored is StoredReconciliation => stored !== undefined)
      .sort((left, right) => {
        const baseVersion = BigInt(right.reconciliation.baseProjectionVersion) - BigInt(left.reconciliation.baseProjectionVersion);
        if (baseVersion !== 0n) return baseVersion < 0n ? -1 : 1;
        const revision = BigInt(right.reconciliation.revisionNo ?? 1) - BigInt(left.reconciliation.revisionNo ?? 1);
        return revision < 0n ? -1 : revision > 0n ? 1 : compareCanonicalText(right.reconciliation.createdAt, left.reconciliation.createdAt) || compareCanonicalText(right.reconciliation.id, left.reconciliation.id);
      });
    return matches[0] && structuredClone(matches[0]);
  }
  async findReconciliation(reconciliationId: string) { return this.byId.get(reconciliationId) && structuredClone(this.byId.get(reconciliationId)); }
  async findAppliedReconciliationByConfirmation(confirmationId: string) {
    const result = [...this.applicationsByReconciliation.values()].filter((candidate) => candidate.reconciliation.confirmationId === confirmationId).sort((left, right) => compareCanonicalText(right.appliedAt, left.appliedAt))[0];
    return result ? structuredClone(await this.findReconciliationLeaf(result.reconciliation.id) ?? this.byId.get(result.reconciliation.id)) : undefined;
  }
  async findReconciliationLeaf(reconciliationId: string) {
    this.diagnostics.leafLookups += 1;
    const rootId = this.rootByReconciliationId.get(reconciliationId);
    const leaf = rootId ? this.currentLeafByRoot.get(rootId) : undefined;
    return leaf && structuredClone(leaf);
  }
  async currentLeafId(reconciliationId: string) {
    const rootId = this.rootByReconciliationId.get(reconciliationId);
    return rootId ? this.currentLeafByRoot.get(rootId)?.reconciliation.id : undefined;
  }
  async currentReadToken(reconciliationId: string) {
    const rootId=this.rootByReconciliationId.get(reconciliationId);
    const leafId=rootId ? this.currentLeafByRoot.get(rootId)?.reconciliation.id : undefined;
    return leafId ? { leafId, projectionVersion: this.version.toString() } : undefined;
  }

  async saveReconciliation(value: StoredReconciliation) {
    const byKey = this.reconcileByKey.get(value.idempotencyKey);
    if (byKey && byKey.reconciliation.rootRequestHash !== value.reconciliation.rootRequestHash) throw new ReconciliationIdempotencyConflict();
    if (byKey) {
      const leaf = await this.findReconciliationLeaf(byKey.reconciliation.id);
      return structuredClone(leaf ?? byKey);
    }
    const sameConfirmation = [...this.applicationsByReconciliation.values()].find((result) => result.reconciliation.confirmationId === value.reconciliation.confirmationId);
    if (sameConfirmation) {
      const sameDecisions = decisionIdentity(sameConfirmation.audit.decisions) === decisionIdentity(value.reconciliation.decisions);
      if (!sameDecisions || sameConfirmation.reconciliation.rootRequestHash !== value.reconciliation.rootRequestHash) throw new ReconciliationIdempotencyConflict();
      const stored = this.byId.get(sameConfirmation.reconciliation.id);
      if (!stored) throw new Error("A reconciliação aplicada não pôde ser recuperada.");
      this.byKey.set(value.idempotencyKey,stored);this.reconcileByKey.set(value.idempotencyKey,stored);
      return structuredClone({ ...stored, idempotencyKey: value.idempotencyKey });
    }
    const byFingerprint = this.byFingerprint.get(value.fingerprint);
    if (byFingerprint) {
      this.byKey.set(value.idempotencyKey,byFingerprint);this.reconcileByKey.set(value.idempotencyKey,byFingerprint);
      const leaf = await this.findReconciliationLeaf(byFingerprint.reconciliation.id);
      return structuredClone(leaf ?? byFingerprint);
    }
    const stored = structuredClone(value);
    this.byFingerprint.set(stored.fingerprint, stored);
    this.byKey.set(stored.idempotencyKey,stored);this.reconcileByKey.set(stored.idempotencyKey,stored);
    this.byId.set(stored.reconciliation.id, stored);
    const rootId = stored.reconciliation.id;
    this.rootByReconciliationId.set(rootId, rootId);
    this.currentLeafByRoot.set(rootId, stored);
    const previewRoots = this.rootsByPreview.get(stored.reconciliation.previewId);
    if (previewRoots) previewRoots.add(rootId);
    else this.rootsByPreview.set(stored.reconciliation.previewId, new Set([rootId]));
    return structuredClone(stored);
  }

  async saveDecision(reconciliationId: string, decision: ReconciliationDecision) {
    const previous = this.decisionWrites;
    let release!: () => void;
    this.decisionWrites = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
    const stored = this.byId.get(reconciliationId);
    if (!stored) throw new Error("A reconciliação não foi encontrada.");
    const leaf = await this.findReconciliationLeaf(reconciliationId);
    if (!leaf) throw new Error("A reconciliação não foi encontrada.");
    const equivalent = leaf.reconciliation.decisions.find((existing) => existing.observationId === decision.observationId && existing.locator === decision.locator && existing.outcome === decision.outcome && (decision.outcome === "create" || existing.stableRecordId === decision.stableRecordId) && existing.policyVersion === decision.policyVersion && existing.rationale === decision.rationale && existing.version === decision.version);
    if (equivalent) return structuredClone(leaf);
    if (leaf.reconciliation.id !== reconciliationId) throw new ReconciliationRevisionConflict(leaf.reconciliation.id);
    if (stored.reconciliation.status === "applied") throw new Error("reconciliation already applied");
    if (stored.reconciliation.baseProjectionVersion !== String(this.version)) throw new ReconciliationProjectionConflict();
    if ((decision.outcome === "link" || decision.outcome === "keep-current") && (!decision.stableRecordId || this.records.get(decision.stableRecordId)?.state === "disregarded" || !this.records.has(decision.stableRecordId))) throw new Error("stable record target unavailable");
    const next = applyReconciliationDecision(stored.reconciliation, decision);
    if (next.id === stored.reconciliation.id) return structuredClone(stored);
    const nextStored: StoredReconciliation = { ...structuredClone(stored), reconciliation: next, fingerprint: next.fingerprint, idempotencyKey: `decision-${decision.id}` };
    this.byFingerprint.set(nextStored.fingerprint, nextStored);
    this.byKey.set(nextStored.idempotencyKey, nextStored);
    this.byId.set(nextStored.reconciliation.id, nextStored);
    const rootId = this.rootByReconciliationId.get(reconciliationId) ?? reconciliationId;
    this.rootByReconciliationId.set(nextStored.reconciliation.id, rootId);
    this.currentLeafByRoot.set(rootId, nextStored);
    this.diagnostics.leafIndexUpdates += 1;
    this.decisionsByReconciliation.set(nextStored.reconciliation.id, structuredClone(nextStored.reconciliation.decisions));
    return structuredClone(nextStored);
    } finally {
      release();
    }
  }

  async listDecisions(reconciliationId: string) { return structuredClone(this.decisionsByReconciliation.get(reconciliationId) ?? []); }
  async listStableRecords() {
    return [...this.records.values()].map((record) => {
      const current = effectiveRecordContent(record);
      return structuredClone({
        ...record,
        effectivePayload: current.payload,
        effectiveLayer: current.layer,
        ...(current.decimalSources !== undefined ? { decimalSources: current.decimalSources } : {}),
        ...(current.durationSources !== undefined ? { durationSources: current.durationSources } : {}),
        ...(current.version !== undefined ? { effectiveVersion: current.version } : {}),
      });
    });
  }
  async searchStableRecords(input: { reconciliationId: string; query?: string; cursor?: string; page?: number; pageSize?: number }): Promise<StableRecordPage> {
    const query = normalizeStableRecordSearchQuery(input.query);
    const token = await this.currentReadToken(input.reconciliationId);
    if (!token || token.leafId !== input.reconciliationId) throw new ReconciliationRevisionConflict(token?.leafId ?? input.reconciliationId);
    const { page, pageSize, afterId, binding } = this.cursorCodec.strictRequest(input, "stable", input.reconciliationId, query, `stable-search:v1:projection:${token.projectionVersion}`);
    const records = [...this.records.values()]
      .filter((record) => matchesStableRecordSearch(record, query))
      .sort((left, right) => compareCanonicalText(left.id, right.id));
    const afterCursor = records.filter((record) => !afterId || compareCanonicalText(record.id, afterId) > 0);
    const visible = afterCursor.slice(0, pageSize);
    const contexts: StableRecordContext[] = visible.map((record) => {
      const current = effectiveRecordContent(record);
      return {
        id: record.id,
        matchingAttributes: structuredClone(stableRecordSearchAttributes(record.matchingAttributes)),
        effectiveLayer: current.layer,
        effectivePayload: structuredClone(current.payload),
        ...(current.decimalSources !== undefined ? { decimalSources: structuredClone(current.decimalSources) } : {}),
        ...(current.durationSources !== undefined ? { durationSources: structuredClone(current.durationSources) } : {}),
        ...(current.version !== undefined ? { effectiveVersion: current.version } : {}),
      };
    });
    const tokenAfter = await this.currentReadToken(input.reconciliationId);
    if (!tokenAfter || tokenAfter.leafId !== token.leafId) throw new ReconciliationRevisionConflict(tokenAfter?.leafId ?? input.reconciliationId);
    if (tokenAfter.projectionVersion !== token.projectionVersion) throw new ReconciliationProjectionConflict();
    const nextCursor = afterCursor.length > pageSize && visible.length
      ? this.cursorCodec.issue({ ...binding, page: page + 1 }, visible.at(-1)!.id) : undefined;
    return { page, pageSize, total: String(records.length), records: contexts, ...(nextCursor ? { nextCursor } : {}) };
  }
  async listAbsences(reconciliationId: string, input: { cursor?: string; page?: number; pageSize?: number }) {
    const { page, pageSize, afterId, binding } = this.cursorCodec.strictRequest(input, "absence", reconciliationId, "", `leaf:${reconciliationId}`);
    const stored = this.byId.get(reconciliationId);
    const snapshot = this.snapshots.get(reconciliationId);
    const observed = new Set((stored?.reconciliation.lines ?? [])
      .map(observedTargetForAbsence)
      .filter((target): target is string => target !== undefined));
    const absences = snapshot
      ? snapshot.projection.filter((record) => record.state === "active" && !observed.has(record.recordId)).map((record) => ({ stableRecordId: record.recordId, status: "not_observed_this_batch" as const, label: "Não observado neste lote" as const, effectivePayload: structuredClone(record.payload), effectiveVersion: String(record.version) }))
      : stored?.reconciliation.absences ?? [];
    const ordered = [...absences].sort((left, right) => compareCanonicalText(left.stableRecordId, right.stableRecordId));
    const afterCursor = ordered.filter((absence) => !afterId || compareCanonicalText(absence.stableRecordId, afterId) > 0);
    const visible = afterCursor.slice(0, pageSize);
    const nextCursor = afterCursor.length > pageSize && visible.length
      ? this.cursorCodec.issue({ ...binding, page: page + 1 }, visible.at(-1)!.stableRecordId) : undefined;
    return { page, pageSize, total: String(ordered.length), absences: structuredClone(visible), ...(nextCursor ? { nextCursor } : {}) };
  }
  async nextRecoveryAttempt(confirmationId: string, projectionVersion: string) {
    void projectionVersion;
    const attempt = (this.recoveryAttempts.get(confirmationId) ?? 0) + 1;
    this.recoveryAttempts.set(confirmationId, attempt);
    return String(attempt);
  }
  async recoverConfirmedPreviewAtomically(input: { actor: "Rodrigo"; requestId: string; confirmation: PreviewConfirmation; preview: Preview; policy: MatchingPolicy }) {
    const previous = this.recoveryWrites;
    let release!: () => void;
    this.recoveryWrites = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const applied = await this.findAppliedReconciliationByConfirmation(input.confirmation.confirmationId);
      if (applied) return { reconciliation: applied.reconciliation, reused: true };
      const version = String(this.version);
      const priorAttempt = this.recoveryAttempts.get(input.confirmation.confirmationId) ?? 0;
      const attempt = priorAttempt + 1;
      const records = await this.listStableRecords();
      const reconciliation = reconcileConfirmedPreview({ confirmation: input.confirmation, preview: input.preview, records, policy: input.policy, baseProjectionVersion: version });
      const idempotencyKey = `reconcile-recovery-${input.confirmation.confirmationId}-${version}-${attempt}`;
      const saved = await this.saveReconciliation({ reconciliation, fingerprint: reconciliation.fingerprint, idempotencyKey, requestId: input.requestId });
      // Commit the allocator only after the root is durably present.
      this.recoveryAttempts.set(input.confirmation.confirmationId, attempt);
      return { reconciliation: saved.reconciliation, reused: saved.reconciliation.id !== reconciliation.id };
    } finally {
      release();
    }
  }
  async currentProjectionVersion() { return String(this.version); }
  async listProjection() { return structuredClone(this.projections); }
  async findSnapshotByReconciliation(reconciliationId: string) {
    const snapshot = this.snapshots.get(reconciliationId);
    return snapshot && structuredClone(snapshot);
  }
  async findSnapshotByBatch(batchId: string) {
    const snapshot = [...this.snapshots.values()].filter((candidate) => candidate.batchId === batchId).sort((left, right) => {
      const projectionVersion = BigInt(right.projectionVersion) - BigInt(left.projectionVersion);
      return projectionVersion < 0n ? -1 : projectionVersion > 0n ? 1 : compareCanonicalText(right.createdAt, left.createdAt) || compareCanonicalText(right.id, left.id);
    })[0];
    return snapshot && structuredClone(snapshot);
  }

  async applyReconciliation(input: { reconciliationId: string; idempotencyKey: string; requestId: string; actor: "Rodrigo" }) {
    const leafId = await this.currentLeafId(input.reconciliationId);
    if (!leafId) throw new Error("A reconciliação não foi encontrada.");
    if (leafId !== input.reconciliationId) throw new ReconciliationRevisionConflict(leafId);
    const replay = this.appliedByKey.get(input.idempotencyKey);
    if (replay && replay.reconciliation.id !== input.reconciliationId) throw new ReconciliationIdempotencyConflict();
    if (replay) return { ...structuredClone(replay), reused: true };
    const sameReconciliation = this.applicationsByReconciliation.get(input.reconciliationId);
    if (sameReconciliation) {
      this.appliedByKey.set(input.idempotencyKey, structuredClone(sameReconciliation));
      return { ...structuredClone(sameReconciliation), reused: true };
    }
    const stored = this.byId.get(input.reconciliationId);
    if (!stored) throw new Error("A reconciliação não foi encontrada.");
    if (stored.reconciliation.status !== "ready-to-apply" && stored.reconciliation.status !== "applied") throw new Error("Resolva todos os conflitos antes de aplicar.");
    if (stored.reconciliation.status !== "applied" && stored.reconciliation.baseProjectionVersion !== String(this.version)) throw new ReconciliationProjectionConflict();
    const before = { events: structuredClone(this.events), projections: structuredClone(this.projections), records: structuredClone([...this.records.values()]), version: this.version, reconciliation: structuredClone(stored.reconciliation) };
    const failureStage = this.failureStage;
    this.failureStage = undefined;
    try {
      if (failureStage === "before-observation") throw new ReconciliationFailureInjected("observation");
      const events = eventsForReconciliation(stored.reconciliation, [...this.records.values()]);
      if (failureStage === "after-event") throw new ReconciliationFailureInjected("event");
      const nextEvents = [...this.events, ...events];
      const allEvents = [...this.seedEvents, ...nextEvents];
      const lineByObservationId = new Map(stored.reconciliation.lines.map((line) => [line.observation.id, line]));
      const sourceEventByObservationId = new Map<string, EffectiveRecordEvent>();
      for (const event of allEvents) {
        if (event.layer !== "source" || (event.type !== "observation.accepted" && event.type !== "record.inserted") || !event.observationId) continue;
        const current = sourceEventByObservationId.get(event.observationId);
        if (!current || compareRfc3339Instants(current.occurredAt, event.occurredAt) < 0 || (compareRfc3339Instants(current.occurredAt, event.occurredAt) === 0 && compareCanonicalText(current.id, event.id) < 0)) {
          sourceEventByObservationId.set(event.observationId, event);
        }
      }
      const nextProjectionVersion = String(this.version + 1n);
      const changedRecordIds = new Set(events.map((event) => event.recordId));
      const projections = reduceEffectiveProjection(events, this.projections).map((projection) =>
        changedRecordIds.has(projection.recordId) ? { ...projection, version: nextProjectionVersion } : projection,
      );
      if (failureStage === "after-projection") throw new ReconciliationFailureInjected("projection");
      for (const event of events) {
        if (!this.records.has(event.recordId)) {
          this.diagnostics.applyLineLookups += 1;
          const line = event.observationId ? lineByObservationId.get(event.observationId) : undefined;
          this.records.set(event.recordId, { id: event.recordId, state: "active", sourcePayload: event.payload, sourceObservationId: event.observationId, matchingAttributes: structuredClone(line?.observation.matchingAttributes ?? {}), ...(event.decimalSources ? { decimalSources: structuredClone(event.decimalSources) } : {}), ...(event.durationSources ? { durationSources: structuredClone(event.durationSources) } : {}), effectiveVersion: event.version });
        }
      }
      // The reduced projection is the source of truth after application. Do
      // this for existing as well as newly-created records so a later
      // reconciliation cannot match against stale payload or provenance kept
      // on the in-memory record object.
      const eventById = new Map(allEvents.map((event) => [event.id, event]));
      for (const projection of projections) {
        const current = this.records.get(projection.recordId);
        if (!current) continue;
        // Rebuild the complete effective context from the reduced projection.
        // Keeping fields from the pre-apply record would let a later
        // reconciliation observe stale layer payloads or stale provenance
        // after an explicit clear.
        const rebuilt = structuredClone(current);
        delete rebuilt.sourcePayload;
        delete rebuilt.sourceObservationId;
        delete rebuilt.adjustmentPayload;
        delete rebuilt.adjustmentEventId;
        delete rebuilt.adjustmentRevision;
        delete rebuilt.auditedDecisionPayload;
        delete rebuilt.decisionEventId;
        delete rebuilt.decisionVersion;
        delete rebuilt.decimalSources;
        delete rebuilt.durationSources;
        delete rebuilt.effectivePayload;
        delete rebuilt.effectiveLayer;
        delete rebuilt.effectiveVersion;
        if (projection.sourceObservationId) this.diagnostics.applySourceEventLookups += 1;
        const sourceEvent = projection.sourceObservationId ? sourceEventByObservationId.get(projection.sourceObservationId) : undefined;
        const adjustmentEvent = projection.adjustmentEventId ? eventById.get(projection.adjustmentEventId) : undefined;
        const decisionEvent = projection.decisionEventId ? eventById.get(projection.decisionEventId) : undefined;
        this.records.set(projection.recordId, {
          ...rebuilt,
          state: projection.state,
          ...(sourceEvent ? { sourcePayload: structuredClone(sourceEvent.payload), sourceObservationId: sourceEvent.observationId } : {}),
          ...(adjustmentEvent ? { adjustmentPayload: structuredClone(adjustmentEvent.payload), adjustmentEventId: adjustmentEvent.id } : {}),
          ...(decisionEvent ? { auditedDecisionPayload: structuredClone(decisionEvent.payload), decisionEventId: decisionEvent.id } : {}),
          ...(projection.decimalSources !== undefined ? { decimalSources: structuredClone(projection.decimalSources) } : {}),
          ...(projection.durationSources !== undefined ? { durationSources: structuredClone(projection.durationSources) } : {}),
          effectivePayload: structuredClone(projection.payload),
          effectiveLayer: projection.decisionEventId ? "decision" : projection.adjustmentEventId ? "adjustment" : "source",
          effectiveVersion: projection.version,
        });
      }
      this.events = nextEvents;
      this.projections = projections;
      this.version += 1n;
      stored.reconciliation.status = "applied";
      if (failureStage === "after-audit") throw new ReconciliationFailureInjected("audit");
      const appliedAt = new Date().toISOString();
      const snapshot: EffectiveSnapshot = { id: randomUUID(), reconciliationId: stored.reconciliation.id, batchId: stored.reconciliation.batchId, projectionVersion: String(this.version), projection: structuredClone(projections), createdAt: appliedAt };
      stored.reconciliation.projectionVersion = snapshot.projectionVersion;
      const result: ReconciliationApplyResult = {
        reconciliation: structuredClone(stored.reconciliation), events: structuredClone(events), projections: structuredClone(snapshot.projection), snapshot: structuredClone(snapshot), projectionVersion: snapshot.projectionVersion, appliedAt, reused: false,
        audit: { actor: input.actor, confirmationId: stored.reconciliation.confirmationId, batchId: stored.reconciliation.batchId, previewId: stored.reconciliation.previewId, sourceFileId: stored.reconciliation.sourceFileId, sourceSha256: stored.reconciliation.sourceSha256, contractHash: stored.reconciliation.contractHash, transformationHash: stored.reconciliation.transformationHash, previewHash: stored.reconciliation.previewHash, policyVersion: stored.reconciliation.policy.version, decisions: structuredClone(stored.reconciliation.decisions), counts: structuredClone(stored.reconciliation.summary), metrics: structuredClone(stored.reconciliation.metrics) },
      };
      this.appliedByKey.set(input.idempotencyKey, structuredClone(result));
      this.applicationsByReconciliation.set(stored.reconciliation.id, structuredClone(result));
      this.snapshots.set(stored.reconciliation.id, structuredClone(snapshot));
      this.failureStage = undefined;
      return result;
    } catch (error) {
      this.events = before.events;
      this.projections = before.projections;
      this.records.clear(); for (const record of before.records) this.records.set(record.id, record);
      this.version = before.version;
      stored.reconciliation = before.reconciliation;
      throw error;
    }
  }
}
