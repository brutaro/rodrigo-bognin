import type { Sql, TransactionSql } from "postgres";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import type { MatchingPolicy } from "../domain/reconciliation";
import { sha256Text } from "../shared/hash-canonical";
import type {
  EffectiveRecordEvent,
  EffectiveRecordProjection,
  Reconciliation,
  ReconciliationDecision,
  StableRecord,
} from "../domain/reconciliation";
import { canonicalTimestamp, reconcileConfirmedPreview } from "../domain/reconciliation";
import { ReconciliationPageCursorCodec, ReconciliationDeadlockFailure, ReconciliationDecisionInvalid, ReconciliationIdempotencyConflict, ReconciliationIntegrityFailure, ReconciliationNotFoundFailure, ReconciliationProjectionConflict, ReconciliationRevisionConflict, type AbsencePage, type ReconciliationApplyResult, type SourceReconciliationRepository, type StableRecordContext, type StableRecordPage, type StoredReconciliation } from "../application/reconciliation-repository";
import { normalizeStableRecordSearchQuery, stableRecordSearchAttributes } from "../application/stable-record-search";

const reservedSourceKeys = new Set(["curso", "trilha"]);

function sanitizeSourceJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSourceJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reservedSourceKeys.has(key.toLowerCase())).map(([key, item]) => [key, sanitizeSourceJson(item)]));
}

function jsonValue(value: unknown) {
  return sanitizeSourceJson(typeof value === "string" ? JSON.parse(value) : value);
}

function jsonObject<T extends object>(value: unknown) {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return parsed as T;
}

function normalizeRepositoryError(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "40P01") return new ReconciliationDeadlockFailure();
    if (code === "40001") {
      const message = String((error as { message?: unknown }).message ?? "");
      const detail = String((error as { detail?: unknown }).detail ?? "");
      if (/current leaf/i.test(message) && detail) return new ReconciliationRevisionConflict(detail);
      return new ReconciliationProjectionConflict();
    }
    if (code === "P0002") return new ReconciliationNotFoundFailure();
    if (code === "XX001") return new ReconciliationIntegrityFailure();
  }
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") {
    const message = String((error as { message?: unknown }).message ?? "");
    if (/idempotency|idempotency_key|reconciliation_request/i.test(message)) return new ReconciliationIdempotencyConflict();
  }
  return error;
}

function decisionHash(decisions: ReconciliationDecision[]) {
  const arrays = [...decisions].sort((left, right) => `${left.observationId}:${left.locator ?? ""}:${left.id}`.localeCompare(`${right.observationId}:${right.locator ?? ""}:${right.id}`)).map((decision) => [
    `${decision.observationId}:${decision.locator ?? ""}`, decision.id, decision.observationId, decision.locator ?? null,
    decision.stableRecordId ?? null, decision.outcome, decision.actor, decision.policyVersion,
    decision.rationale, decision.version, decision.revisionNo ?? null,
  ]);
  // PostgreSQL jsonb text renders arrays with a space after each comma.
  return sha256Text(`[${arrays.map((array) => `[${array.map((value) => JSON.stringify(value)).join(", ")}]`).join(", ")}]`);
}

function canonicalDecision(decision: ReconciliationDecision): ReconciliationDecision {
  return { ...decision, decidedAt: canonicalTimestamp(decision.decidedAt) };
}

function decisionSemantics(decision: ReconciliationDecision) {
  const normalized = canonicalDecision(decision);
  return JSON.stringify([
    normalized.id, normalized.observationId, normalized.locator ?? null, normalized.stableRecordId ?? null,
    normalized.outcome, normalized.actor, normalized.decidedAt, normalized.policyVersion,
    normalized.rationale, normalized.version, normalized.revisionNo ?? null,
  ]);
}

function hydrateAuthenticatedLineDecisions(lines: Reconciliation["lines"], decisions: ReconciliationDecision[]) {
  const physicalById = new Map(decisions.map((decision) => [decision.id, decision]));
  try {
    return lines.map((line) => {
      if (!line.decision) return line;
      const physical = physicalById.get(line.decision.id);
      if (!physical || decisionSemantics(line.decision) !== decisionSemantics(physical)) throw new ReconciliationIntegrityFailure();
      return { ...line, decision: structuredClone(physical) };
    });
  } catch (error) {
    if (error instanceof ReconciliationIntegrityFailure) throw error;
    throw new ReconciliationIntegrityFailure();
  }
}

function snapshotProjection(value: unknown) {
  const rows = jsonValue(value) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    recordId: String(row.record_id ?? row.recordId),
    payload: jsonValue(row.payload) as Record<string, string | null>,
    ...(row.source_observation_id ?? row.sourceObservationId ? { sourceObservationId: String(row.source_observation_id ?? row.sourceObservationId) } : {}),
    ...(row.adjustment_event_id ?? row.adjustmentEventId ? { adjustmentEventId: String(row.adjustment_event_id ?? row.adjustmentEventId) } : {}),
    ...(row.decision_event_id ?? row.decisionEventId ? { decisionEventId: String(row.decision_event_id ?? row.decisionEventId) } : {}),
    ...(row.observed_batch_id ?? row.observedBatchId ? { observedBatchId: String(row.observed_batch_id ?? row.observedBatchId) } : {}),
    ...(row.decimal_sources ?? row.decimalSources ? { decimalSources: jsonValue(row.decimal_sources ?? row.decimalSources) as EffectiveRecordProjection["decimalSources"] } : {}),
    ...(row.duration_sources ?? row.durationSources ? { durationSources: jsonValue(row.duration_sources ?? row.durationSources) as EffectiveRecordProjection["durationSources"] } : {}),
    state: String(row.state) as "active" | "disregarded",
    version: String(row.version),
  }));
}

