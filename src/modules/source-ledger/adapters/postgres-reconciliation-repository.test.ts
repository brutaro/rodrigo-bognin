import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresSourceReconciliationRepository } from "./postgres-reconciliation-repository";
import { SourceReconciliationService } from "../application/reconcile-import";
import { ReconciliationIntegrityFailure, ReconciliationPageCursorCodec } from "../application/reconciliation-repository";

const TEST_CURSOR_KEY = Buffer.alloc(32, 0x5a);

const recordId = "10000000-0000-4000-8000-000000000001";
const observationId = "20000000-0000-4000-8000-000000000001";
const adjustmentEventId = "30000000-0000-4000-8000-000000000001";
const decisionEventId = "40000000-0000-4000-8000-000000000001";

function event(input: { id: string; layer: "source" | "adjustment" | "decision"; payload: string; occurredAt: string; observationId?: string | null }) {
  return {
    id: input.id,
    record_id: recordId,
    observation_id: input.observationId ?? null,
    event_type: input.layer === "source" ? "observation.accepted" as const : input.layer === "adjustment" ? "adjustment.revised" as const : "decision.audit" as const,
    layer: input.layer,
    state: "active" as const,
    payload: { valor: input.payload },
    decimal_sources: { valor: { source_text: input.payload, source_scale: 2, normalized_value: input.payload } },
    duration_sources: {},
    version: input.layer,
    occurred_at: input.occurredAt,
    decision_id: input.layer === "decision" ? "50000000-0000-4000-8000-000000000001" : null,
    decision_rationale: input.layer === "decision" ? "Decisão vigente." : null,
    decision_version: input.layer === "decision" ? "1" : null,
    decision_decided_at: input.layer === "decision" ? input.occurredAt : null,
  };
}

function repositoryFixture(options: { emptyCurrentMetadata?: boolean; nullCurrentMetadata?: boolean; omitReferencedEvents?: boolean; decisionSortsBeforeSource?: boolean; injectReservedKeys?: boolean } = {}) {
  const historical = event({ id: "60000000-0000-4000-8000-000000000001", layer: "source", payload: "histórico", occurredAt: "2025-01-01T00:00:00.000Z", observationId });
  const source = event({ id: "70000000-0000-4000-8000-000000000001", layer: "source", payload: "fonte-vigente", occurredAt: "2026-01-01T00:00:00.000Z", observationId });
  const adjustment = event({ id: adjustmentEventId, layer: "adjustment", payload: "ajuste-vigente", occurredAt: "2026-01-02T00:00:00.000Z" });
  const decision = event({ id: decisionEventId, layer: "decision", payload: "decisão-vigente", occurredAt: "2026-01-03T00:00:00.000Z" });
  const projection = {
    id: recordId,
    state: "active" as const,
    projection_state: "active" as const,
    matching_attributes: { stable_key: "A-1" },
    projection_payload: { valor: "decisão-vigente" },
    projection_decimal_sources: { valor: { source_text: "decisão-vigente", source_scale: 2, normalized_value: "decisão-vigente" } },
    projection_duration_sources: {},
    adjustment_event_payload: adjustment.payload,
    decision_event_payload: decision.payload,
    source_observation_id: observationId,
    adjustment_event_id: adjustmentEventId,
    decision_event_id: decisionEventId,
    projection_version: "3",
  };
  if (options.injectReservedKeys) {
    Object.assign(projection.matching_attributes, { Curso: "privado" });
    Object.assign(projection.projection_payload, { TRILHA: "privada" });
    Object.assign(decision.payload, { Curso: "privado" });
    Object.assign(decision.decimal_sources, { TRILHA: { source_text: "1.00", source_scale: 2, normalized_value: "1.00" } });
  }
  const calls: string[] = [];
  const executor = <T>(strings: TemplateStringsArray) => {
    const query = Array.from(strings).join(" ");
    calls.push(query);
    if (query.includes("FROM src_stable_record r")) return Promise.resolve([projection] as T);
    if (query.includes("FROM src_effective_record_event e")) {
      // Model the database selection: only the latest source event for the
      // projected observation and the exact adjustment/decision references
      // are returned. An unrestricted legacy query would return historical
      // before source and make hydration choose the wrong payload.
      const current = query.includes("current_source_event");
      const currentEvents = current ? (options.omitReferencedEvents ? [source] : options.decisionSortsBeforeSource ? [decision, source, adjustment] : [source, adjustment, decision]) : [historical, source, adjustment, decision];
      if (options.emptyCurrentMetadata) {
        for (const currentEvent of currentEvents) {
          currentEvent.decimal_sources = {} as typeof currentEvent.decimal_sources;
          currentEvent.duration_sources = {};
        }
      }
      if (options.nullCurrentMetadata) {
        for (const currentEvent of currentEvents) {
          (currentEvent as { decimal_sources: unknown }).decimal_sources = null;
          (currentEvent as { duration_sources: unknown }).duration_sources = null;
        }
      }
      return Promise.resolve(currentEvents as T);
    }
    throw new Error(`Consulta inesperada: ${query}`);
  };
  return { repository: new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY), calls };
}

