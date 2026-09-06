import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authentication: vi.fn<() => Promise<"authenticated" | "invalid" | "unavailable">>(),
  sameOrigin: vi.fn<() => Promise<void>>(),
  ledger: vi.fn(),
  service: { reconcile: vi.fn(), recover: vi.fn(), decide: vi.fn(), reopen: vi.fn(), reopenByPreview: vi.fn(), readSnapshot: vi.fn(), apply: vi.fn(), searchStable: vi.fn(), listAbsences: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ apiAuthenticationStatus: mocks.authentication, assertSameOrigin: mocks.sameOrigin }));
vi.mock("@/modules/source-ledger/public", () => ({
  getSourceLedgerService: mocks.ledger,
  getSourceReconciliationService: () => ({
    reconcileConfirmedPreview: mocks.service.reconcile,
    recoverConfirmedPreview: mocks.service.recover,
    recordDecision: mocks.service.decide,
    reopenReconciliation: mocks.service.reopen,
    reopenLatestReconciliation: mocks.service.reopenByPreview,
    readOfficialSnapshot: mocks.service.readSnapshot,
    applyReconciliation: mocks.service.apply,
    searchStableRecords: mocks.service.searchStable,
    listAbsences: mocks.service.listAbsences,
  }),
  syntheticRegistryIds: { schemaId: "synthetic-source-schema-v1", parserProfileId: "synthetic-safe-v1", transformationId: "remove-course-track-v1", limitsProfileId: "synthetic-safe-v1" },
  SourceLedgerError: class SourceLedgerError extends Error {
    code: string;
    requestId: string;

    constructor(code: string, message: string, requestId: string) {
      super(message);
      this.code = code;
      this.requestId = requestId;
    }

    toDTO() {
      return { kind: "structural", code: this.code, message: this.message, requestId: this.requestId };
    }
  },
  SourceReconciliationError: class SourceReconciliationError extends Error {
    constructor(readonly code: string, message: string, readonly requestId: string, readonly leafReconciliationId?: string) {
      super(message);
    }
  },
}));

const validUuid = "10000000-0000-4000-8000-000000000001";

describe("ações de reconciliação — autenticação e origem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["compare", () => import("./actions").then(({ reconcileConsolidatedPreviewAction }) => reconcileConsolidatedPreviewAction({ idempotencyKey: "reconcile-test", previewId: validUuid }))],
    ["decide", () => import("./actions").then(({ decideConsolidatedReconciliationAction }) => decideConsolidatedReconciliationAction({ reconciliationId: validUuid, observationId: validUuid, outcome: "reject", policyVersion: "v1", rationale: "Rodrigo decidiu rejeitar", version: "1" }))],
    ["reopen", () => import("./actions").then(({ reopenConsolidatedReconciliationAction }) => reopenConsolidatedReconciliationAction({ reconciliationId: validUuid }))],
    ["reopen-by-preview", () => import("./actions").then(({ reopenConsolidatedReconciliationByPreviewAction }) => reopenConsolidatedReconciliationByPreviewAction({ previewId: validUuid }))],
    ["read-snapshot", () => import("./actions").then(({ readConsolidatedReconciliationSnapshotAction }) => readConsolidatedReconciliationSnapshotAction({ reconciliationId: validUuid }))],
    ["apply", () => import("./actions").then(({ applyConsolidatedReconciliationAction }) => applyConsolidatedReconciliationAction({ reconciliationId: validUuid, idempotencyKey: "apply-test" }))],
  ])("recusa %s sem sessão", async (_name, call) => {
    mocks.authentication.mockResolvedValue("invalid");
    const result = await call();
    expect(result).toMatchObject({ ok: false, error: { code: "AUTHENTICATION_REQUIRED" } });
    expect(mocks.sameOrigin).not.toHaveBeenCalled();
    expect(Object.values(mocks.service).every((method) => !method.mock.calls.length)).toBe(true);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it.each([
    ["compare", () => import("./actions").then(({ reconcileConsolidatedPreviewAction }) => reconcileConsolidatedPreviewAction({ idempotencyKey: "reconcile-origin-test", previewId: validUuid }))],
    ["decide", () => import("./actions").then(({ decideConsolidatedReconciliationAction }) => decideConsolidatedReconciliationAction({ reconciliationId: validUuid, observationId: validUuid, outcome: "reject", policyVersion: "v1", rationale: "Rodrigo decidiu rejeitar", version: "1" }))],
    ["reopen", () => import("./actions").then(({ reopenConsolidatedReconciliationAction }) => reopenConsolidatedReconciliationAction({ reconciliationId: validUuid }))],
    ["reopen-by-preview", () => import("./actions").then(({ reopenConsolidatedReconciliationByPreviewAction }) => reopenConsolidatedReconciliationByPreviewAction({ previewId: validUuid }))],
    ["read-snapshot", () => import("./actions").then(({ readConsolidatedReconciliationSnapshotAction }) => readConsolidatedReconciliationSnapshotAction({ reconciliationId: validUuid }))],
    ["apply", () => import("./actions").then(({ applyConsolidatedReconciliationAction }) => applyConsolidatedReconciliationAction({ reconciliationId: validUuid, idempotencyKey: "apply-origin-test" }))],
  ])("não envia %s quando same-origin falha", async (_name, call) => {
    mocks.authentication.mockResolvedValue("authenticated");
    mocks.sameOrigin.mockRejectedValue(new Error("origem interna inválida e não deve vazar"));
    const result = await call();
    expect(result).toMatchObject({ ok: false, error: { code: "SOURCE_PREPARATION_UNAVAILABLE" } });
    expect(result.ok ? "" : result.error.message).not.toContain("origem interna inválida");
    expect(mocks.sameOrigin).toHaveBeenCalledOnce();
    expect(Object.values(mocks.service).every((method) => !method.mock.calls.length)).toBe(true);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });
});