type ReconciliationRow = { reconciliation: unknown; fingerprint: string; idempotency_key: string };

export class PostgresSourceReconciliationRepository implements SourceReconciliationRepository {
  private readonly cursorCodec: ReconciliationPageCursorCodec;

  constructor(private readonly sql: Sql, cursorMasterKey?: Uint8Array) { this.cursorCodec = new ReconciliationPageCursorCodec(cursorMasterKey); }


  private async one(id: string, executor: Sql | TransactionSql = this.sql) {
    try {
      const [row] = await executor<Array<ReconciliationRow & { decisions: unknown }>>`SELECT manifest reconciliation,decisions,fingerprint,idempotency_key FROM read_source_reconciliation(${id})`;
      if (!row) return undefined;
      const base = jsonValue(row.reconciliation) as Reconciliation;
      const [history] = await executor<Array<{ projection_version: string | null }>>`
        SELECT application.projection_version::text
        FROM (SELECT 1) singleton
        LEFT JOIN src_reconciliation_application application ON application.reconciliation_id = ${id}`;
      const applied = history?.projection_version !== null && history?.projection_version !== undefined;
      const decisions = (jsonValue(row.decisions) as ReconciliationDecision[]).map(canonicalDecision);
      const canonicalBase = { ...base, createdAt: canonicalTimestamp(base.createdAt), lines: base.lines.map((line) => ({ ...line, observation: { ...line.observation, observedAt: canonicalTimestamp(line.observation.observedAt) } })) };
      // The SQL writer authenticates and persists the current line/summary/metric
      // deltas. An ordinary read must not enumerate the complete stable-record
      // catalog merely to recreate absences that the public DTO removes.
      const hydrated = { ...structuredClone(canonicalBase), lines: hydrateAuthenticatedLineDecisions(canonicalBase.lines, decisions), decisions: structuredClone(decisions),
        ...(applied ? { status: "applied" as const, projectionVersion: history?.projection_version ?? undefined } : {}) };
      // The public reconciliation DTO carries line decisions and summary only;
      // stable-record context is fetched through the paginated search contract.
      const publicReconciliation = structuredClone(hydrated);
      Reflect.deleteProperty(publicReconciliation, "availableStableRecordIds");
      delete publicReconciliation.availableStableRecords;
      return { reconciliation: publicReconciliation, fingerprint: row.fingerprint, idempotencyKey: row.idempotency_key } satisfies StoredReconciliation;
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  /** Read the current leaf while retaining historical `one()` semantics. */
  private async oneLeaf(id: string, executor: Sql | TransactionSql = this.sql) {
    const [row] = await executor<Array<{ id: string }>>`
      WITH RECURSIVE descendants(id, base_projection_version, revision_no, created_at) AS (
        SELECT id, base_projection_version, revision_no, created_at FROM src_reconciliation WHERE id = ${id}
        UNION ALL
        SELECT child.id, child.base_projection_version, child.revision_no, child.created_at
        FROM src_reconciliation child JOIN descendants parent ON child.parent_reconciliation_id = parent.id
      )
      SELECT d.id::text FROM descendants d
      WHERE NOT EXISTS (SELECT 1 FROM src_reconciliation child WHERE child.parent_reconciliation_id = d.id)
      ORDER BY d.base_projection_version DESC, d.revision_no DESC, d.created_at DESC, d.id DESC LIMIT 1`;
    return row ? this.one(row.id, executor) : undefined;
  }

  async findReconciliationByFingerprint(fingerprint: string) {
    const [row] = await this.sql<ReconciliationRow[]>`SELECT manifest reconciliation, fingerprint, idempotency_key FROM src_reconciliation WHERE fingerprint = ${fingerprint}`;
    // Fingerprints identify an immutable graph revision, but callers need the
    // current leaf when that revision has since received decisions. Returning
    // the root here would rehydrate stale partial work and silently discard a
    // newer decision chain during replay.
    if (!row) return undefined;
    const leaf = await this.oneLeaf((jsonValue(row.reconciliation) as Reconciliation).id);
    return leaf ? { ...leaf, idempotencyKey: row.idempotency_key } : undefined;
  }

  async findReconciliationByIdempotencyKey(idempotencyKey: string) {
    const [row]=await this.sql<Array<{root_id:string;leaf_id:string;request_hash:string;root_hash:string}>>`SELECT q.root_reconciliation_id::text root_id,h.leaf_reconciliation_id::text leaf_id,q.root_request_hash::text request_hash,r.root_request_hash::text root_hash
      FROM src_reconciliation_request q JOIN src_reconciliation r ON r.id=q.root_reconciliation_id JOIN src_reconciliation_head h ON h.lineage_id=r.id
      WHERE q.operation='reconcile' AND q.idempotency_key=${idempotencyKey}`;
    if(!row)return undefined;
    if(row.request_hash!==row.root_hash)throw new ReconciliationIntegrityFailure();
    const leaf=await this.one(row.leaf_id);
    return leaf?{...leaf,idempotencyKey}:undefined;
  }

  async findReconciliation(reconciliationId: string) { return this.one(reconciliationId); }

  async findAppliedReconciliationByConfirmation(confirmationId: string) {
    const [row] = await this.sql<Array<{ id: string }>>`
      SELECT a.reconciliation_id::text AS id
      FROM src_reconciliation_application a
      JOIN src_reconciliation r ON r.id = a.reconciliation_id
      WHERE r.confirmation_id = ${confirmationId}
      ORDER BY a.applied_at DESC, a.reconciliation_id DESC
      LIMIT 1`;
    return row ? this.oneLeaf(row.id) : undefined;
  }

  async findReconciliationLeaf(reconciliationId: string) {
    const [row] = await this.sql<Array<{ id: string }>>`
      WITH RECURSIVE descendants(id, base_projection_version, revision_no, created_at) AS (
        SELECT id, base_projection_version, revision_no, created_at FROM src_reconciliation WHERE id = ${reconciliationId}
        UNION ALL
        SELECT child.id, child.base_projection_version, child.revision_no, child.created_at
        FROM src_reconciliation child JOIN descendants parent ON child.parent_reconciliation_id = parent.id
      )
      SELECT d.id::text
      FROM descendants d
      WHERE NOT EXISTS (SELECT 1 FROM src_reconciliation child WHERE child.parent_reconciliation_id = d.id)
      ORDER BY d.base_projection_version DESC, d.revision_no DESC, d.created_at DESC, d.id DESC
      LIMIT 1`;
    return row ? this.one(row.id) : undefined;
  }

  async currentLeafId(reconciliationId: string) {
    const [row] = await this.sql<Array<{ id: string }>>`
      SELECT head.leaf_reconciliation_id::text AS id
      FROM src_reconciliation reconciliation
      JOIN src_reconciliation_head head ON head.lineage_id=coalesce(reconciliation.lineage_id,reconciliation.id)
      WHERE reconciliation.id=${reconciliationId}`;
    return row?.id;
  }
  async currentReadToken(reconciliationId: string) {
    const [row] = await this.sql<Array<{ leaf_id: string; projection_version: string }>>`
      SELECT head.leaf_reconciliation_id::text AS leaf_id,version.version::text AS projection_version
      FROM src_reconciliation reconciliation
      JOIN src_reconciliation_head head ON head.lineage_id=coalesce(reconciliation.lineage_id,reconciliation.id)
      CROSS JOIN src_projection_version version
      WHERE reconciliation.id=${reconciliationId} AND version.singleton`;
    return row ? { leafId: row.leaf_id, projectionVersion: row.projection_version } : undefined;
  }

  async findReconciliationByPreview(previewId: string) {
    const [row] = await this.sql<Array<{ id: string }>>`
      WITH RECURSIVE candidates AS (
        SELECT id, base_projection_version, revision_no, created_at
        FROM src_reconciliation WHERE preview_id = ${previewId}
      ), leaves AS (
        SELECT c.* FROM candidates c
        WHERE NOT EXISTS (SELECT 1 FROM src_reconciliation child WHERE child.parent_reconciliation_id = c.id)
      )
      SELECT id::text FROM leaves ORDER BY base_projection_version DESC, revision_no DESC, created_at DESC, id DESC LIMIT 1`;
    return row ? this.one(row.id) : undefined;
  }

  private async saveReconciliationWith(value: StoredReconciliation, tx: TransactionSql) {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-reconciliation:confirmation:" + value.reconciliation.confirmationId}, 7824001))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-reconciliation:key:" + value.idempotencyKey}, 7824001))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-reconciliation:fingerprint:" + value.fingerprint}, 7824001))`;
      const [requestByKey] = await tx<Array<{
        reconciliation: unknown;
        root_id: string;
        request_root_hash: string;
        stored_root_hash: string;
      }>>`SELECT root.manifest reconciliation,root.id::text root_id,
          q.root_request_hash::text request_root_hash,root.root_request_hash::text stored_root_hash
        FROM src_reconciliation_request q
        JOIN src_reconciliation root ON root.id=q.root_reconciliation_id
        WHERE q.operation='reconcile' AND q.idempotency_key=${value.idempotencyKey}`;
      if (requestByKey) {
        const root = jsonValue(requestByKey.reconciliation) as Reconciliation;
        if (requestByKey.request_root_hash!==requestByKey.stored_root_hash
          || root.rootRequestHash!==requestByKey.stored_root_hash
          || root.id!==requestByKey.root_id) throw new ReconciliationIntegrityFailure();
        if (value.reconciliation.rootRequestHash!==requestByKey.stored_root_hash)
          throw new ReconciliationIdempotencyConflict();
        const existing = await this.oneLeaf(requestByKey.root_id, tx);
        if (!existing) throw new ReconciliationIntegrityFailure();
        return { ...existing, idempotencyKey: value.idempotencyKey };
      }
      const [byKey] = await tx<Array<{ id: string }>>`
        SELECT id::text FROM src_reconciliation WHERE idempotency_key=${value.idempotencyKey}`;
      if (byKey) throw new ReconciliationIdempotencyConflict();
      const [appliedByConfirmation] = await tx<Array<ReconciliationRow & { decisions_hash: string }>>`SELECT r.manifest reconciliation, r.fingerprint, r.idempotency_key, r.decisions_hash
        FROM src_reconciliation_application a
        JOIN src_reconciliation r ON r.id = a.reconciliation_id
        WHERE r.confirmation_id = ${value.reconciliation.confirmationId}
        ORDER BY a.applied_at DESC, r.id DESC LIMIT 1`;
      if (appliedByConfirmation) {
        const existing = await this.oneLeaf((jsonValue(appliedByConfirmation.reconciliation) as Reconciliation).id, tx);
        if (!existing) throw new Error("A reconciliação aplicada não pôde ser recuperada.");
        // A confirmed preview is immutable. A retry with a transport key that
        // names the same confirmation and complete decision chain aliases the
        // already frozen result instead of opening a second application.
        const [alias] = await tx<Array<{ reconciliation_id: string }>>`SELECT alias_source_reconciliation_request(${value.idempotencyKey}, ${value.reconciliation.rootRequestHash}, ${decisionHash(value.reconciliation.decisions)}, ${existing.reconciliation.id}, ${true})::text AS reconciliation_id`;
        const effective = alias ? await this.oneLeaf(alias.reconciliation_id, tx) : existing;
        if (!effective) throw new Error("A leaf aplicada não pôde ser recuperada.");
        return { ...effective, idempotencyKey: value.idempotencyKey };
      }
      const [otherAppliedConfirmation] = await tx<Array<{ id: string }>>`SELECT r.id::text
        FROM src_reconciliation_application a JOIN src_reconciliation r ON r.id = a.reconciliation_id
        WHERE r.confirmation_id = ${value.reconciliation.confirmationId}
        LIMIT 1`;
      if (otherAppliedConfirmation) throw new ReconciliationIdempotencyConflict();
      const [byFingerprint] = await tx<ReconciliationRow[]>`SELECT manifest reconciliation, fingerprint, idempotency_key FROM src_reconciliation WHERE fingerprint = ${value.fingerprint}`;
      if (byFingerprint) {
        const existing = await this.oneLeaf((jsonValue(byFingerprint.reconciliation) as Reconciliation).id, tx);
        if (!existing) throw new Error("A reconciliação não pôde ser recuperada.");
        const [alias] = await tx<Array<{ reconciliation_id: string }>>`SELECT alias_source_reconciliation_request(${value.idempotencyKey}, ${value.reconciliation.rootRequestHash}, ${decisionHash(value.reconciliation.decisions)}, ${existing.reconciliation.id}, ${false})::text AS reconciliation_id`;
        const effective = alias ? await this.oneLeaf(alias.reconciliation_id, tx) : existing;
        if (!effective) throw new Error("A leaf reconciliada não pôde ser recuperada.");
        return { ...effective, idempotencyKey: value.idempotencyKey };
      }
      const [written] = await tx<Array<{ reconciliation_id: string }>>`SELECT write_source_reconciliation('reconcile', ${tx.json({ reconciliation: value.reconciliation, fingerprint: value.fingerprint, idempotencyKey: value.idempotencyKey, requestId: value.requestId ?? null, decisionsHash: decisionHash(value.reconciliation.decisions) })})::text AS reconciliation_id`;
      const stored = written ? await this.oneLeaf(written.reconciliation_id, tx) : undefined;
      if (!stored) throw new Error("A reconciliação não pôde ser recuperada após a escrita.");
      return stored;
  }

  async saveReconciliation(value: StoredReconciliation) {
    try { return await this.sql.begin(async (tx) => this.saveReconciliationWith(value, tx)); }
    catch (error) { throw normalizeRepositoryError(error); }
  }

  async recoverConfirmedPreviewAtomically(input: { actor: "Rodrigo"; requestId: string; confirmation: PreviewConfirmation; preview: Preview; policy: MatchingPolicy }) {
    try {
      return await this.sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-reconciliation:confirmation:"+input.confirmation.confirmationId},7824001))`;
        const [applied] = await tx<Array<{ reconciliation_id: string }>>`SELECT reconciliation_id::text FROM src_reconciliation_confirmation_application WHERE confirmation_id=${input.confirmation.confirmationId}`;
        if (applied) {
          const stored = await this.oneLeaf(applied.reconciliation_id, tx);
          if (!stored) throw new Error("A leaf aplicada não pôde ser recuperada.");
          return { reconciliation: stored.reconciliation, reused: true };
        }
        const [projection] = await tx<Array<{ version: string }>>`SELECT version::text FROM src_projection_version WHERE singleton`;
        const version = projection?.version ?? "0";
        const [allocated] = await tx<Array<{ attempt: string }>>`SELECT next_source_reconciliation_recovery_attempt(${input.confirmation.confirmationId},${version}::bigint) AS attempt`;
        if (!allocated) throw new Error("A tentativa de recuperação não pôde ser alocada.");
        const records = await this.stableRecords(tx);
        const reconciliation = reconcileConfirmedPreview({ confirmation: input.confirmation, preview: input.preview, records, policy: input.policy, baseProjectionVersion: version });
        const idempotencyKey = `reconcile-recovery-${input.confirmation.confirmationId}-${version}-${allocated.attempt}`;
        const saved = await this.saveReconciliationWith({ reconciliation, fingerprint: reconciliation.fingerprint, idempotencyKey, requestId: input.requestId }, tx);
        return { reconciliation: saved.reconciliation, reused: saved.reconciliation.id !== reconciliation.id };
      });
    } catch (error) { throw normalizeRepositoryError(error); }
  }

  async recordDecisionAtomically(input: { reconciliationId: string; requestId: string; decision: Omit<ReconciliationDecision, "id" | "actor" | "decidedAt" | "policyVersion"> & { policyVersion?: string } }) {
    try {
      const intent = {
        observationId: input.decision.observationId,
        locator: input.decision.locator,
        ...(input.decision.stableRecordId ? { stableRecordId: input.decision.stableRecordId } : {}),
        outcome: input.decision.outcome,
        ...(input.decision.policyVersion ? { policyVersion: input.decision.policyVersion } : {}),
        rationale: input.decision.rationale,
        version: input.decision.version,
      };
      const [row] = await this.sql<Array<{ receipt: unknown }>>`
        SELECT write_source_reconciliation_decision(${input.reconciliationId}::uuid, ${this.sql.json(intent)}, ${input.requestId}::uuid) AS receipt`;
      if (!row) throw new Error("A decisão não pôde ser persistida.");
      const receipt = jsonValue(row.receipt) as {
        id: string; reconciliationId: string; parentReconciliationId?: string; revisionNo: string; fingerprint: string;
        status: Reconciliation["status"]; summary: Reconciliation["summary"]; metrics?: Reconciliation["metrics"];
        decision: ReconciliationDecision; changedLines: Reconciliation["lines"]; absenceChanges: Array<{ stableRecordId: string; absent: boolean; item?: Reconciliation["absences"][number] }>;
        decisionCount: number; reused: boolean; canonicalReopenRequired?: boolean; createdAt?: string;
      };
      const receiptDecision = canonicalDecision(receipt.decision);
      return {
        ...receipt,
        ...(receipt.createdAt?{createdAt:canonicalTimestamp(receipt.createdAt)}:{}),
        decision: receiptDecision,
        changedLines: receipt.changedLines.map((line) => {
          const canonicalLine={...line,observation:{...line.observation,...(line.observation.observedAt?{observedAt:canonicalTimestamp(line.observation.observedAt)}:{})}};
          if (!line.decision) return canonicalLine;
          const lineDecision = canonicalDecision(line.decision);
          if (lineDecision.id === receiptDecision.id) {
            if (decisionSemantics(lineDecision) !== decisionSemantics(receiptDecision)) throw new ReconciliationIntegrityFailure();
            return { ...canonicalLine, decision: structuredClone(receiptDecision) };
          }
          return { ...canonicalLine, decision: lineDecision };
        }),
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code?: unknown }).code);
        if (code === "22023") throw new ReconciliationDecisionInvalid();
        if (code === "P0002") throw new ReconciliationNotFoundFailure();
        if (code === "XX001") throw new ReconciliationIntegrityFailure();
      }
      throw normalizeRepositoryError(error);
    }
  }

  async listDecisions(reconciliationId: string) {
    const [row]=await this.sql<Array<{decisions:unknown}>>`SELECT decisions FROM read_source_reconciliation(${reconciliationId})`;
    return row ? (jsonValue(row.decisions) as ReconciliationDecision[]).map(canonicalDecision) : [];
  }

  private async stableRecords(executor: Sql | TransactionSql = this.sql, recordIds?: string[]) {
    type EventRow = {
      id: string;
      record_id: string;
      observation_id: string | null;
      event_type: EffectiveRecordEvent["type"];
      layer: EffectiveRecordEvent["layer"];
      state: "active" | "disregarded";
      payload: unknown;
      decimal_sources: unknown;
      duration_sources: unknown;
      version: string;
      occurred_at: string;
      decision_id: string | null;
      decision_rationale: string | null;
      decision_version: string | null;
      decision_decided_at: string | null;
    };
    const rows = await executor<Array<{
      id: string;
      state: StableRecord["state"];
      projection_state: StableRecord["state"] | null;
      matching_attributes: unknown;
      projection_payload: unknown;
      projection_decimal_sources: unknown;
      projection_duration_sources: unknown;
      source_observation_id: string | null;
      adjustment_event_id: string | null;
      decision_event_id: string | null;
      projection_version: string | null;
    }>>`SELECT r.id::text, r.state, r.matching_attributes, p.payload AS projection_payload,
      p.decimal_sources AS projection_decimal_sources, p.duration_sources AS projection_duration_sources,
      p.source_observation_id::text AS source_observation_id,
      p.adjustment_event_id::text AS adjustment_event_id,
      p.decision_event_id::text AS decision_event_id,
      p.version::text AS projection_version, p.state AS projection_state
      FROM src_stable_record r
      LEFT JOIN src_effective_record_projection p ON p.record_id = r.id
      WHERE ${recordIds === undefined} OR r.id = ANY(${recordIds ?? []}::uuid[])
      ORDER BY r.id`;
    // A projection is the authoritative index of the events that form its
    // current context. Loading the append-only event table would make a
    // historical event eligible for hydration (especially when an observation
    // was reconciled more than once), and would also make this read scale with
    // the complete ledger instead of the active projection.
    const eventRows = await executor<EventRow[]>`WITH current_source_event AS (
        SELECT DISTINCT ON (p.record_id, p.source_observation_id) e.id
        FROM src_effective_record_projection p
        JOIN src_effective_record_event e
          ON e.record_id = p.record_id
         AND e.observation_id = p.source_observation_id
         AND e.layer = 'source'
         AND e.event_type IN ('record.inserted', 'observation.accepted')
        WHERE p.source_observation_id IS NOT NULL
        ORDER BY p.record_id, p.source_observation_id, e.occurred_at DESC, e.id DESC
      ), referenced_event_ids AS (
        SELECT p.adjustment_event_id AS id
        FROM src_effective_record_projection p
        WHERE p.adjustment_event_id IS NOT NULL
        UNION
        SELECT p.decision_event_id AS id
        FROM src_effective_record_projection p
        WHERE p.decision_event_id IS NOT NULL
        UNION
        SELECT id FROM current_source_event
      )
      SELECT e.id::text, e.record_id::text, e.observation_id::text, e.event_type, e.layer, e.state, e.payload, e.decimal_sources, e.duration_sources, e.version, e.occurred_at::text, e.decision_id::text, e.decision_rationale, e.decision_version, e.decision_decided_at::text
      FROM src_effective_record_event e
      JOIN referenced_event_ids referenced ON referenced.id = e.id
      WHERE ${recordIds === undefined} OR e.record_id = ANY(${recordIds ?? []}::uuid[])
      ORDER BY e.record_id, e.occurred_at, e.id`;
    const eventsByRecord = new Map<string, EventRow[]>();
    const eventsById = new Map<string, EventRow>();
    for (const event of eventRows) {
      eventsByRecord.set(event.record_id, [...(eventsByRecord.get(event.record_id) ?? []), event]);
      eventsById.set(event.id, event);
    }
    const payload = (value: unknown) => jsonValue(value) as Record<string, string | null>;
    return rows.map((row) => {
      const events = eventsByRecord.get(row.id) ?? [];
      const sourceEvent = row.source_observation_id
        ? events.find((event) => event.record_id === row.id && event.observation_id === row.source_observation_id
          && event.layer === "source" && ["record.inserted", "observation.accepted"].includes(event.event_type))
        : undefined;
      const adjustmentEvent = row.adjustment_event_id ? eventsById.get(row.adjustment_event_id) : undefined;
      const decisionEvent = row.decision_event_id ? eventsById.get(row.decision_event_id) : undefined;
      if (row.source_observation_id && !sourceEvent) throw new ReconciliationIntegrityFailure();
      if (row.adjustment_event_id && (!adjustmentEvent || adjustmentEvent.record_id !== row.id
        || adjustmentEvent.layer !== "adjustment" || adjustmentEvent.event_type !== "adjustment.revised")) throw new ReconciliationIntegrityFailure();
      if (row.decision_event_id && (!decisionEvent || decisionEvent.record_id !== row.id
        || decisionEvent.layer !== "decision" || decisionEvent.event_type !== "decision.audit")) throw new ReconciliationIntegrityFailure();

      // Resolve one complete tuple. Event existence selects payload and both
      // provenance maps together; SQL NULL metadata is authoritative missing.
      const effectiveEvent = decisionEvent ?? adjustmentEvent ?? sourceEvent;
      const projectionPayload = row.projection_payload === null ? undefined : payload(row.projection_payload);
      const effectivePayload = effectiveEvent ? payload(effectiveEvent.payload) : projectionPayload;
      const sourcePayload = sourceEvent ? payload(sourceEvent.payload) : undefined;
      const adjustmentPayload = adjustmentEvent ? payload(adjustmentEvent.payload) : undefined;
      const auditedDecisionPayload = decisionEvent ? payload(decisionEvent.payload) : undefined;
      const decimalSources = effectiveEvent
        ? jsonObject<NonNullable<StableRecord["decimalSources"]>>(effectiveEvent.decimal_sources)
        : jsonObject<NonNullable<StableRecord["decimalSources"]>>(row.projection_decimal_sources);
      const durationSources = effectiveEvent
        ? jsonObject<NonNullable<StableRecord["durationSources"]>>(effectiveEvent.duration_sources)
        : jsonObject<NonNullable<StableRecord["durationSources"]>>(row.projection_duration_sources);
      return {
        id: row.id,
        state: row.projection_state ?? row.state,
        matchingAttributes: stableRecordSearchAttributes(jsonValue(row.matching_attributes) as Record<string, string>),
        ...(sourcePayload ? { sourcePayload } : {}),
        ...(adjustmentPayload ? { adjustmentPayload } : {}),
        ...(auditedDecisionPayload ? { auditedDecisionPayload } : {}),
        ...(decimalSources ? { decimalSources } : {}),
        ...(durationSources ? { durationSources } : {}),
        ...(row.projection_payload !== null ? { effectiveVersion: String(row.projection_version ?? "0") } : {}),
        ...(row.projection_payload !== null && effectivePayload ? { effectiveLayer: effectiveEvent?.layer ?? "source", effectivePayload } : {}),
        ...(row.source_observation_id ? { sourceObservationId: row.source_observation_id } : {}),
        ...(row.adjustment_event_id ? { adjustmentEventId: row.adjustment_event_id, ...(adjustmentEvent?.version ? { adjustmentRevision: adjustmentEvent.version } : {}) } : {}),
        ...(row.decision_event_id ? { decisionEventId: row.decision_event_id, ...(decisionEvent?.version ? { decisionVersion: decisionEvent.version } : {}) } : {}),
      } satisfies StableRecord;
    });
  }

  async listStableRecords() { return this.stableRecords(this.sql); }

  async searchStableRecords(input: { reconciliationId: string; query?: string; cursor?: string; page?: number; pageSize?: number }): Promise<StableRecordPage> {
    const query = normalizeStableRecordSearchQuery(input.query);
    const token = await this.currentReadToken(input.reconciliationId);
    if (!token || token.leafId !== input.reconciliationId) throw new ReconciliationRevisionConflict(token?.leafId ?? input.reconciliationId);
    const epoch = token.projectionVersion;
    const { page, pageSize, afterId, binding } = this.cursorCodec.strictRequest(input, "stable", input.reconciliationId, query, `stable-search:v1:projection:${epoch}`);
    type StablePageRow = {
      stable_record_id: string | null;
      matching_attributes: unknown;
      effective_payload: unknown;
      decimal_sources: unknown;
      duration_sources: unknown;
      effective_layer: StableRecordContext["effectiveLayer"] | null;
      projection_version: string | null;
      total: string;
    };
    let candidates: StablePageRow[];
    try {
      candidates = await this.sql<StablePageRow[]>`
        SELECT stable_record_id::text, matching_attributes, effective_payload,
          decimal_sources, duration_sources, effective_layer,
          projection_version::text, total
        FROM source_reconciliation_stable_record_page(
          ${query}, ${afterId ?? null}::uuid, ${pageSize + 1}
        )`;
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
    const total = candidates[0]?.total ?? "0";
    const rows = candidates.flatMap((row) => row.stable_record_id ? [row] : []);
    const visibleRows = rows.slice(0, pageSize);
    const contexts: StableRecordContext[] = visibleRows.map((row) => {
      const decimalSources = jsonObject<NonNullable<StableRecordContext["decimalSources"]>>(row.decimal_sources);
      const durationSources = jsonObject<NonNullable<StableRecordContext["durationSources"]>>(row.duration_sources);
      return {
        id: row.stable_record_id!,
        matchingAttributes: stableRecordSearchAttributes(jsonValue(row.matching_attributes) as Record<string, string>),
        effectiveLayer: row.effective_layer ?? "source",
        effectivePayload: jsonObject<StableRecordContext["effectivePayload"]>(row.effective_payload) ?? {},
        ...(decimalSources !== undefined ? { decimalSources } : {}),
        ...(durationSources !== undefined ? { durationSources } : {}),
        ...(row.projection_version !== null ? { effectiveVersion: String(row.projection_version) } : {}),
      };
    });
    const tokenAfter = await this.currentReadToken(input.reconciliationId);
    if (!tokenAfter || tokenAfter.leafId !== token.leafId) throw new ReconciliationRevisionConflict(tokenAfter?.leafId ?? input.reconciliationId);
    if (tokenAfter.projectionVersion !== token.projectionVersion) throw new ReconciliationProjectionConflict();
    const nextCursor = rows.length > pageSize && visibleRows.length
      ? this.cursorCodec.issue({ ...binding, page: page + 1 }, visibleRows.at(-1)!.stable_record_id!) : undefined;
    return { page, pageSize, total, records: contexts, ...(nextCursor ? { nextCursor } : {}) };
  }

  async listAbsences(reconciliationId: string,input:{cursor?:string;page?:number;pageSize?:number}):Promise<AbsencePage>{
    const {page,pageSize,afterId,binding}=this.cursorCodec.strictRequest(input,"absence",reconciliationId,"",`leaf:${reconciliationId}`);
    try {
      const [result]=await this.sql<Array<{items:unknown;total_count:string;has_more:boolean}>>`SELECT items,total_count,has_more FROM source_reconciliation_absence_page(${reconciliationId},${afterId??null}::uuid,${pageSize})`;
      if(!result)throw new ReconciliationIntegrityFailure();
      const absences=jsonValue(result.items) as Reconciliation["absences"];
      const nextCursor=result.has_more&&absences.length?this.cursorCodec.issue({...binding,page:page+1},absences.at(-1)!.stableRecordId):undefined;
      return {page,pageSize,total:result.total_count,absences,...(nextCursor?{nextCursor}:{})};
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  async nextRecoveryAttempt(confirmationId: string, projectionVersion: string) {
    try {
      const [row] = await this.sql<Array<{ attempt: string }>>`
        SELECT next_source_reconciliation_recovery_attempt(${confirmationId}, ${projectionVersion}::bigint) AS attempt`;
      if (!row) throw new Error("A tentativa de recuperação não pôde ser alocada.");
      return row.attempt;
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  async currentProjectionVersion() {
    const [row] = await this.sql<Array<{ version: string }>>`SELECT version::text FROM src_projection_version WHERE singleton`;
    return row?.version ?? "0";
  }

  async listProjection() {
    const rows = await this.sql<Array<{ record_id: string; payload: unknown; decimal_sources: unknown; duration_sources: unknown; source_observation_id: string | null; adjustment_event_id: string | null; decision_event_id: string | null; observed_batch_id: string | null; state: "active" | "disregarded"; version: string }>>`SELECT record_id::text, payload, decimal_sources, duration_sources, source_observation_id::text, adjustment_event_id::text, decision_event_id::text, observed_batch_id::text, state, version::text FROM src_effective_record_projection ORDER BY record_id`;
    return rows.map((row) => ({ recordId: row.record_id, payload: jsonValue(row.payload) as Record<string, string | null>, ...(row.decimal_sources ? { decimalSources: jsonValue(row.decimal_sources) as EffectiveRecordProjection["decimalSources"] } : {}), ...(row.duration_sources ? { durationSources: jsonValue(row.duration_sources) as EffectiveRecordProjection["durationSources"] } : {}), ...(row.source_observation_id ? { sourceObservationId: row.source_observation_id } : {}), ...(row.adjustment_event_id ? { adjustmentEventId: row.adjustment_event_id } : {}), ...(row.decision_event_id ? { decisionEventId: row.decision_event_id } : {}), ...(row.observed_batch_id ? { observedBatchId: row.observed_batch_id } : {}), state: row.state, version: row.version }));
  }

  private async snapshot(row: { id: string; reconciliation_id: string; batch_id: string; projection_version: string; projection: unknown; created_at: string } | undefined) {
    if (!row) return undefined;
    return { id: row.id, reconciliationId: row.reconciliation_id, batchId: row.batch_id, projectionVersion: row.projection_version, projection: snapshotProjection(row.projection), createdAt: canonicalTimestamp(row.created_at) };
  }

  async findSnapshotByReconciliation(reconciliationId: string) {
    const [row] = await this.sql<Array<{ id: string; reconciliation_id: string; batch_id: string; projection_version: string; projection: unknown; created_at: string }>>`
      SELECT id::text, reconciliation_id::text, batch_id::text, projection_version::text, projection, created_at::text
      FROM src_effective_snapshot WHERE reconciliation_id = ${reconciliationId}`;
    return this.snapshot(row);
  }

  async findSnapshotByBatch(batchId: string) {
    const [row] = await this.sql<Array<{ id: string; reconciliation_id: string; batch_id: string; projection_version: string; projection: unknown; created_at: string }>>`
      SELECT id::text, reconciliation_id::text, batch_id::text, projection_version::text, projection, created_at::text
      FROM src_effective_snapshot WHERE batch_id = ${batchId} ORDER BY projection_version DESC, created_at DESC, id DESC LIMIT 1`;
    return this.snapshot(row);
  }

  async applyReconciliation(input: { reconciliationId: string; idempotencyKey: string; requestId: string; actor: "Rodrigo" }) {
    let row: { reused: boolean; event_count: number; projection_version: string } | undefined;
    try {
      [row] = await this.sql<Array<{ reused: boolean; event_count: number; projection_version: string }>>`SELECT * FROM apply_source_reconciliation(${input.reconciliationId}, ${input.idempotencyKey}, ${input.requestId}, ${input.actor})`;
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
    if (!row) throw new Error("A aplicação não retornou resultado.");
    const stored = await this.one(input.reconciliationId);
    if (!stored) throw new Error("A reconciliação aplicada não pôde ser recuperada.");
    const events = await this.sql<Array<{ id: string; reconciliation_id: string; record_id: string; observation_id: string | null; event_type: EffectiveRecordEvent["type"]; layer: EffectiveRecordEvent["layer"]; state: "active" | "disregarded"; payload: unknown; decimal_sources: unknown; duration_sources: unknown; actor: "Rodrigo"; occurred_at: string; version: string; batch_id: string; decision_id: string | null; decision_rationale: string | null; decision_version: string | null; decision_decided_at: string | null }>>`SELECT e.id::text, e.reconciliation_id::text, e.record_id::text, e.observation_id::text, e.event_type, e.layer, e.state, e.payload, e.decimal_sources, e.duration_sources, e.actor, e.occurred_at::text, e.version, r.batch_id::text, e.decision_id::text, e.decision_rationale, e.decision_version, e.decision_decided_at::text FROM src_effective_record_event e JOIN src_reconciliation r ON r.id=e.reconciliation_id WHERE e.reconciliation_id = ${input.reconciliationId} ORDER BY e.occurred_at, e.id`;
    const snapshot = await this.findSnapshotByReconciliation(input.reconciliationId);
    if (!snapshot || snapshot.projectionVersion !== String(row.projection_version)) throw new Error("A aplicação não retornou o snapshot da mesma versão.");
    const projection = snapshot.projection;
    const [application] = await this.sql<Array<{ applied_at: string; audit_payload: unknown }>>`SELECT applied_at::text, audit_payload FROM src_reconciliation_application WHERE reconciliation_id = ${input.reconciliationId}`;
    if (!application) throw new ReconciliationIntegrityFailure();
    const persistedAudit = jsonValue(application.audit_payload) as Record<string, unknown>;
    const appliedAt = canonicalTimestamp(application.applied_at);
    return {
      reconciliation: stored.reconciliation,
      events: events.map((event) => ({ id: event.id, reconciliationId: event.reconciliation_id, batchId: event.batch_id, recordId: event.record_id, ...(event.observation_id ? { observationId: event.observation_id } : {}), type: event.event_type, layer: event.layer, state: event.state, payload: jsonValue(event.payload) as Record<string, string | null>, ...(event.decimal_sources ? { decimalSources: jsonValue(event.decimal_sources) as EffectiveRecordEvent["decimalSources"] } : {}), ...(event.duration_sources ? { durationSources: jsonValue(event.duration_sources) as EffectiveRecordEvent["durationSources"] } : {}), actor: event.actor, occurredAt: canonicalTimestamp(event.occurred_at), version: event.version, ...(event.decision_id ? { decisionId: event.decision_id, decisionRationale: event.decision_rationale ?? undefined, decisionVersion: event.decision_version ?? undefined, decisionDecidedAt: event.decision_decided_at ? canonicalTimestamp(event.decision_decided_at) : undefined } : {}) })),
      projections: projection, snapshot, projectionVersion: String(row.projection_version), appliedAt, reused: Boolean(row.reused),
      audit: { actor: input.actor, confirmationId: stored.reconciliation.confirmationId, batchId: stored.reconciliation.batchId, previewId: stored.reconciliation.previewId, sourceFileId: stored.reconciliation.sourceFileId, sourceSha256: stored.reconciliation.sourceSha256, contractHash: stored.reconciliation.contractHash, transformationHash: stored.reconciliation.transformationHash, previewHash: stored.reconciliation.previewHash, policyVersion: stored.reconciliation.policy.version, decisions: ((jsonValue(persistedAudit.decisions) as ReconciliationDecision[] | undefined) ?? stored.reconciliation.decisions).map(canonicalDecision), counts: (jsonValue(persistedAudit.counts) as Reconciliation["summary"] | undefined) ?? stored.reconciliation.summary, metrics: (jsonValue(persistedAudit.metrics) as Reconciliation["metrics"] | undefined) ?? stored.reconciliation.metrics },
    } satisfies ReconciliationApplyResult;
  }
}
