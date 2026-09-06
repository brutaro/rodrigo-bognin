import { createHmac, timingSafeEqual } from "node:crypto";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import type {
  EffectiveRecordEvent,
  EffectiveRecordProjection,
  EffectiveSnapshot,
  Reconciliation,
  ReconciliationDecision,
  ReconciliationMetrics,
  MatchingPolicy,
  StableRecord,
} from "../domain/reconciliation";

/** Erro estável de transporte: o chamador não deve depender da mensagem SQL. */
export class ReconciliationIdempotencyConflict extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("A chave de idempotência já foi usada com outro pedido.");
    this.name = "ReconciliationIdempotencyConflict";
  }
}

/** A concurrent decision created a newer immutable reconciliation leaf. */
export class ReconciliationRevisionConflict extends Error {
  readonly code = "REVISION_CONFLICT" as const;

  constructor(readonly leafReconciliationId: string) {
    super("Uma decisão concorrente criou uma revisão mais recente.");
    this.name = "ReconciliationRevisionConflict";
  }
}

/** PostgreSQL aborted the transaction to break a lock cycle. */
export class ReconciliationDeadlockFailure extends Error {
  readonly code = "RECONCILIATION_DEADLOCK" as const;

  constructor() {
    super("O PostgreSQL interrompeu a reconciliação para resolver um deadlock.");
    this.name = "ReconciliationDeadlockFailure";
  }
}

/** The immutable reconciliation base no longer matches the projection. */
export class ReconciliationProjectionConflict extends Error {
  readonly code = "PROJECTION_VERSION_CONFLICT" as const;

  constructor() {
    super("A projeção mudou enquanto a decisão era registrada.");
    this.name = "ReconciliationProjectionConflict";
  }
}


export class ReconciliationNotFoundFailure extends Error {
  readonly code = "RECONCILIATION_NOT_FOUND" as const;
  constructor() { super("A reconciliação não foi encontrada."); this.name = "ReconciliationNotFoundFailure"; }
}

export class ReconciliationIntegrityFailure extends Error {
  readonly code = "RECONCILIATION_INTEGRITY_FAILURE" as const;
  constructor() { super("O índice derivado da reconciliação está indisponível."); this.name = "ReconciliationIntegrityFailure"; }
}

export class ReconciliationDecisionInvalid extends Error {
  readonly code = "DECISION_INVALID" as const;
  constructor() {
    super("A decisão não é válida para o estado atual da reconciliação.");
    this.name = "ReconciliationDecisionInvalid";
  }
}


const CURSOR_VERSION = 1;
const CURSOR_DOMAIN = "TRIA/source-reconciliation/page-cursor/v1";
type PageCursorKind = "stable" | "absence";
type PageCursorBinding = { kind: PageCursorKind; reconciliationId: string; query: string; pageSize: number; page: number; anchor: string };
type PageCursorPayload = PageCursorBinding & { version: number; afterId: string };

export class ReconciliationPageCursorCodec {
  private readonly signingKey: Buffer;

  constructor(masterKey: Uint8Array | undefined) {
    if (!masterKey || masterKey.byteLength < 32) throw new Error("Chave server-side de cursor indisponível.");
    this.signingKey = createHmac("sha256", masterKey).update(CURSOR_DOMAIN).digest();
  }

  private signature(encoded: string) {
    return createHmac("sha256", this.signingKey).update(encoded).digest("base64url");
  }

  issue(binding: PageCursorBinding, afterId: string) {
    const encoded = Buffer.from(JSON.stringify({ version: CURSOR_VERSION, ...binding, afterId } satisfies PageCursorPayload)).toString("base64url");
    return `${encoded}.${this.signature(encoded)}`;
  }

  consume(cursor: string | undefined, binding: PageCursorBinding) {
    if (binding.page === 0) {
      if (cursor !== undefined) throw new Error("A primeira página não aceita cursor.");
      return undefined;
    }
    if (!cursor) throw new Error("A continuação exige o cursor da página anterior.");
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra !== undefined) throw new Error("Cursor de reconciliação inválido.");
    const expected = this.signature(encoded);
    const suppliedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new Error("Cursor de reconciliação inválido.");
    let payload: PageCursorPayload;
    try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PageCursorPayload; }
    catch { throw new Error("Cursor de reconciliação inválido."); }
    if (payload.version !== CURSOR_VERSION || payload.kind !== binding.kind || payload.reconciliationId !== binding.reconciliationId ||
        payload.query !== binding.query || payload.pageSize !== binding.pageSize || payload.page !== binding.page || payload.anchor !== binding.anchor ||
        typeof payload.afterId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.afterId)) {
      throw new Error("Cursor de reconciliação não corresponde à consulta ou à projeção vigente.");
    }
    return payload.afterId;
  }

  strictRequest(input: { cursor?: string; page?: number; pageSize?: number }, kind: PageCursorKind, reconciliationId: string, query: string, anchor: string) {
    const page = input.page ?? 0;
    const pageSize = input.pageSize ?? 50;
    if (!Number.isInteger(page) || page < 0 || page > 100_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || typeof anchor !== "string" || anchor.length < 5) {
      throw new Error("Parâmetros de paginação inválidos.");
    }
    const binding = { kind, reconciliationId, query, pageSize, page, anchor } satisfies PageCursorBinding;
    return { page, pageSize, afterId: this.consume(input.cursor, binding), binding };
  }
}