describe("snapshot oficial pela Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authentication.mockResolvedValue("authenticated");
    mocks.sameOrigin.mockResolvedValue();
  });

  it("retorna o snapshot congelado da reconciliação mesmo após outra aplicação", async () => {
    const snapshot = { id: validUuid, reconciliationId: validUuid, batchId: "20000000-0000-4000-8000-000000000001", projectionVersion: "7", projection: [{ recordId: "30000000-0000-4000-8000-000000000001", payload: { valor: "10.00" }, state: "active", version: "7" }], createdAt: "2026-01-01T00:00:00.000Z" } as const;
    mocks.service.readSnapshot.mockResolvedValue(snapshot);
    const { readConsolidatedReconciliationSnapshotAction } = await import("./actions");
    const result = await readConsolidatedReconciliationSnapshotAction({ reconciliationId: validUuid });
    expect(result).toEqual({ ok: true, data: snapshot });
    expect(mocks.service.readSnapshot).toHaveBeenCalledWith(expect.objectContaining({ actor: "Rodrigo", reconciliationId: validUuid }));
  });

  it.each([
    ["sem seletor", {}],
    ["com os dois seletores", { reconciliationId: validUuid, batchId: "20000000-0000-4000-8000-000000000001" }],
  ])("recusa pedido de snapshot %s", async (_name, input) => {
    const { readConsolidatedReconciliationSnapshotAction } = await import("./actions");
    const result = await readConsolidatedReconciliationSnapshotAction(input);
    expect(result).toMatchObject({ ok: false, error: { code: "SNAPSHOT_INVALID" } });
    expect(mocks.service.readSnapshot).not.toHaveBeenCalled();
  });

  it("aceita o seletor de lote isoladamente", async () => {
    const batchId = "20000000-0000-4000-8000-000000000001";
    const snapshot = { id: validUuid, reconciliationId: "30000000-0000-4000-8000-000000000001", batchId, projectionVersion: "8", projection: [], createdAt: "2026-01-02T00:00:00.000Z" } as const;
    mocks.service.readSnapshot.mockResolvedValue(snapshot);
    const { readConsolidatedReconciliationSnapshotAction } = await import("./actions");
    const result = await readConsolidatedReconciliationSnapshotAction({ batchId });
    expect(result).toEqual({ ok: true, data: snapshot });
    expect(mocks.service.readSnapshot).toHaveBeenCalledWith(expect.objectContaining({ actor: "Rodrigo", batchId }));
  });
});