describe("PostgresSourceReconciliationRepository.stableRecords", () => {
  it("lê somente eventos indexados pela projeção e mantém o contexto vigente", async () => {
    const { repository, calls } = repositoryFixture();
    const [record] = await repository.listStableRecords();
    const eventQuery = calls.find((query) => query.includes("WITH current_source_event"));

    expect(eventQuery).toContain("current_source_event");
    expect(eventQuery).toContain("p.adjustment_event_id");
    expect(eventQuery).toContain("p.decision_event_id");
    expect(eventQuery).toContain("e.event_type IN ('record.inserted', 'observation.accepted')");
    expect(record).toMatchObject({
      id: recordId,
      sourceObservationId: observationId,
      sourcePayload: { valor: "fonte-vigente" },
      adjustmentPayload: { valor: "ajuste-vigente" },
      auditedDecisionPayload: { valor: "decisão-vigente" },
      adjustmentEventId,
      decisionEventId,
      effectiveLayer: "decision",
      effectivePayload: { valor: "decisão-vigente" },
    });
    expect(JSON.stringify(record)).not.toContain("histórico");
  });

  it("retorna a página de ausências já limitada pelo SQL", async () => {
    const calls: string[] = [];
    const parameters: unknown[][] = [];
    const executor = <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Array.from(strings).join(" ");
      calls.push(query);
      parameters.push(values);
      if (query.includes("head.leaf_reconciliation_id")) return Promise.resolve([{ id: "80000000-0000-4000-8000-000000000001" }] as T);
      if (query.includes("FROM src_projection_version")) return Promise.resolve([{ version: "7" }] as T);
      if(query.includes("source_reconciliation_absence_page"))return Promise.resolve([{items:[{stableRecordId:"90000000-0000-4000-8000-000000000002",status:"not_observed_this_batch",label:"Não observado neste lote"}],total_count:"3",has_more:true}] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    const reconciliationId = "80000000-0000-4000-8000-000000000001";
    const cursor = new ReconciliationPageCursorCodec(TEST_CURSOR_KEY).issue({ kind: "absence", reconciliationId, query: "", page: 1, pageSize: 1, anchor: `leaf:${reconciliationId}` }, "90000000-0000-4000-8000-000000000001");
    const result = await repository.listAbsences(reconciliationId, { page: 1, pageSize: 1, cursor });
    expect(result).toMatchObject({ page: 1, pageSize: 1, total: "3", absences: [{ stableRecordId: "90000000-0000-4000-8000-000000000002" }] });
    const absenceCall = calls.findIndex((query) => query.includes("source_reconciliation_absence_page"));
    expect(absenceCall).toBeGreaterThanOrEqual(0);
    expect(parameters[absenceCall]).toEqual([reconciliationId, "90000000-0000-4000-8000-000000000001", 1]);
    expect(calls[absenceCall]).not.toContain("OFFSET");
    expect(calls[absenceCall]).not.toContain("LIMIT");
    expect(calls.join(" ")).not.toContain("source_reconciliation_materialize_manifest");
    expect(calls.join(" ")).not.toContain("src_effective_record_projection");
    expect(calls.join(" ")).not.toContain("src_stable_record");
  });

  it("preserva o clear explícito quando o evento vigente traz metadata vazia", async () => {
    const { repository } = repositoryFixture({ emptyCurrentMetadata: true });
    const [record] = await repository.listStableRecords();
    expect(record).toHaveProperty("decimalSources");
    expect(record).toHaveProperty("durationSources");
    expect(record.decimalSources).toEqual({});
    expect(record.durationSources).toEqual({});
  });

  it("não usa metadata antiga da projeção quando o evento vigente registra missing", async () => {
    const { repository } = repositoryFixture({ nullCurrentMetadata: true });
    const [record] = await repository.listStableRecords();
    expect(record).not.toHaveProperty("decimalSources");
    expect(record).not.toHaveProperty("durationSources");
  });

  it("falha fechado quando a lista indexada não traz um evento apontado", async () => {
    const { repository } = repositoryFixture({ omitReferencedEvents: true });
    await expect(repository.listStableRecords()).rejects.toBeInstanceOf(ReconciliationIntegrityFailure);
  });

  it("não confunde decision.audit com source quando observation e ordenação coincidem", async () => {
    const { repository } = repositoryFixture({ decisionSortsBeforeSource: true });
    const [record] = await repository.listStableRecords();
    expect(record.sourcePayload).toEqual({ valor: "fonte-vigente" });
    expect(record.auditedDecisionPayload).toEqual({ valor: "decisão-vigente" });
  });

  it("remove Curso/TRILHA sem distinção de caixa em qualquer DTO hidratado", async () => {
    const { repository } = repositoryFixture({ injectReservedKeys: true });
    const [record] = await repository.listStableRecords();
    expect(JSON.stringify(record)).not.toMatch(/curso|trilha/i);
  });
});



describe("PostgresSourceReconciliationRepository replay SELECT-only", () => {
  it("resolve a leaf corrente pela chave exata sem row lock nem transação cliente", async () => {
    const rootId = "80000000-0000-4000-8000-000000000010";
    const leafId = "80000000-0000-4000-8000-000000000011";
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const executor = <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Array.from(strings).join(" ");
      calls.push({ query, values });
      if (query.includes("FROM src_reconciliation_request q")) return Promise.resolve([{ root_id: rootId, leaf_id: leafId, request_hash: "a".repeat(64), root_hash: "a".repeat(64) }] as T);
      if (query.includes("read_source_reconciliation")) return Promise.resolve([{ reconciliation: { id: leafId, createdAt: "2026-01-01T00:00:00.000000+00:00", status: "ready-to-apply", lines: [], decisions: [], summary: {} }, decisions: [], fingerprint: "b".repeat(64), idempotency_key: "root-key" }] as T);
      if (query.includes("src_reconciliation_application")) return Promise.resolve([{ projection_version: null }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.findReconciliationByIdempotencyKey("root-key")).resolves.toMatchObject({ reconciliation: { id: leafId }, idempotencyKey: "root-key" });
    const lookup = calls.find((call) => call.query.includes("FROM src_reconciliation_request q"));
    expect(lookup?.values).toEqual(["root-key"]);
    expect(lookup?.query).not.toMatch(/FOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)/i);
  });
});

describe("PostgresSourceReconciliationRepository.one error normalization", () => {
  const repositoryThrowing = (error: unknown) => new PostgresSourceReconciliationRepository(((strings: TemplateStringsArray) => {
    const query = Array.from(strings).join(" ");
    if (query.includes("read_source_reconciliation")) return Promise.reject(error);
    throw new Error(`Consulta inesperada: ${query}`);
  }) as unknown as Sql, TEST_CURSOR_KEY);

  it("mapeia XX001 do reader autenticado para falha de integridade", async () => {
    await expect(repositoryThrowing({ code: "XX001", message: "authenticated chain is corrupt" }).findReconciliation("80000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "RECONCILIATION_INTEGRITY_FAILURE" });
  });

  it("preserva erro não PostgreSQL sem normalização destrutiva", async () => {
    const raw = new Error("reader transport failure");
    await expect(repositoryThrowing(raw).findReconciliation("80000000-0000-4000-8000-000000000001")).rejects.toBe(raw);
  });
});

describe("PostgresSourceReconciliationRepository.one decision hydration", () => {
  const reconciliationId = "80000000-0000-4000-8000-000000000001";
  const physicalDecision = {
    id: "50000000-0000-4000-8000-000000000009", observation_id: observationId, locator: "row:1", stable_record_id: null,
    outcome: "reject" as const, actor: "Rodrigo" as const, decided_at: "2026-01-01T00:00:00.123456+00:00",
    policy_version: "server-owned-preview-matching-v1", rationale: "Rejeição explícita.", version: "1", revision_no: 1,
  };
  const repositoryFor = (embedded: Record<string, unknown>) => {
    const manifest = { id: reconciliationId, createdAt: "2026-01-01T00:00:00.000000+00:00", lines: [{ observation: { id: observationId, observedAt: "2026-01-01T00:00:00.000000+00:00" }, category: "rejected", decision: embedded }], decisions: [embedded], summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 1, conflict: 0, total: 1, absent: 0, pendingDecisions: 0 } };
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("read_source_reconciliation")) return Promise.resolve([{ reconciliation: manifest, decisions: [embeddedDecision()], fingerprint: "a".repeat(64), idempotency_key: "hydrate" }] as T);
      if (query.includes("src_reconciliation_application")) return Promise.resolve([{ projection_version: null }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    return new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
  };
  const embeddedDecision = (overrides: Record<string, unknown> = {}) => ({
    id: physicalDecision.id, observationId, locator: "row:1", outcome: "reject", actor: "Rodrigo",
    decidedAt: physicalDecision.decided_at, policyVersion: physicalDecision.policy_version,
    rationale: physicalDecision.rationale, version: "1", revisionNo: 1, ...overrides,
  });

  it("substitui a decisão embutida pelo objeto físico canônico", async () => {
    const stored = await repositoryFor(embeddedDecision()).findReconciliation(reconciliationId);
    expect(stored?.reconciliation.decisions[0]).toMatchObject({ decidedAt: "2026-01-01T00:00:00.123Z" });
    expect(stored?.reconciliation.lines[0].decision).toEqual(stored?.reconciliation.decisions[0]);
  });

  it.each([
    ["id ausente", { id: "50000000-0000-4000-8000-000000000099" }],
    ["semântica divergente", { outcome: "create" }],
  ])("falha fechada para decisão embutida com %s", async (_case, overrides) => {
    await expect(repositoryFor(embeddedDecision(overrides)).findReconciliation(reconciliationId)).rejects.toMatchObject({ code: "RECONCILIATION_INTEGRITY_FAILURE" });
  });
});

describe("PostgresSourceReconciliationRepository.saveReconciliation", () => {
  it("resolve primeiro o binding reconcile pelo rootRequestHash sem comparar fingerprint da revisão", async () => {
    const rootId = "80000000-0000-4000-8000-000000000010";
    const incomingId = "80000000-0000-4000-8000-000000000011";
    const rootRequestHash = "a".repeat(64);
    const root = { id: rootId, createdAt: "2026-01-01T00:00:00.000000+00:00", status: "ready-to-apply", lines: [], decisions: [], summary: {}, rootRequestHash };
    const queries: string[] = [];
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      queries.push(query);
      if (query.includes("pg_advisory_xact_lock")) return Promise.resolve([] as T);
      if (query.includes("FROM src_reconciliation_request q")) return Promise.resolve([{
        reconciliation: root, root_id: rootId, request_root_hash: rootRequestHash, stored_root_hash: rootRequestHash,
      }] as T);
      if (query.includes("WITH RECURSIVE descendants")) return Promise.resolve([{ id: rootId }] as T);
      if (query.includes("read_source_reconciliation")) return Promise.resolve([{
        reconciliation: root, decisions: [], fingerprint: "c".repeat(64), idempotency_key: "race-key",
      }] as T);
      if (query.includes("LEFT JOIN src_reconciliation_application")) return Promise.resolve([{ projection_version: null }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const raw = Object.assign(executor, {
      begin: async (callback: (tx: Sql) => Promise<unknown>) => callback(raw as unknown as Sql),
    });
    const sql = raw as unknown as Sql;
    const repository = new PostgresSourceReconciliationRepository(sql, TEST_CURSOR_KEY);
    const incoming = { ...root, id: incomingId };
    const value = { reconciliation: incoming, fingerprint: "b".repeat(64), idempotencyKey: "race-key", requestId: "90000000-0000-4000-8000-000000000001" } as unknown as Parameters<typeof repository.saveReconciliation>[0];

    await expect(repository.saveReconciliation(value)).resolves.toMatchObject({ reconciliation: { id: rootId }, idempotencyKey: "race-key" });
    const requestIndex = queries.findIndex((query) => query.includes("FROM src_reconciliation_request q"));
    const collisionIndex = queries.findIndex((query) => query.includes("SELECT id::text FROM src_reconciliation WHERE idempotency_key"));
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(collisionIndex).toBe(-1);
    expect(queries[requestIndex]).toContain("q.root_request_hash::text request_root_hash");
    expect(queries[requestIndex]).toContain("root.root_request_hash::text stored_root_hash");
    expect(queries[requestIndex]).not.toContain("fingerprint");
  });

  it.each([
    ["request adulterado", "b".repeat(64), "a".repeat(64), "a".repeat(64), "a".repeat(64), "RECONCILIATION_INTEGRITY_FAILURE"],
    ["manifest adulterado", "a".repeat(64), "a".repeat(64), "b".repeat(64), "a".repeat(64), "RECONCILIATION_INTEGRITY_FAILURE"],
    ["comando diferente", "a".repeat(64), "a".repeat(64), "a".repeat(64), "b".repeat(64), "IDEMPOTENCY_CONFLICT"],
  ])("falha fechado para %s no binding reconcile", async (_case, requestHash, storedHash, manifestHash, incomingHash, code) => {
    const rootId = "80000000-0000-4000-8000-000000000020";
    const root = { id: rootId, createdAt: "2026-01-01T00:00:00.000000+00:00", status: "ready-to-apply", lines: [], decisions: [], summary: {}, rootRequestHash: manifestHash };
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("pg_advisory_xact_lock")) return Promise.resolve([] as T);
      if (query.includes("FROM src_reconciliation_request q")) return Promise.resolve([{
        reconciliation: root, root_id: rootId, request_root_hash: requestHash, stored_root_hash: storedHash,
      }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const raw = Object.assign(executor, { begin: async (callback: (tx: Sql) => Promise<unknown>) => callback(raw as unknown as Sql) });
    const sql = raw as unknown as Sql;
    const repository = new PostgresSourceReconciliationRepository(sql, TEST_CURSOR_KEY);
    const value = { reconciliation: { ...root, rootRequestHash: incomingHash }, fingerprint: "c".repeat(64), idempotencyKey: "race-key", requestId: "90000000-0000-4000-8000-000000000002" } as unknown as Parameters<typeof repository.saveReconciliation>[0];
    await expect(repository.saveReconciliation(value)).rejects.toMatchObject({ code });
  });
});

describe("PostgresSourceReconciliationRepository.searchStableRecords", () => {
  it.each(["%", "_", "\\"])("envia a consulta literal normalizada %s para o único pager canônico", async (queryText) => {
    const reconciliationId = "80000000-0000-4000-8000-000000000001";
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const executor = <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Array.from(strings).join(" ");
      calls.push({ query, values });
      if (query.includes("head.leaf_reconciliation_id") && query.includes("projection_version")) return Promise.resolve([{ leaf_id: reconciliationId, projection_version: "3" }] as T);
      if (query.includes("source_reconciliation_stable_record_page")) return Promise.resolve([{ stable_record_id: null, total: "0" }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.searchStableRecords({ reconciliationId, query: `  ${queryText}  `, page: 0, pageSize: 1 })).resolves.toMatchObject({ total: "0", records: [] });
    const [searchQuery] = calls.filter((call) => call.query.includes("source_reconciliation_stable_record_page"));
    expect(searchQuery.query).not.toContain("src_effective_record_projection");
    expect(searchQuery.query).not.toContain("src_stable_record");
    expect(searchQuery.values).toContain(queryText);
    expect(searchQuery.values).toContain(2);
    expect(calls).toHaveLength(3);
  });

  it("mapeia a tupla efetiva sem hydration e preserva SQL NULL versus mapa vazio", async () => {
    const reconciliationId = "80000000-0000-4000-8000-000000000001";
    const recordId = "90000000-0000-4000-8000-000000000001";
    const calls: string[] = [];
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      calls.push(query);
      if (query.includes("head.leaf_reconciliation_id") && query.includes("projection_version")) return Promise.resolve([{ leaf_id: reconciliationId, projection_version: "3" }] as T);
      if (query.includes("source_reconciliation_stable_record_page")) return Promise.resolve([{
        stable_record_id: recordId, matching_attributes: { curso: "privado", safe: "value" },
        effective_payload: {}, decimal_sources: null, duration_sources: {}, effective_layer: "source",
        projection_version: null, total: "1",
      }] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.searchStableRecords({ reconciliationId, page: 0, pageSize: 5 })).resolves.toEqual({
      page: 0, pageSize: 5, total: "1", records: [{ id: recordId, matchingAttributes: { safe: "value" }, effectiveLayer: "source", effectivePayload: {}, durationSources: {} }],
    });
    expect(calls.filter((query) => query.includes("source_reconciliation_stable_record_page"))).toHaveLength(1);
    expect(calls.some((query) => query.includes("FROM src_effective_record_event e"))).toBe(false);
  });

  it("normaliza XX001 emitido pelo pager canônico", async () => {
    const reconciliationId = "80000000-0000-4000-8000-000000000001";
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("head.leaf_reconciliation_id") && query.includes("projection_version")) return Promise.resolve([{ leaf_id: reconciliationId, projection_version: "3" }] as T);
      if (query.includes("source_reconciliation_stable_record_page")) return Promise.reject(Object.assign(new Error("pointer"), { code: "XX001" })) as Promise<T>;
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.searchStableRecords({ reconciliationId, page: 0, pageSize: 1 })).rejects.toMatchObject({ code: "RECONCILIATION_INTEGRITY_FAILURE" });
  });

  it("falha se a projeção mudar entre a leitura do epoch e a página", async () => {
    const reconciliationId = "80000000-0000-4000-8000-000000000001";
    let epochReads = 0;
    const executor = <T>(strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("head.leaf_reconciliation_id") && query.includes("projection_version")) return Promise.resolve([{ leaf_id: reconciliationId, projection_version: String(++epochReads) }] as T);
      if (query.includes("source_reconciliation_stable_record_page")) return Promise.resolve([{ stable_record_id: null, total: "0" }] as T);
      if (query.includes("FROM src_stable_record r") || query.includes("FROM src_effective_record_event e")) return Promise.resolve([] as T);
      throw new Error(`Consulta inesperada: ${query}`);
    };
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.searchStableRecords({ reconciliationId, page: 0, pageSize: 1 })).rejects.toMatchObject({ code: "PROJECTION_VERSION_CONFLICT" });
    expect(epochReads).toBe(2);
  });
});

describe("PostgresSourceReconciliationRepository.listAbsences", () => {
  it.each([
    ["XX001", "RECONCILIATION_INTEGRITY_FAILURE"],
    ["P0002", "RECONCILIATION_NOT_FOUND"],
  ])("normaliza SQLSTATE %s no boundary público do repository", async (sqlState, publicCode) => {
    const executor = <T>() => Promise.reject(Object.assign(new Error("falha PostgreSQL"), { code: sqlState })) as Promise<T>;
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    await expect(repository.listAbsences("80000000-0000-4000-8000-000000000001", { page: 0, pageSize: 1 })).rejects.toMatchObject({ code: publicCode });
  });
});

describe("recordDecisionAtomically", () => {
  it("executa um único comando compacto sem materializar grafo ou catálogo", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const line = { observation: { id: observationId, batchId: "10000000-0000-4000-8000-000000000001", previewId: "10000000-0000-4000-8000-000000000002", sourceFileId: "10000000-0000-4000-8000-000000000003", locator: "row:1" }, category: "rejected", match: { candidateIds: [], candidateCount: 0, outcome: "none" }, fieldDiffs: [], consequence: "rejected" };
    const decision = { id: "50000000-0000-4000-8000-000000000009", observationId, locator: "row:1", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:00.123456+00:00", policyVersion: "server-owned-preview-matching-v1", rationale: "Rejeição explícita.", version: "1", revisionNo: 1 };
    const executor = <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ query: Array.from(strings).join(" "), values });
      return Promise.resolve([{ receipt: { id: "80000000-0000-4000-8000-000000000001", reconciliationId: "80000000-0000-4000-8000-000000000001", parentReconciliationId: "80000000-0000-4000-8000-000000000000", revisionNo: "2", fingerprint: "a".repeat(64), status: "ready-to-apply", summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 1, conflict: 0, total: 10_000, absent: 0, pendingDecisions: 0 }, metrics: { decimalSums: {}, durationSums: {} }, decision, changedLines: [line], absenceChanges: [], decisionCount: 1, reused: false } }] as T);
    };
    (executor as unknown as { json: (value: unknown) => unknown }).json = (value) => value;
    const repository = new PostgresSourceReconciliationRepository(executor as unknown as Sql, TEST_CURSOR_KEY);
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE, runtime: process.env.TRIA_RUNTIME };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-adjustments-atomic-test";
    delete process.env.TRIA_RUNTIME;
    let receipt: Awaited<ReturnType<SourceReconciliationService["recordDecision"]>>;
    try {
      receipt = await new SourceReconciliationService(repository).recordDecision({ actor: "Rodrigo", reconciliationId: "80000000-0000-4000-8000-000000000000", requestId: "70000000-0000-4000-8000-000000000001", decision: { observationId, locator: "row:1", outcome: "reject", policyVersion: "ignored-at-sql-boundary", rationale: "Rejeição explícita.", version: "1" } });
    } finally {
      if (previous.upload === undefined) delete process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD; else process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = previous.upload;
      if (previous.isolated === undefined) delete process.env.TRIA_INTEGRATION_ISOLATED; else process.env.TRIA_INTEGRATION_ISOLATED = previous.isolated;
      if (previous.namespace === undefined) delete process.env.TRIA_INTEGRATION_NAMESPACE; else process.env.TRIA_INTEGRATION_NAMESPACE = previous.namespace;
      if (previous.runtime === undefined) delete process.env.TRIA_RUNTIME; else process.env.TRIA_RUNTIME = previous.runtime;
    }
    expect(receipt).toMatchObject({ id: "80000000-0000-4000-8000-000000000001", decisionCount: 1, decision: { decidedAt: "2026-01-01T00:00:00.123Z" }, changedLines: [{ category: "rejected" }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("write_source_reconciliation_decision");
    expect(calls[0].query).not.toMatch(/materialize_manifest|src_stable_record|src_effective_record|source_reconciliation_metrics/i);
    expect(JSON.stringify(calls[0].values).length).toBeLessThan(4_096);
  });
});