export type StoredReconciliation = {
  reconciliation: Reconciliation;
  fingerprint: string;
  idempotencyKey: string;
  requestId?: string;
};

/** Minimal safe context used by the explicit-link selector. */
export type StableRecordContext = NonNullable<Reconciliation["availableStableRecords"]>[number];
export type StableRecordPage = { page: number; pageSize: number; total: string; records: StableRecordContext[]; nextCursor?: string };
export type AbsencePage = { page: number; pageSize: number; total: string; absences: Reconciliation["absences"]; nextCursor?: string };

export type ReconciliationApplyResult = {
  reconciliation: Reconciliation;
  events: EffectiveRecordEvent[];
  projections: EffectiveRecordProjection[];
  /** The immutable projection captured in this transaction/version. */
  snapshot: EffectiveSnapshot;
  projectionVersion: string;
  appliedAt: string;
  reused: boolean;
  audit: {
    actor: "Rodrigo";
    confirmationId: string;
    batchId: string;
    previewId: string;
    sourceFileId: string;
    sourceSha256: string;
    contractHash: string;
    transformationHash: string;
    previewHash: string;
    policyVersion: string;
    decisions: ReconciliationDecision[];
    counts: Reconciliation["summary"];
    metrics?: ReconciliationMetrics;
  };
};

export type AtomicReconciliationDecisionInput = {
  reconciliationId: string;
  requestId: string;
  decision: Omit<ReconciliationDecision, "id" | "actor" | "decidedAt" | "policyVersion"> & { policyVersion?: string };
};
export type ReconciliationAbsenceChange = {
  stableRecordId: string;
  absent: boolean;
  item?: Reconciliation["absences"][number];
};

/** Compact acknowledgement. Consumers merge deltas or refresh the leaf; this is never a full Reconciliation. */
export type ReconciliationDecisionReceipt = {
  /** Current leaf identifier. */
  id: string;
  reconciliationId: string;
  parentReconciliationId?: string;
  revisionNo: string;
  fingerprint: string;
  status: Reconciliation["status"];
  summary: Reconciliation["summary"];
  metrics?: Reconciliation["metrics"];
  decisionCount: number;
  reused: boolean;
  /** When true, consumers must reopen reconciliationId and must not merge this receipt. */
  canonicalReopenRequired?: boolean;
  createdAt?: string;
  decision: ReconciliationDecision;
  changedLines: Reconciliation["lines"];
  absenceChanges: ReconciliationAbsenceChange[];
};

export interface SourceReconciliationRepository {
  findReconciliationByFingerprint(fingerprint: string): Promise<StoredReconciliation | undefined>;
  findReconciliationByIdempotencyKey(idempotencyKey: string): Promise<StoredReconciliation | undefined>;
  findReconciliationByPreview(previewId: string): Promise<StoredReconciliation | undefined>;
  findReconciliation(reconciliationId: string): Promise<StoredReconciliation | undefined>;
  /** Resolve the current append-only leaf for a revision tree. */
  findReconciliationLeaf(reconciliationId: string): Promise<StoredReconciliation | undefined>;
  /** Cheap leaf-token check used by paged reads. */
  currentLeafId(reconciliationId: string): Promise<string | undefined>;
  /** Atomically observes both mutable epochs used by interactive reads. */
  currentReadToken(reconciliationId: string): Promise<{ leafId: string; projectionVersion: string } | undefined>;
  /** Frozen applied leaf for a confirmation, independent of transport key. */
  findAppliedReconciliationByConfirmation(confirmationId: string): Promise<StoredReconciliation | undefined>;
  saveReconciliation(value: StoredReconciliation): Promise<StoredReconciliation>;
  saveDecision?(reconciliationId: string, decision: ReconciliationDecision): Promise<StoredReconciliation>;
  /** Atomic PostgreSQL capability. It never materializes the reconciliation graph. */
  recordDecisionAtomically?(input: AtomicReconciliationDecisionInput): Promise<ReconciliationDecisionReceipt>;
  listDecisions(reconciliationId: string): Promise<ReconciliationDecision[]>;
  listStableRecords(): Promise<StableRecord[]>;
  searchStableRecords(input: { reconciliationId: string; query?: string; cursor?: string; page?: number; pageSize?: number }): Promise<StableRecordPage>;
  listAbsences(reconciliationId: string, input: { cursor?: string; page?: number; pageSize?: number }): Promise<AbsencePage>;
  /** Allocate a process independent recovery attempt under the confirmation lock. */
  nextRecoveryAttempt(confirmationId: string, projectionVersion: string): Promise<string>;
  recoverConfirmedPreviewAtomically(input: { actor: "Rodrigo"; requestId: string; confirmation: PreviewConfirmation; preview: Preview; policy: MatchingPolicy }): Promise<{ reconciliation: Reconciliation; reused: boolean }>;
  currentProjectionVersion(): Promise<string>;
  listProjection(): Promise<EffectiveRecordProjection[]>;
  findSnapshotByReconciliation(reconciliationId: string): Promise<EffectiveSnapshot | undefined>;
  findSnapshotByBatch(batchId: string): Promise<EffectiveSnapshot | undefined>;
  applyReconciliation(input: { reconciliationId: string; idempotencyKey: string; requestId: string; actor: "Rodrigo"; }): Promise<ReconciliationApplyResult>;
}