describe("erros estruturais da reconciliação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authentication.mockResolvedValue("authenticated");
    mocks.sameOrigin.mockResolvedValue();
  });

  it("preserva código e leafReconciliationId em conflito de revisão", async () => {
    const leafReconciliationId = "50000000-0000-4000-8000-000000000001";
    mocks.service.decide.mockRejectedValue(new (await import("@/modules/source-ledger/public")).SourceReconciliationError("REVISION_CONFLICT", "revisão concorrente", "request", leafReconciliationId));
    const { decideConsolidatedReconciliationAction } = await import("./actions");
    const result = await decideConsolidatedReconciliationAction({ reconciliationId: validUuid, observationId: validUuid, outcome: "reject", policyVersion: "v1", rationale: "Rodrigo decidiu rejeitar", version: "1" });
    expect(result).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT", leafReconciliationId } });
  });

  it("expõe a implementação canônica pela única boundary de Server Actions", async () => {
    const canonical = await import("./actions");
    expect(canonical.decideConsolidatedReconciliationAction).toEqual(expect.any(Function));
    expect(canonical.searchConsolidatedStableRecordsAction).toEqual(expect.any(Function));
    expect(canonical.listConsolidatedAbsencesAction).toEqual(expect.any(Function));
  });

  it.each([
    [{ reconciliationId: validUuid, page: 0, pageSize: 50, cursor: "x".repeat(80) }],
    [{ reconciliationId: validUuid, page: 1, pageSize: 50 }],
  ])("rejeita cursor fora da relação exata página/continuação", async (payload) => {
    mocks.authentication.mockResolvedValue("authenticated");
    const { listConsolidatedAbsencesAction } = await import("./actions");
    await expect(listConsolidatedAbsencesAction(payload)).resolves.toMatchObject({ ok: false, error: { code: "RECONCILIATION_INVALID" } });
    expect(mocks.service.listAbsences).not.toHaveBeenCalled();
  });

  it.each(["RECONCILIATION_INTEGRITY_FAILURE", "RECONCILIATION_NOT_FOUND"])("preserva o código %s da página de ausências", async (code) => {
    const { SourceReconciliationError } = await import("@/modules/source-ledger/public");
    mocks.service.listAbsences.mockRejectedValueOnce(new SourceReconciliationError(code, "falha pública da ausência", "repository-request"));
    const { listConsolidatedAbsencesAction } = await import("./actions");
    await expect(listConsolidatedAbsencesAction({ reconciliationId: validUuid, page: 0, pageSize: 50 })).resolves.toMatchObject({ ok: false, error: { code, message: "falha pública da ausência" } });
  });

  it("aceita e encaminha os cursores reais das duas Server Actions estritas", async () => {
    const cursor = "opaque." + "x".repeat(80);
    const page = { page: 1, pageSize: 50, total: "9007199254740993", records: [], nextCursor: cursor };
    const absences = { page: 1, pageSize: 50, total: "9007199254740995", absences: [], nextCursor: cursor };
    mocks.service.searchStable.mockResolvedValue(page);
    mocks.service.listAbsences.mockResolvedValue(absences);
    const { searchConsolidatedStableRecordsAction, listConsolidatedAbsencesAction } = await import("./actions");
    await expect(searchConsolidatedStableRecordsAction({ reconciliationId: validUuid, query: "A-1", cursor, page: 1, pageSize: 50 })).resolves.toEqual({ ok: true, data: page });
    await expect(listConsolidatedAbsencesAction({ reconciliationId: validUuid, cursor: cursor, page: 1, pageSize: 50 })).resolves.toEqual({ ok: true, data: absences });
    expect(mocks.service.searchStable).toHaveBeenCalledWith(expect.objectContaining({ reconciliationId: validUuid, query: "A-1", cursor, page: 1, pageSize: 50 }));
    expect(mocks.service.listAbsences).toHaveBeenCalledWith(expect.objectContaining({ reconciliationId: validUuid, cursor: cursor, page: 1, pageSize: 50 }));
  });
});
