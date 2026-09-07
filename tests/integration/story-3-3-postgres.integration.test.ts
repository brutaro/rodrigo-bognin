import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresImportPreparationRepository } from "../../src/modules/source-ledger/adapters/postgres-import-preparation-repository";
import { PostgresSourceReconciliationRepository } from "../../src/modules/source-ledger/adapters/postgres-reconciliation-repository";
import { InMemorySourceReconciliationRepository } from "../../src/modules/source-ledger/adapters/in-memory-reconciliation";
import { SourceReconciliationService } from "../../src/modules/source-ledger/application/reconcile-import";
import type { StableRecordContext } from "../../src/modules/source-ledger/application/reconciliation-repository";
import { buildImportContract, type ParserLimits } from "../../src/modules/source-ledger/domain/import-contract";
import type { Preview, PreviewConfirmation } from "../../src/modules/source-ledger/domain/dtos";
import { buildRecordMatch, createSourceObservation, reconcileConfirmedPreview, rootRequestHashFor, SERVER_OWNED_RECONCILIATION_POLICY_VERSION, type StableRecord } from "../../src/modules/source-ledger/domain/reconciliation";

const TEST_CURSOR_KEY = Buffer.alloc(32, 0x5a);

const enabled = process.env.TRIA_STORY33_POSTGRES === "confirmed";
const sourceSha256 = "a".repeat(64);
function hash64() { return `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`; }
const limits: ParserLimits = {
  version: "synthetic-safe-v1", maxSourceBytes: 1_000_000, maxExpandedBytes: 1_000_000,
  maxZipEntries: 10, maxCompressionRatio: 10, maxSheets: 2, maxRows: 100,
  maxColumns: 10, maxCellCharacters: 200, maxCsvRecordBytes: 10_000,
  maxXmlDepth: 10, maxXmlAttributes: 20, maxMilliseconds: 10_000,
};

function connect(username: string, password: string) {
  return postgres({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? "5432"), database: process.env.PGDATABASE ?? "tria",
    username, password, max: 3, prepare: false,
  });
}

describe.skipIf(!enabled)("Story 3.3 — jornada PostgreSQL real", () => {
  let admin: Sql;
  let appA: Sql;
  let appB: Sql;
  let importer: Sql;
  let preview: Preview;
  let confirmation: PreviewConfirmation;
  let reconciliationId: string;
  let recordId: string;
  let sparseHistoricalId: string;
  let sparseCurrentId: string;
  let largeHistoricalId: string;
  let largeCurrentId: string;
  let largeHeight: number;
  let largeRootNodeId: string;

  beforeAll(async () => {
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-adjustments-story33";
    delete process.env.TRIA_RUNTIME;
    admin = connect("tria_admin", process.env.TRIA_ADMIN_PASSWORD ?? "test-admin");
    appA = connect("tria_app", process.env.TRIA_APP_PASSWORD ?? "test-app");
    appB = connect("tria_app", process.env.TRIA_APP_PASSWORD ?? "test-app");
    importer = connect("tria_importer", process.env.TRIA_IMPORTER_PASSWORD ?? "test-importer");

    const sourceFileId = randomUUID();
    const documentId = randomUUID();
    const fileVersionId = randomUUID();
    const objectKey = randomUUID();
    const now = new Date().toISOString();
    await admin.begin(async (tx) => {
      await tx`INSERT INTO file_document (id, project_id, title, status, created_at, updated_at, include_in_publication, document_kind)
        VALUES (${documentId}, NULL, 'Base consolidada de aplicação de recursos', 'active', ${now}, ${now}, false, 'source')`;
      await tx`INSERT INTO file_version (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
        VALUES (${fileVersionId}, ${documentId}, 1, ${objectKey}, 'story-3-3.csv', 'text/csv', 10, ${sourceSha256}, 'active', ${now})`;
      await tx`INSERT INTO source_file (id, document_id, file_version_id, source_format, received_by, received_at)
        VALUES (${sourceFileId}, ${documentId}, ${fileVersionId}, 'csv', 'Rodrigo', ${now})`;
      await tx`INSERT INTO source_file_event (id, source_file_id, operation, byte_count, actor, occurred_at)
        VALUES (${randomUUID()}, ${sourceFileId}, 'source.file.received.v1', 10, 'Rodrigo', ${now})`;
    });
    await importer`INSERT INTO src_import_source_attestation
      (id, source_file_id, file_version_id, source_sha256, source_format, namespace, attestation_kind, attested_at)
      VALUES (${randomUUID()}, ${sourceFileId}, ${fileVersionId}, ${sourceSha256}, 'CSV', 'tria-adjustments-story33', 'synthetic-seed-v1', ${now})`;

    const contract = buildImportContract({
      schemaId: "synthetic-source-schema-v1", parserProfileId: "synthetic-safe-v1",
      transformationId: "remove-course-track-v1", limitsProfileId: "synthetic-safe-v1", sourceFormat: "CSV",
      csvParseOptions: { encoding: "utf-8", delimiter: ",", quote: '"', escape: "double-quote", allowMultilineQuotedField: false },
      schemaVersion: "synthetic-source-schema-v1", parserVersion: "synthetic-passive-tabular-v1",
      transformationVersion: "source-transformation-v1", limits, headerMapping: [],
    });
    const row = {
      locator: "row:2", sourceRowHash: "b".repeat(64),
      normalizedPayload: { codigo: "A-1", data: "2026-01-01", valor: "10.00" },
      sourceValues: { codigo: "A-1", data: "2026-01-01", valor: "10.00" },
      decimalSources: { valor: { source_text: "10.00", source_scale: 2, normalized_value: "10.00" } },
      // The base fixture intentionally carries no stable evidence. The
      // server-owned policy therefore derives an empty field set and the
      // first journey still exercises an explicit manual link.
      matchingAttributes: {},
      status: "valid" as const, fieldErrors: [],
    };
    const retainUntil = new Date(Date.parse(now) + 31 * 24 * 60 * 60 * 1000).toISOString();
    preview = {
      previewId: randomUUID(), batchId: randomUUID(), sourceFileId, fileVersionId,
      sourceSha256, sourceFormat: "CSV", contentHash: "c".repeat(64), rowResultHash: "d".repeat(64),
      retainUntil, registry: { schemaId: "synthetic-source-schema-v1", parserProfileId: "synthetic-safe-v1", transformationId: "remove-course-track-v1", limitsProfileId: "synthetic-safe-v1" },
      csvParseOptions: contract.csvParseOptions, schemaVersion: contract.schemaVersion, parserVersion: contract.parserVersion,
      transformationVersion: contract.transformationVersion, contractHash: contract.contractHash, transformationHash: contract.transformationHash,
      previewHash: "e".repeat(64), preparedAt: now, actor: "Rodrigo", status: "Validado", contract,
      summary: { found: 1, valid: 1, withError: 0, rejected: 0, inserted: "não avaliadas nesta etapa", updated: "não avaliadas nesta etapa", unchanged: "não avaliadas nesta etapa", conflicts: [], rowResultHash: "d".repeat(64) },
      rows: [row], headers: [],
    };
    preview = (await new PostgresImportPreparationRepository(appA).savePrepared({ preview, fingerprint: "f".repeat(64), idempotencyKey: `story33-prepare-${preview.previewId}`, requestId: randomUUID() })).preview;
    confirmation = {
      sourceFormat: "CSV", contentHash: preview.contentHash, rowResultHash: preview.rowResultHash,
      confirmationId: randomUUID(), previewId: preview.previewId, batchId: preview.batchId, sourceFileId, fileVersionId,
      sourceSha256, contractHash: preview.contractHash, transformationHash: preview.transformationHash, previewHash: preview.previewHash,
      confirmedAt: new Date(Date.parse(now) + 1000).toISOString(), actor: "Rodrigo", status: "confirmed", reused: false,
    };
    confirmation = (await new PostgresImportPreparationRepository(appA).saveConfirmation({ confirmation, payloadFingerprint: "1".repeat(64), idempotencyKey: `story33-confirm-${preview.previewId}`, requestId: randomUUID() })).confirmation;
    recordId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${recordId}, ${admin.json({ stable_key: "A-1" })}, ${now})`;
  });

  function policyFor(value: Preview) {
    const fields = [...new Set(value.rows.flatMap((row) => Object.keys(row.matchingAttributes ?? {})))].sort();
    return { version: SERVER_OWNED_RECONCILIATION_POLICY_VERSION, fields, evidence: "explicit-stable-attributes" as const };
  }

  async function freshFixture(options: { matchingAttributes?: Record<string, string>; normalizedPayload?: Record<string, string | null>; decimalSources?: Record<string, { source_text: string; source_scale: number; normalized_value: string | null }>; durationSources?: Record<string, { source_text: string; unit: "minutes" | "clock" }> } = {}) {
    const now = new Date().toISOString();
    const sourceRow = preview.rows[0];
    const normalizedPayload = options.normalizedPayload ?? structuredClone(sourceRow.normalizedPayload);
    const preparedRow = {
      ...structuredClone(sourceRow),
      sourceRowHash: hash64(),
      normalizedPayload,
      sourceValues: Object.fromEntries(Object.entries(normalizedPayload).map(([field, value]) => [field, value ?? ""])),
      matchingAttributes: structuredClone(options.matchingAttributes ?? {}),
      decimalSources: structuredClone(options.decimalSources ?? sourceRow.decimalSources ?? {}),
      ...(Object.hasOwn(options, "durationSources") ? { durationSources: structuredClone(options.durationSources ?? {}) }
        : sourceRow.durationSources !== undefined ? { durationSources: structuredClone(sourceRow.durationSources) } : {}),
    };
    const rowResultHash = hash64();
    const candidate: Preview = {
      ...structuredClone(preview),
      previewId: randomUUID(), batchId: randomUUID(),
      contentHash: hash64(), rowResultHash, previewHash: hash64(), preparedAt: now,
      rows: [preparedRow],
      summary: { ...preview.summary, found: 1, valid: 1, withError: 0, rejected: 0, rowResultHash },
    };
    const prepared = (await new PostgresImportPreparationRepository(appA).savePrepared({
      preview: candidate, fingerprint: hash64(), idempotencyKey: `story33-fresh-prepare-${candidate.previewId}`, requestId: randomUUID(),
    })).preview;
    const candidateConfirmation: PreviewConfirmation = {
      sourceFormat: prepared.sourceFormat, contentHash: prepared.contentHash, rowResultHash: prepared.rowResultHash,
      confirmationId: randomUUID(), previewId: prepared.previewId, batchId: prepared.batchId, sourceFileId: prepared.sourceFileId, fileVersionId: prepared.fileVersionId,
      sourceSha256: prepared.sourceSha256, contractHash: prepared.contractHash, transformationHash: prepared.transformationHash, previewHash: prepared.previewHash,
      confirmedAt: new Date(Date.parse(now) + 1000).toISOString(), actor: "Rodrigo", status: "confirmed", reused: false,
    };
    const confirmed = (await new PostgresImportPreparationRepository(appA).saveConfirmation({
      confirmation: candidateConfirmation, payloadFingerprint: hash64(), idempotencyKey: `story33-fresh-confirm-${prepared.previewId}`, requestId: randomUUID(),
    })).confirmation;
    return { preview: prepared, confirmation: confirmed };
  }

  afterAll(async () => {
    await Promise.all([admin?.end({ timeout: 2 }), appA?.end({ timeout: 2 }), appB?.end({ timeout: 2 }), importer?.end({ timeout: 2 })].map((promise) => promise.catch(() => undefined)));
  });

  it("mantém raiz histórica esparsa e leaf corrente vazia autenticadas", async () => {
    const fixture = await freshFixture({ matchingAttributes: {} });
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const root = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `sparse-root-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) });
    const line = root.reconciliation.lines[0];
    const child = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: root.reconciliation.id,
      decision: { observationId: line.observation.id, locator: line.observation.locator, stableRecordId: recordId, outcome: "link", policyVersion: root.reconciliation.policy.version, rationale: "Esvaziar a AVL corrente por vínculo explícito.", version: "1" } });
    sparseHistoricalId = root.reconciliation.id;
    sparseCurrentId = child.id;
    const [historical] = await appA<Array<{items:Array<{stableRecordId:string}>;total_count:string;has_more:boolean;logical_node_visits:number;authenticated_node_row_reads:number;tree_height:number}>>`
      SELECT * FROM source_reconciliation_absence_page(${sparseHistoricalId},NULL::uuid,1)`;
    expect(historical).toMatchObject({ total_count: "1", has_more: false, logical_node_visits: 2, authenticated_node_row_reads: 2, tree_height: 1 });
    expect(historical.items.map((item) => item.stableRecordId)).toEqual([recordId]);
    const [afterLast] = await appA<Array<{items:unknown[];logical_node_visits:number;authenticated_node_row_reads:number;tree_height:number}>>`
      SELECT * FROM source_reconciliation_absence_page(${sparseHistoricalId},${recordId}::uuid,1)`;
    expect(afterLast).toMatchObject({ items: [], logical_node_visits: 2, authenticated_node_row_reads: 2, tree_height: 1 });
    const [current] = await appA<Array<{items:unknown[];total_count:string;has_more:boolean;logical_node_visits:number;authenticated_node_row_reads:number;tree_height:number}>>`
      SELECT * FROM source_reconciliation_absence_page(${sparseCurrentId},NULL::uuid,1)`;
    expect(current).toMatchObject({ items: [], total_count: "0", has_more: false, logical_node_visits: 0, authenticated_node_row_reads: 0, tree_height: 0 });
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${sparseHistoricalId},${randomUUID()}::uuid,1)`).rejects.toMatchObject({ code: "XX001" });
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${sparseCurrentId},${recordId}::uuid,1)`).rejects.toMatchObject({ code: "XX001" });
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${randomUUID()}::uuid,NULL::uuid,1)`).rejects.toMatchObject({ code: "P0002" });
    await expect(repository.listAbsences(sparseCurrentId, { page: 0, pageSize: 1 })).resolves.toMatchObject({ total: "0", absences: [] });
  });

  it("recomputa no SQL a identidade completa e ordenada da raiz", async () => {
    const policy=policyFor(preview);
    const expected=rootRequestHashFor({confirmation,preview,policy});
    const [database]=await admin<Array<{hash:string}>>`SELECT source_reconciliation_root_request_hash(${confirmation.confirmationId},${admin.json(policy)})::text hash`;
    expect(database.hash).toBe(expected);
    expect(rootRequestHashFor({confirmation:{...confirmation,confirmedAt:'2099-01-01T00:00:00.000Z',reused:!confirmation.reused},preview:{...preview,preparedAt:'2099-01-02T00:00:00.000Z',retainUntil:'2100-01-01T00:00:00.000Z'},policy})).toBe(expected);
    expect(rootRequestHashFor({confirmation,preview:{...preview,rows:[{...preview.rows[0],sourceValues:{...preview.rows[0].sourceValues,valor:'10.000'}}]},policy})).not.toBe(expected);
  });

  it("soma decimais normalizados em escalas mistas e formata na maior escala", async () => {
    const [row] = await admin<Array<{ metrics: { decimalSums: Record<string, string>; durationSums: Record<string, string> } }>>`
      SELECT source_reconciliation_metrics(${admin.json([
        { category: "inserted", stableRecordId: randomUUID(), observation: { decimalSources: { valor: { source_text: "10.50", source_scale: 2, normalized_value: "10.50" } } } },
        { category: "inserted", stableRecordId: randomUUID(), observation: { decimalSources: { valor: { source_text: "2.5", source_scale: 1, normalized_value: "2.5" } } } },
      ])}) AS metrics`;
    expect(row.metrics).toEqual({ decimalSums: { valor: "13.00" }, durationSums: {} });
  });

  it("preserva durationSources ausente separado de mapa vazio na preparação PostgreSQL", async () => {
    expect(preview.rows[0]).not.toHaveProperty("durationSources");
    const [absent] = await admin<Array<{ duration_sources: unknown }>>`
      SELECT duration_sources FROM src_import_staging_row WHERE batch_id = ${preview.batchId} AND locator = ${preview.rows[0].locator}`;
    expect(absent.duration_sources).toBeNull();

    const explicitEmpty = await freshFixture({ durationSources: {} });
    expect(explicitEmpty.preview.rows[0]).toHaveProperty("durationSources", {});
    const [empty] = await admin<Array<{ duration_sources: unknown }>>`
      SELECT duration_sources FROM src_import_staging_row WHERE batch_id = ${explicitEmpty.preview.batchId} AND locator = ${explicitEmpty.preview.rows[0].locator}`;
    expect(empty.duration_sources).toEqual({});
  });

  async function tableCounts() {
    const [row] = await admin<Array<Record<string, number>>>`SELECT
      (SELECT count(*)::int FROM src_stable_record) AS stable_records,
      (SELECT count(*)::int FROM src_source_observation) AS observations,
      (SELECT count(*)::int FROM src_record_match) AS matches,
      (SELECT count(*)::int FROM src_reconciliation) AS reconciliations,
      (SELECT count(*)::int FROM src_import_conflict) AS conflicts,
      (SELECT count(*)::int FROM src_reconciliation_decision) AS decisions,
      (SELECT count(*)::int FROM src_effective_record_event) AS events,
      (SELECT count(*)::int FROM src_effective_record_projection) AS projections,
      (SELECT version::int FROM src_projection_version WHERE singleton) AS projection_version,
      (SELECT count(*)::int FROM src_reconciliation_application) AS applications,
      (SELECT count(*)::int FROM src_effective_snapshot) AS snapshots,
      (SELECT count(*)::int FROM src_reconciliation_request) AS requests`;
    return row;
  }

  async function injectFailure(table: string, operation: "INSERT" | "UPDATE") {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `story33_fail_${suffix}`;
    const triggerName = `story33_trigger_${suffix}`;
    await admin.unsafe(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'story-3-3 injected rollback'; END; $$`);
    await admin.unsafe(`CREATE TRIGGER ${triggerName} BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    return async () => {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    };
  }

  async function duplicateFixture(secondWithoutCandidate = false) {
    const sourceFileId = randomUUID();
    const documentId = randomUUID();
    const fileVersionId = randomUUID();
    const objectKey = randomUUID();
    const now = new Date().toISOString();
    const hash = () => `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
    const duplicateKey = `rf88-${randomUUID()}`;
    await admin.begin(async (tx) => {
      await tx`INSERT INTO file_document (id, project_id, title, status, created_at, updated_at, include_in_publication, document_kind)
        VALUES (${documentId}, NULL, 'Base consolidada de aplicação de recursos', 'active', ${now}, ${now}, false, 'source')`;
      await tx`INSERT INTO file_version (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
        VALUES (${fileVersionId}, ${documentId}, 1, ${objectKey}, 'story-3-3-rf88.csv', 'text/csv', 10, ${sourceSha256}, 'active', ${now})`;
      await tx`INSERT INTO source_file (id, document_id, file_version_id, source_format, received_by, received_at)
        VALUES (${sourceFileId}, ${documentId}, ${fileVersionId}, 'csv', 'Rodrigo', ${now})`;
      await tx`INSERT INTO source_file_event (id, source_file_id, operation, byte_count, actor, occurred_at)
        VALUES (${randomUUID()}, ${sourceFileId}, 'source.file.received.v1', 10, 'Rodrigo', ${now})`;
    });
    await importer`INSERT INTO src_import_source_attestation
      (id, source_file_id, file_version_id, source_sha256, source_format, namespace, attestation_kind, attested_at)
      VALUES (${randomUUID()}, ${sourceFileId}, ${fileVersionId}, ${sourceSha256}, 'CSV', 'tria-adjustments-story33', 'synthetic-seed-v1', ${now})`;
    const duplicateRow = (locator: string, value: string) => ({
      locator, sourceRowHash: hash(), normalizedPayload: { codigo: locator.replace(":", "-").toUpperCase(), data: "2026-01-01", valor: value },
      sourceValues: { codigo: locator.replace(":", "-").toUpperCase(), data: "2026-01-01", valor: value },
      decimalSources: { valor: { source_text: value, source_scale: 2, normalized_value: value } },
      matchingAttributes: (secondWithoutCandidate && locator === "rf88:2" ? {} : { stable_key: duplicateKey }) as Record<string, string>, status: "valid" as const, fieldErrors: [],
    });
    const duplicateRowResultHash = hash();
    const duplicatePreview: Preview = {
      ...preview, previewId: randomUUID(), batchId: randomUUID(), sourceFileId, fileVersionId,
      contentHash: hash(), rowResultHash: duplicateRowResultHash, previewHash: hash(), preparedAt: now,
      rows: [duplicateRow("rf88:1", "2.00"), duplicateRow("rf88:2", "3.00")],
      summary: { ...preview.summary, found: 2, valid: 2, withError: 0, rejected: 0, rowResultHash: duplicateRowResultHash },
    };
    const prepared = (await new PostgresImportPreparationRepository(appA).savePrepared({ preview: duplicatePreview, fingerprint: hash(), idempotencyKey: `story33-rf88-prepare-${duplicatePreview.previewId}`, requestId: randomUUID() })).preview;
    const duplicateConfirmation: PreviewConfirmation = {
      sourceFormat: "CSV", contentHash: prepared.contentHash, rowResultHash: prepared.rowResultHash,
      confirmationId: randomUUID(), previewId: prepared.previewId, batchId: prepared.batchId, sourceFileId, fileVersionId,
      sourceSha256, contractHash: prepared.contractHash, transformationHash: prepared.transformationHash, previewHash: prepared.previewHash,
      confirmedAt: new Date(Date.parse(now) + 1000).toISOString(), actor: "Rodrigo", status: "confirmed", reused: false,
    };
    const confirmed = (await new PostgresImportPreparationRepository(appA).saveConfirmation({ confirmation: duplicateConfirmation, payloadFingerprint: hash(), idempotencyKey: `story33-rf88-confirm-${prepared.previewId}`, requestId: randomUUID() })).confirmation;
    const targetId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${targetId}, ${admin.json({ stable_key: duplicateKey })}, ${now})`;
    return { preview: prepared, confirmation: confirmed, targetId };
  }

  it("persiste conflito, decisão explícita e converge em duas aplicações concorrentes", async () => {
    const serviceA = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const policy = policyFor(preview);
    const result = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-reconcile-${preview.previewId}`, confirmation, preview, policy });
    reconciliationId = result.reconciliation.id;
    expect(result.reconciliation.summary.conflict).toBe(1);
    expect(result.reconciliation.summary.absent).toBe(1);
    expect(result.reconciliation.status).toBe("needs-decision");
    await expect(serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, decision: {
      observationId: result.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: randomUUID(),
      policyVersion: policy.version, rationale: "Alvo inexistente deve ser recusado pelo servidor.", version: "1",
    } })).rejects.toMatchObject({ code: "DECISION_INVALID" });
    await expect(serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, decision: {
      observationId: result.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: recordId,
      policyVersion: "caller-controlled-policy", rationale: "Uma versão arbitrária não pode ser aceita silenciosamente.", version: "1",
    } })).rejects.toMatchObject({ code: "DECISION_INVALID" });
    const [avlBefore]=await admin<Array<{height:number;nodes:string}>>`SELECT n.height,(SELECT count(*)::text FROM src_reconciliation_absence_node x WHERE x.lineage_id=r.id) nodes FROM src_reconciliation r LEFT JOIN src_reconciliation_absence_node n ON n.id=r.absence_root_id WHERE r.id=${reconciliationId}`;
    const decided = await serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, decision: {
      observationId: result.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: recordId,
      policyVersion: policy.version, rationale: "A chave estável comprovada coincide com o registro vigente.", version: "1",
    } });
    expect(decided.status).toBe("ready-to-apply");    const [avlAfter]=await admin<Array<{nodes:string}>>`SELECT count(*)::text nodes FROM src_reconciliation_absence_node WHERE lineage_id=${reconciliationId}`;
    expect(BigInt(avlAfter.nodes)-BigInt(avlBefore.nodes)).toBeLessThanOrEqual(BigInt(3*avlBefore.height+1));
    expect(await admin`SELECT source_reconciliation_verify_absence_anchor(${decided.id})`).toHaveLength(1);
    await expect(serviceA.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, idempotencyKey: `story33-stale-apply-${reconciliationId}` })).rejects.toMatchObject({ code: "REVISION_CONFLICT", leafReconciliationId: decided.id });
    expect(decided.metrics).toEqual({ decimalSums: { valor: "10.00" }, durationSums: {} });
    reconciliationId = decided.id;
    const [left, right] = await Promise.all([
      serviceA.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, idempotencyKey: `story33-apply-${reconciliationId}` }),
      serviceB.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, idempotencyKey: `story33-apply-${reconciliationId}` }),
    ]);
    expect([left.reused, right.reused].sort()).toEqual([false, true]);
    expect(left.projectionVersion).toBe("1");
    expect(right.projectionVersion).toBe("1");
    expect(left).not.toHaveProperty("events"); expect(right).not.toHaveProperty("events");
    expect(left).not.toHaveProperty("projections"); expect(left).not.toHaveProperty("snapshot"); expect(left).not.toHaveProperty("audit");
    const internalApplied = await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId, idempotencyKey: `story33-apply-${reconciliationId}` });
    expect(internalApplied.events.length).toBe(2);
    expect(internalApplied.snapshot).toMatchObject({ reconciliationId, batchId: confirmation.batchId, projectionVersion: "1", projection: internalApplied.projections });
    expect(internalApplied.snapshot.projection.find((item) => item.recordId === recordId)?.version).toBe(internalApplied.snapshot.projectionVersion);
    expect(internalApplied.audit).toMatchObject({ actor: "Rodrigo", confirmationId: confirmation.confirmationId, policyVersion: policy.version, metrics: { decimalSums: { valor: "10.00" }, durationSums: {} } });
    const [persistedAudit] = await admin<Array<{ audit_payload: Record<string, unknown>; projection_version: string }>>`SELECT audit_payload, projection_version::text FROM src_reconciliation_application WHERE reconciliation_id = ${reconciliationId}`;
    expect(persistedAudit).toMatchObject({ projection_version: "1", audit_payload: { actor: "Rodrigo", confirmationId: confirmation.confirmationId, batchId: confirmation.batchId, previewId: confirmation.previewId, sourceSha256: confirmation.sourceSha256, contractHash: confirmation.contractHash, transformationHash: confirmation.transformationHash, previewHash: confirmation.previewHash, policyVersion: policy.version, decisions: internalApplied.audit.decisions, decisionsHash: expect.any(String), counts: internalApplied.audit.counts, metrics: internalApplied.audit.metrics } });
    const [appliedLeafHash] = await admin<Array<{ decisions_hash: string }>>`SELECT decisions_hash FROM src_reconciliation WHERE id=${reconciliationId}`;
    expect(persistedAudit.audit_payload.decisionsHash).toBe(appliedLeafHash.decisions_hash);
    expect(await admin`SELECT count(*)::int AS count FROM src_effective_record_event WHERE reconciliation_id=${reconciliationId}`).toEqual([{ count: 2 }]);
    expect(await admin`SELECT version::text AS version FROM src_projection_version WHERE singleton`).toEqual([{ version: "1" }]);

    const [snapshotBefore] = await admin`SELECT id::text, reconciliation_id::text, batch_id::text, projection_version::text, projection::text, created_at::text
      FROM src_effective_snapshot WHERE reconciliation_id = ${reconciliationId}`;
    // A confirmation is immutable and may only be applied once. Use a fresh
    // confirmed preview for the later batch instead of changing its policy to
    // manufacture a second graph for the same confirmation.
    const laterFixture = await freshFixture({ matchingAttributes: { stable_key: "later-link" } });
    const laterPolicy = policyFor(laterFixture.preview);
    const later = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-later-${laterFixture.preview.previewId}`, confirmation: laterFixture.confirmation, preview: laterFixture.preview, policy: laterPolicy });
    const laterDecided = await serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: later.reconciliation.id, decision: {
      observationId: later.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: recordId,
      policyVersion: laterPolicy.version, rationale: "Rodrigo confirmou o vínculo explícito para a observação recorrente.", version: "1",
    } });
    const laterApplied = await serviceA.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: laterDecided.id, idempotencyKey: `story33-later-apply-${laterDecided.id}` });
    expect(laterApplied.projectionVersion).toBe("2");
    const [snapshotAfter] = await admin`SELECT id::text, reconciliation_id::text, batch_id::text, projection_version::text, projection::text, created_at::text
      FROM src_effective_snapshot WHERE reconciliation_id = ${reconciliationId}`;
    expect(snapshotAfter).toEqual(snapshotBefore);
    const adjustmentEventId = randomUUID();
    const decisionEventId = randomUUID();
    const fixtureDecision = laterDecided.decision;
    if (!fixtureDecision) throw new Error("A decisão de fixture não foi persistida.");
    const fixtureDecimalSources={valor:{source_text:"10.00",source_scale:2,normalized_value:"10.00"}};
    await admin.begin(async (tx) => {
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, event_type, layer, payload, decimal_sources, actor, occurred_at, version)
        VALUES (${adjustmentEventId}, ${laterDecided.id}, ${recordId}, 'adjustment.revised', 'adjustment', ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "20.00" })}, ${tx.json(fixtureDecimalSources)}, 'Rodrigo', now(), 'adjustment-1')`;
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, event_type, layer, payload, decimal_sources, actor, occurred_at, version, decision_id, decision_rationale, decision_version, decision_decided_at)
        VALUES (${decisionEventId}, ${laterDecided.id}, ${recordId}, 'decision.audit', 'decision', ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "30.00" })}, ${tx.json(fixtureDecimalSources)}, 'Rodrigo', now(), 'decision-1', ${fixtureDecision.id}, ${fixtureDecision.rationale}, ${fixtureDecision.version}, ${fixtureDecision.decidedAt})`;
      await tx`UPDATE src_effective_record_projection SET payload = ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "30.00" })}, adjustment_event_id = ${adjustmentEventId}, decision_event_id = ${decisionEventId}, version = 2, updated_at = now() WHERE record_id = ${recordId}`;
    });

    const protectedFixture = await freshFixture({ matchingAttributes: { stable_key: "A-1" } });
    const protectedPreview = protectedFixture.preview;
    const protectedConfirmation = protectedFixture.confirmation;
    const beforeProtected = (await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).listStableRecords()).find((record) => record.id === recordId);
    expect(beforeProtected?.auditedDecisionPayload).toMatchObject({ valor: "30.00" });
    const protectedPolicy = policyFor(protectedPreview);
    const protectedPending = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-protected-${protectedPreview.previewId}`, confirmation: protectedConfirmation, preview: protectedPreview, policy: protectedPolicy });
    expect(protectedPending.reconciliation.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "PROTECTED_LAYER", currentLayer: "decision" } });
    const protectedLine = protectedPending.reconciliation.lines[0];
    const protectedDecided = await serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: protectedPending.reconciliation.id, decision: {
      observationId: protectedLine.observation.id, locator: protectedLine.observation.locator, outcome: "link", stableRecordId: recordId,
      policyVersion: protectedPolicy.version, rationale: "Rodrigo autorizou a substituição auditada da camada protegida.", version: "1",
    } });
    const protectedApplied = await serviceA.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: protectedDecided.id, idempotencyKey: `story33-protected-apply-${protectedDecided.id}` });
    expect(protectedApplied).not.toHaveProperty("events");
    const protectedInternal = await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: protectedDecided.id, idempotencyKey: `story33-protected-apply-${protectedDecided.id}` });
    expect(protectedInternal.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "observation.accepted", layer: "source", payload: { codigo: "A-1", data: "2026-01-01", valor: "10.00" } }),
      expect.objectContaining({ type: "decision.audit", layer: "decision", payload: { codigo: "A-1", data: "2026-01-01", valor: "10.00" } }),
    ]));
    const protectedDecisionEvent = protectedInternal.events.find((event) => event.type === "decision.audit");
    expect(protectedDecisionEvent).toBeDefined();
    const [protectedProjection] = await admin<Array<{ payload: unknown; decimal_sources: unknown; duration_sources: unknown; source_observation_id: string; adjustment_event_id: string; decision_event_id: string }>>`SELECT payload, decimal_sources, duration_sources, source_observation_id::text, adjustment_event_id::text, decision_event_id::text
      FROM src_effective_record_projection WHERE record_id = ${recordId}`;
    expect(protectedProjection).toMatchObject({ payload: { codigo: "A-1", data: "2026-01-01", valor: "10.00" }, decimal_sources: { valor: { source_text: "10.00", source_scale: 2, normalized_value: "10.00" } }, duration_sources: {}, source_observation_id: protectedLine.observation.id, adjustment_event_id: adjustmentEventId, decision_event_id: protectedDecisionEvent?.id });
    const protectedHydrated = (await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).listStableRecords()).find((record) => record.id === recordId);
    expect(protectedHydrated).toMatchObject({ sourcePayload: { valor: "10.00" }, adjustmentPayload: { valor: "20.00" }, auditedDecisionPayload: { valor: "10.00" }, adjustmentEventId, decisionEventId: protectedDecisionEvent?.id });

    const reimportPreview = { ...protectedPreview, rows: [{ ...protectedPreview.rows[0], normalizedPayload: { codigo: "A-1", data: "2026-01-01", valor: "11.00" }, sourceValues: { codigo: "A-1", data: "2026-01-01", valor: "11.00" } }] };
    const reopened = { reconciliation: reconcileConfirmedPreview({ confirmation: protectedConfirmation, preview: reimportPreview, records: await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).listStableRecords(), policy: protectedPolicy, baseProjectionVersion: await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).currentProjectionVersion() }) };
    expect(reopened.reconciliation.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "PROTECTED_LAYER", currentLayer: "decision" } });
    const [projectionAfterReimport] = await admin<Array<{ payload: unknown; decision_event_id: string }>>`SELECT payload, decision_event_id::text FROM src_effective_record_projection WHERE record_id = ${recordId}`;
    expect(projectionAfterReimport).toEqual({ payload: { codigo: "A-1", data: "2026-01-01", valor: "10.00" }, decision_event_id: protectedDecisionEvent?.id });
  });

  it("reusa o binding exato criado em V+1 quando A entra no save após B", async () => {
    const fixture=await freshFixture({matchingAttributes:{case_key:`race-${randomUUID()}`}});
    const key=`reconcile-race-${randomUUID()}`;
    const repositoryA=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const repositoryB=new PostgresSourceReconciliationRepository(appB,TEST_CURSOR_KEY);
    let enterSave!:()=>void;
    let releaseSave!:()=>void;
    const saveEntered=new Promise<void>((resolve)=>{enterSave=resolve;});
    const saveReleased=new Promise<void>((resolve)=>{releaseSave=resolve;});
    let paused=false;
    const delayedRepository=new Proxy(repositoryA,{
      get(target,property){
        if(property==='saveReconciliation')return async(value:Parameters<typeof target.saveReconciliation>[0])=>{
          if(!paused){paused=true;enterSave();await saveReleased;}
          return target.saveReconciliation(value);
        };
        const member=Reflect.get(target,property);
        return typeof member==='function'?member.bind(target):member;
      },
    });
    const serviceA=new SourceReconciliationService(delayedRepository);
    const serviceB=new SourceReconciliationService(repositoryB);
    const command={actor:'Rodrigo' as const,idempotencyKey:key,confirmation:fixture.confirmation,preview:fixture.preview,policy:policyFor(fixture.preview)};
    const aPromise=serviceA.reconcileConfirmedPreview({...command,requestId:randomUUID()});
    try{
      await saveEntered;
      const [before]=await admin<Array<{version:string}>>`SELECT version::text FROM src_projection_version WHERE singleton`;
      await admin`UPDATE src_projection_version SET version=version+1 WHERE singleton`;
      const [after]=await admin<Array<{version:string}>>`SELECT version::text FROM src_projection_version WHERE singleton`;
      expect(BigInt(after.version)).toBe(BigInt(before.version)+1n);
      const b=await serviceB.reconcileConfirmedPreview({...command,requestId:randomUUID()});
      releaseSave();
      const a=await aPromise;
      expect(b.reused).toBe(false);
      expect(a.reused).toBe(true);
      expect(a.reconciliation.id).toBe(b.reconciliation.id);
      const [binding]=await admin<Array<{request_count:number;root_count:number;head_count:number;root_id:string;leaf_id:string}>>`SELECT
        (SELECT count(*)::int FROM src_reconciliation_request WHERE operation='reconcile' AND idempotency_key=${key}) request_count,
        (SELECT count(*)::int FROM src_reconciliation WHERE idempotency_key=${key}) root_count,
        (SELECT count(*)::int FROM src_reconciliation_head head WHERE head.lineage_id=request.root_reconciliation_id) head_count,
        request.root_reconciliation_id::text root_id,head.leaf_reconciliation_id::text leaf_id
        FROM src_reconciliation_request request
        JOIN src_reconciliation_head head ON head.lineage_id=request.root_reconciliation_id
        WHERE request.operation='reconcile' AND request.idempotency_key=${key}`;
      expect(binding).toEqual({request_count:1,root_count:1,head_count:1,root_id:b.reconciliation.id,leaf_id:b.reconciliation.id});

      const different=await freshFixture({matchingAttributes:{case_key:`different-${randomUUID()}`}});
      await expect(serviceB.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:key,confirmation:different.confirmation,preview:different.preview,policy:policyFor(different.preview)}))
        .rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    }finally{
      releaseSave();
      await aPromise.catch(()=>undefined);
    }
  });

  it("reidrata camadas, preserva precedência e prova matching e decimais no PostgreSQL", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const records = await repository.listStableRecords();
    const hydrated = records.find((record) => record.id === recordId);
    expect(hydrated).toMatchObject({ id: recordId, state: "active", matchingAttributes: { stable_key: "A-1" }, sourceObservationId: expect.any(String) });
    expect(hydrated?.sourcePayload).toMatchObject({ valor: "10.00" });
    expect(hydrated?.adjustmentPayload).toMatchObject({ valor: "20.00" });
    expect(hydrated?.auditedDecisionPayload).toMatchObject({ valor: "10.00" });
    expect(hydrated?.adjustmentEventId).toEqual(expect.any(String));
    expect(hydrated?.decisionEventId).toEqual(expect.any(String));

    const observation = createSourceObservation({ batchId: preview.batchId, previewId: preview.previewId, sourceFileId: preview.sourceFileId, locator: "proof:stable", sourceRowHash: "1".repeat(64), normalizedPayload: { stable_key: "A-1", valor: "10.00" }, sourceValues: { stable_key: "A-1", valor: "10.00" }, decimalSources: { valor: { source_text: "10.00", source_scale: 2, normalized_value: "10.00" } }, matchingAttributes: { stable_key: "A-1" }, observedAt: new Date().toISOString() });
    const policy = { version: SERVER_OWNED_RECONCILIATION_POLICY_VERSION, fields: ["stable_key"], evidence: "explicit-stable-attributes" as const };
    expect(buildRecordMatch(observation, records, policy)).toMatchObject({ outcome: "unique", matchedRecordId: recordId });
    expect(buildRecordMatch({ ...observation, normalizedPayload: { valor: "10.00" }, matchingAttributes: undefined }, records, policy).outcome).toBe("none");
    for (const field of ["codigo", "data", "valor"]) expect(() => buildRecordMatch(observation, records, { ...policy, fields: [field] })).toThrow();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${randomUUID()}, ${admin.json({ stable_key: "ambiguous" })}, now()), (${randomUUID()}, ${admin.json({ stable_key: "ambiguous" })}, now())`;
    const ambiguousRecords = await repository.listStableRecords();
    expect(buildRecordMatch({ ...observation, normalizedPayload: { stable_key: "ambiguous", valor: "10.00" }, matchingAttributes: { stable_key: "ambiguous" } }, ambiguousRecords, policy).outcome).toBe("multiple");

    const effectiveStateRecordId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, state, matching_attributes, created_at) VALUES (${effectiveStateRecordId}, 'active', ${admin.json({ stable_key: "effective-state" })}, now())`;
    await admin.begin(async (tx) => {
      await tx`INSERT INTO src_effective_record_projection
        (record_id, payload, state, version, updated_at)
        VALUES (${effectiveStateRecordId}, ${tx.json({ stable_key: "effective-state", valor: "0.00" })}, 'disregarded', 99, now())`;
    });
    expect((await repository.listStableRecords()).find((record) => record.id === effectiveStateRecordId)).toMatchObject({ state: "disregarded", matchingAttributes: { stable_key: "effective-state" } });

    const sourceObservation = await admin<Array<{ source_values: unknown; decimal_sources: unknown }>>`SELECT source_values, decimal_sources FROM src_source_observation ORDER BY observed_at, id LIMIT 1`;
    expect(sourceObservation[0].source_values).toMatchObject({ valor: "10.00" });
    expect(sourceObservation[0].decimal_sources).toMatchObject({ valor: { source_text: "10.00", source_scale: 2, normalized_value: "10.00" } });

    const precedence = reconcileConfirmedPreview({ confirmation, preview: { ...preview, rows: [{ ...preview.rows[0], normalizedPayload: { stable_key: "A-1", valor: "40.00" }, sourceValues: { stable_key: "A-1", valor: "40.00" }, matchingAttributes: { stable_key: "A-1" } }] }, policy, records, baseProjectionVersion: await repository.currentProjectionVersion() });
    expect(precedence.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "PROTECTED_LAYER", currentLayer: "decision" } });
    expect(precedence.lines[0].fieldDiffs).toEqual(expect.arrayContaining([expect.objectContaining({ field: "valor", original: "10.00", proposed: "40.00", layer: "decision" })]));
  });

  it("usa o evento source exato mais recente e ignora histórico quando o ponteiro source é NULL", async () => {
    const repository=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const pointedRecordId=randomUUID();
    const nullPointerRecordId=randomUUID();
    const [observation]=await admin<Array<{id:string}>>`SELECT observation.id::text
      FROM src_source_observation observation
      JOIN src_reconciliation sparse ON sparse.id=${sparseHistoricalId} AND sparse.batch_id=observation.batch_id
      ORDER BY observation.observed_at,observation.id LIMIT 1`;
    if(!observation)throw new Error('Observação de prova de precedência source ausente.');
    const olderEventId='10000000-0000-4000-8000-000000000090';
    const latestEventId='f0000000-0000-4000-8000-000000000091';
    const historicalEventId='e0000000-0000-4000-8000-000000000092';
    const occurredAt='2026-01-02T00:00:00.000Z';
    const decimal=(field:string,value:string)=>({[field]:{source_text:value,source_scale:2,normalized_value:value}});
    let seeded=false;
    try{
      await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES
        (${pointedRecordId},${admin.json({stable_key:`source-pointer-${pointedRecordId}`})},now()),
        (${nullPointerRecordId},${admin.json({stable_key:`null-pointer-${nullPointerRecordId}`})},now())`;
      seeded=true;
      await admin`INSERT INTO src_effective_record_event
        (id,reconciliation_id,record_id,observation_id,event_type,layer,payload,decimal_sources,duration_sources,actor,occurred_at,version) VALUES
        (${olderEventId},${sparseHistoricalId},${pointedRecordId},${observation.id},'observation.accepted','source',${admin.json({valor:'old'})},${admin.json(decimal('historical_pointer_marker','1.00'))},NULL,'Rodrigo',${occurredAt},'source-old'),
        (${latestEventId},${sparseCurrentId},${pointedRecordId},${observation.id},'observation.accepted','source',${admin.json({valor:'latest'})},NULL,${admin.json({})},'Rodrigo',${occurredAt},'source-latest'),
        (${historicalEventId},${reconciliationId},${nullPointerRecordId},${observation.id},'observation.accepted','source',${admin.json({valor:'historical'})},${admin.json(decimal('historical_marker','3.00'))},NULL,'Rodrigo',${occurredAt},'source-historical')`;
      await admin`INSERT INTO src_effective_record_projection
        (record_id,payload,decimal_sources,source_observation_id,state,version,updated_at) VALUES
        (${pointedRecordId},${admin.json({valor:'projection-stale'})},${admin.json(decimal('stale_projection_marker','9.00'))},${observation.id},'active',0,now()),
        (${nullPointerRecordId},${admin.json({valor:'projection-current'})},${admin.json(decimal('projection_marker','4.00'))},NULL,'active',0,now())`;

      const hydrated=await repository.listStableRecords();
      const pointed=hydrated.find((record)=>record.id===pointedRecordId);
      expect(pointed).toMatchObject({sourcePayload:{valor:'latest'},durationSources:{}});
      expect(pointed).not.toHaveProperty('decimalSources');
      const nullPointer=hydrated.find((record)=>record.id===nullPointerRecordId);
      expect(nullPointer).toMatchObject({effectivePayload:{valor:'projection-current'},decimalSources:decimal('projection_marker','4.00')});
      expect(nullPointer).not.toHaveProperty('sourcePayload');
      const [resolved]=await admin<Array<{effective_payload:unknown;decimal_sources:unknown;duration_sources:unknown;effective_layer:string}>>`
        SELECT effective_payload,decimal_sources,duration_sources,effective_layer FROM source_reconciliation_effective_record(${pointedRecordId}::uuid)`;
      expect(resolved).toEqual({effective_payload:{valor:'latest'},decimal_sources:null,duration_sources:{},effective_layer:'source'});
      const sourceSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:'latest',page:0,pageSize:50});
      expect(sourceSearch.records).toEqual(expect.arrayContaining([expect.objectContaining({
        id:pointedRecordId,effectiveLayer:'source',effectivePayload:{valor:'latest'},durationSources:{},
      })]));
      expect(sourceSearch.records.find((record)=>record.id===pointedRecordId)).not.toHaveProperty('decimalSources');
      const staleSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:'projection-stale',page:0,pageSize:50});
      expect(staleSearch.records.map((record)=>record.id)).not.toContain(pointedRecordId);
      const [metricRow]=await admin<Array<{metrics:{decimalSums:Record<string,string>};accumulator:unknown}>>`
        SELECT source_reconciliation_metrics('[]'::jsonb) metrics,source_reconciliation_metric_accumulator('[]'::jsonb) accumulator`;
      expect(metricRow.metrics.decimalSums).toMatchObject({projection_marker:'4.00'});
      expect(JSON.stringify(metricRow.accumulator)).not.toContain('stale_projection_marker');
      for(const excluded of ['historical_pointer_marker','stale_projection_marker','historical_marker'])
        expect(metricRow.metrics.decimalSums).not.toHaveProperty(excluded);
    }finally{
      if(seeded){
        await admin`DELETE FROM src_effective_record_projection WHERE record_id IN (${pointedRecordId},${nullPointerRecordId})`;
        await admin`ALTER TABLE src_effective_record_event DISABLE TRIGGER src_effective_record_event_immutable`;
        try{await admin`DELETE FROM src_effective_record_event WHERE record_id IN (${pointedRecordId},${nullPointerRecordId})`;}
        finally{await admin`ALTER TABLE src_effective_record_event ENABLE TRIGGER src_effective_record_event_immutable`;}
        await admin`ALTER TABLE src_stable_record DISABLE TRIGGER src_stable_record_immutable`;
        try{await admin`DELETE FROM src_stable_record WHERE id IN (${pointedRecordId},${nullPointerRecordId})`;}
        finally{await admin`ALTER TABLE src_stable_record ENABLE TRIGGER src_stable_record_immutable`;}
      }
    }
  });

  it("mantém registro estável sem projeção na camada source em resolver, diffs e decisão link", async () => {
    const unprojectedId=randomUUID();
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at)
      VALUES(${unprojectedId},${admin.json({stable_key:`unprojected-${unprojectedId}`})},now())`;
    expect(await admin`SELECT stable_exists,projection_exists,effective_payload,decimal_sources,duration_sources,effective_layer,projection_version
      FROM source_reconciliation_effective_record(${unprojectedId}::uuid)`).toEqual([{
      stable_exists:true,projection_exists:false,effective_payload:{},decimal_sources:null,duration_sources:null,effective_layer:'source',projection_version:null,
    }]);
    const unprojectedSearch=await new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY).searchStableRecords({
      reconciliationId:sparseCurrentId,query:`unprojected-${unprojectedId}`,page:0,pageSize:5,
    });
    expect(unprojectedSearch.records).toEqual([{id:unprojectedId,matchingAttributes:{stable_key:`unprojected-${unprojectedId}`},effectiveLayer:'source',effectivePayload:{}}]);
    const diffObservation={normalizedPayload:{valor:'5.00'},decimalSources:{},durationSources:{}};
    const [diffRow]=await admin<Array<{diffs:Array<{layer:string;originalPresent:boolean}>}>>`
      SELECT source_reconciliation_field_diffs(${admin.json(diffObservation)},${unprojectedId}::uuid,'Paridade sem projeção.') diffs`;
    expect(diffRow.diffs.length).toBeGreaterThan(0);
    expect(diffRow.diffs.every((item)=>item.layer==='source')).toBe(true);
    expect(diffRow.diffs).toEqual(expect.arrayContaining([expect.objectContaining({originalPresent:false})]));

    const fixture=await freshFixture({matchingAttributes:{stable_key:`incoming-${randomUUID()}`},normalizedPayload:{valor:'5.00'},decimalSources:{},durationSources:{}});
    const policy=policyFor(fixture.preview);
    const service=new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY));
    const pending=await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`unprojected-${randomUUID()}`,confirmation:fixture.confirmation,preview:fixture.preview,policy});
    const line=pending.reconciliation.lines[0];
    const linked=await service.recordDecision({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:pending.reconciliation.id,decision:{observationId:line.observation.id,locator:line.observation.locator,outcome:'link',stableRecordId:unprojectedId,policyVersion:policy.version,rationale:'Vincular ao registro estável ainda sem projeção.',version:'1'}});
    expect(linked.changedLines[0]).toMatchObject({category:'updated',stableRecordId:unprojectedId,decision:{outcome:'link',stableRecordId:unprojectedId}});
    expect(linked.changedLines[0].fieldDiffs.every((item)=>item.layer==='source')).toBe(true);
  });

  it("rejeita fingerprint divergente para a mesma chave e mantém um único grafo", async () => {
    const key = `story33-idempotency-divergent-${randomUUID()}`;
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const before = await tableCounts();
    const firstFixture = await freshFixture();
    const firstPolicy = policyFor(firstFixture.preview);
    const first = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: key, confirmation: firstFixture.confirmation, preview: firstFixture.preview, policy: firstPolicy });
    const divergentFixture = await freshFixture({ normalizedPayload: { codigo: "A-1", data: "2026-01-01", valor: "11.00" } });
    await expect(service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: key, confirmation: divergentFixture.confirmation, preview: divergentFixture.preview, policy: policyFor(divergentFixture.preview) })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const after = await tableCounts();
    expect(after.reconciliations).toBe(before.reconciliations + 1);
    expect(after.observations).toBe(before.observations + firstFixture.preview.rows.length);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE id=${first.reconciliation.id}`).toEqual([{ count: 1 }]);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_request WHERE operation='reconcile' AND idempotency_key=${key}`).toEqual([{ count: 1 }]);
  });

  it("serializa decisões concorrentes no mesmo pai e retorna a leaf em divergência", async () => {
    const serviceA = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const pending = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf66-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const input = { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create" as const, policyVersion: policy.version, rationale: "Criar a identidade após retry concorrente", version: "1" };
    const [left, right] = await Promise.all([
      serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: input }),
      serviceB.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: input }),
    ]);
    expect(left.id).toBe(right.id);
    expect(left.decisionCount).toBe(1);
    await expect(serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { ...input, outcome: "reject", rationale: "Rejeitar em vez de criar" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT", leafReconciliationId: left.id });
  });

  it("faz writers SQL diretos equivalentes convergirem na mesma leaf de decisão", async () => {
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-direct-decision-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const intent = { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version, rationale: "Criar a mesma identidade lógica sob concorrência direta.", version: "1" };
    const [left, right] = await Promise.all([
      appA<Array<{ receipt: { id: string } }>>`SELECT write_source_reconciliation_decision(${pending.reconciliation.id}::uuid, ${appA.json(intent)}, ${randomUUID()}::uuid) AS receipt`,
      appB<Array<{ receipt: { id: string } }>>`SELECT write_source_reconciliation_decision(${pending.reconciliation.id}::uuid, ${appB.json(intent)}, ${randomUUID()}::uuid) AS receipt`,
    ]);
    expect(left[0].receipt.id).toBe(right[0].receipt.id);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE parent_reconciliation_id=${pending.reconciliation.id}`).toEqual([{ count: 1 }]);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_decision WHERE lineage_id=${pending.reconciliation.id}`).toEqual([{ count: 1 }]);
  });

  it("serializa decision e apply da mesma confirmação sem deadlock nem efeito parcial", async () => {
    const serviceA = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const pending = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-lock-order-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const before = await tableCounts();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const results = await Promise.race([
      Promise.allSettled([
        serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version, rationale: "Criar identidade sob o lock único da confirmação.", version: "1" } }),
        serviceB.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, idempotencyKey: `story33-lock-order-apply-${randomUUID()}` }),
      ]),
      new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("deadline de concorrência excedida")), 5_000); }),
    ]).finally(() => { if (deadline) clearTimeout(deadline); });
    const [decisionResult, applyResult] = results;
    if (decisionResult.status !== "fulfilled") throw decisionResult.reason;
    if (applyResult.status !== "rejected") throw new Error("O apply da raiz pendente não pode vencer com sucesso.");
    expect(applyResult.reason).toMatchObject({ code: expect.stringMatching(/^(REVISION_CONFLICT|RECONCILIATION_INVALID)$/) });
    if ((applyResult.reason as { code?: string }).code === "REVISION_CONFLICT") {
      expect(applyResult.reason).toMatchObject({ leafReconciliationId: decisionResult.value.id });
    }
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).not.toMatchObject({ code: "RECONCILIATION_DEADLOCK" });
    }
    const after = await tableCounts();
    expect(after.events).toBe(before.events);
    expect(after.projections).toBe(before.projections);
    expect(after.applications).toBe(before.applications);
    expect(after.snapshots).toBe(before.snapshots);
  });

  it("converge raízes simultâneas de mesmo fingerprint em um grafo e duas aliases", async () => {
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const serviceA = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const keyA = `story33-same-fingerprint-a-${randomUUID()}`;
    const keyB = `story33-same-fingerprint-b-${randomUUID()}`;
    const before = await tableCounts();
    const [left, right] = await Promise.all([
      serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: keyA, confirmation: fixture.confirmation, preview: fixture.preview, policy }),
      serviceB.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: keyB, confirmation: fixture.confirmation, preview: fixture.preview, policy }),
    ]);
    expect(right.reconciliation.id).toBe(left.reconciliation.id);
    const after = await tableCounts();
    expect(after.reconciliations - before.reconciliations).toBe(1);
    expect(after.observations - before.observations).toBe(1);
    expect(after.matches - before.matches).toBe(1);
    expect(await admin`SELECT idempotency_key, reconciliation_id::text FROM src_reconciliation_request WHERE idempotency_key IN (${keyA}, ${keyB}) ORDER BY idempotency_key`).toEqual([
      { idempotency_key: keyA, reconciliation_id: left.reconciliation.id },
      { idempotency_key: keyB, reconciliation_id: left.reconciliation.id },
    ]);
  });

  it("serializa writers diretos de fingerprint igual e não deixa linhas parciais", async () => {
    const fixture = await freshFixture();
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const records = await repository.listStableRecords();
    const baseProjectionVersion = await repository.currentProjectionVersion();
    const now = new Date().toISOString();
    const policy = policyFor(fixture.preview);
    const leftGraph = reconcileConfirmedPreview({ confirmation: fixture.confirmation, preview: fixture.preview, records, policy, baseProjectionVersion, now, reconciliationId: randomUUID() });
    const rightGraph = reconcileConfirmedPreview({ confirmation: fixture.confirmation, preview: fixture.preview, records, policy, baseProjectionVersion, now, reconciliationId: randomUUID() });
    expect(rightGraph.fingerprint).toBe(leftGraph.fingerprint);
    const [emptyHash] = await admin<Array<{ value: string }>>`SELECT encode(sha256(convert_to('[]', 'utf8')), 'hex') AS value`;
    const keyA = `story33-direct-converge-a-${randomUUID()}`;
    const keyB = `story33-direct-converge-b-${randomUUID()}`;
    const before = await tableCounts();
    const [left, right] = await Promise.all([
      appA<Array<{ id: string }>>`SELECT write_source_reconciliation('reconcile', ${appA.json({ reconciliation: leftGraph, fingerprint: leftGraph.fingerprint, idempotencyKey: keyA, decisionsHash: emptyHash.value })})::text AS id`,
      appB<Array<{ id: string }>>`SELECT write_source_reconciliation('reconcile', ${appB.json({ reconciliation: rightGraph, fingerprint: rightGraph.fingerprint, idempotencyKey: keyB, decisionsHash: emptyHash.value })})::text AS id`,
    ]);
    expect(right[0].id).toBe(left[0].id);
    const after = await tableCounts();
    expect(after.reconciliations - before.reconciliations).toBe(1);
    expect(after.observations - before.observations).toBe(1);
    expect(after.matches - before.matches).toBe(1);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_request WHERE idempotency_key IN (${keyA}, ${keyB})`).toEqual([{ count: 2 }]);
  });

  it("restringe apply ao session_user tria_app antes de qualquer efeito", async () => {
    const fixture = await freshFixture();
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-apply-auth-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) });
    const before = await tableCounts();
    const args = [pending.reconciliation.id, `story33-admin-apply-${randomUUID()}`, randomUUID(), "Rodrigo"] as const;
    await expect(admin`SELECT * FROM apply_source_reconciliation(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`).rejects.toMatchObject({ code: "42501" });
    await expect(admin.begin(async (tx) => {
      await tx`SET LOCAL ROLE tria_app`;
      return tx`SELECT * FROM apply_source_reconciliation(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`;
    })).rejects.toMatchObject({ code: "42501" });
    expect(await tableCounts()).toEqual(before);
  });

  it("aloca recovery attempts de modo concorrente, durável e restrito por session_user", async () => {
    const fixture = await freshFixture();
    const projectionVersion = await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).currentProjectionVersion();
    const [first, second] = await Promise.all([
      new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).nextRecoveryAttempt(fixture.confirmation.confirmationId, projectionVersion),
      new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY).nextRecoveryAttempt(fixture.confirmation.confirmationId, projectionVersion),
    ]);
    expect([first, second].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)).toEqual(["1", "2"]);
    const reconnected = connect("tria_app", process.env.TRIA_APP_PASSWORD ?? "test-app");
    try {
      await expect(new PostgresSourceReconciliationRepository(reconnected, TEST_CURSOR_KEY).nextRecoveryAttempt(fixture.confirmation.confirmationId, projectionVersion)).resolves.toBe("3");
    } finally {
      await reconnected.end({ timeout: 2 });
    }
    await expect(appA`SELECT next_source_reconciliation_recovery_attempt(${fixture.confirmation.confirmationId}, ${(BigInt(projectionVersion) + 1n).toString()}::bigint)`).rejects.toMatchObject({ code: "40001" });
    const atomicRepository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const unsupportedRepository = new Proxy(atomicRepository, {
      get(target, property, receiver) {
        if (property === "recoverConfirmedPreviewAtomically") return undefined;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(new SourceReconciliationService(unsupportedRepository).recoverConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID" });
    expect(await admin`SELECT attempt::int FROM src_reconciliation_recovery_attempt WHERE confirmation_id=${fixture.confirmation.confirmationId}`).toEqual([{ attempt: 3 }]);
    await expect(importer`SELECT next_source_reconciliation_recovery_attempt(${fixture.confirmation.confirmationId}, ${projectionVersion}::bigint)`).rejects.toMatchObject({ code: "42501" });
    await expect(admin`SELECT next_source_reconciliation_recovery_attempt(${fixture.confirmation.confirmationId}, ${projectionVersion}::bigint)`).rejects.toMatchObject({ code: "42501" });
    await expect(admin.begin(async (tx) => {
      await tx`SET LOCAL ROLE tria_app`;
      return tx`SELECT next_source_reconciliation_recovery_attempt(${fixture.confirmation.confirmationId}, ${projectionVersion}::bigint)`;
    })).rejects.toMatchObject({ code: "42501" });
    expect(await admin`SELECT attempt::int, projection_version::text FROM src_reconciliation_recovery_attempt WHERE confirmation_id=${fixture.confirmation.confirmationId}`).toEqual([{ attempt: 3, projection_version: projectionVersion }]);
  });

  it("faz rollback do recovery allocator quando a raiz falha na mesma transação", async () => {
    const fixture = await freshFixture();
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    await admin`CREATE OR REPLACE FUNCTION story33_fail_recovery_root() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced recovery root failure'; END $$`;
    await admin`CREATE TRIGGER story33_fail_recovery_root BEFORE INSERT ON src_reconciliation FOR EACH ROW EXECUTE FUNCTION story33_fail_recovery_root()`;
    try {
      await expect(service.recoverConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID" });
    } finally {
      await admin`DROP TRIGGER story33_fail_recovery_root ON src_reconciliation`;
      await admin`DROP FUNCTION story33_fail_recovery_root()`;
    }
    expect(await admin`SELECT attempt::text FROM src_reconciliation_recovery_attempt WHERE confirmation_id=${fixture.confirmation.confirmationId}`).toEqual([]);
    await service.recoverConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) });
    expect(await admin`SELECT attempt::text FROM src_reconciliation_recovery_attempt WHERE confirmation_id=${fixture.confirmation.confirmationId}`).toEqual([{ attempt: "1" }]);
  });

  it("elege um vencedor entre reconciliações divergentes sobre a mesma versão", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const serviceA = new SourceReconciliationService(repository);
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const base = await repository.currentProjectionVersion();
    const firstFixture = await freshFixture({ matchingAttributes: { case_key: "divergent-a" } });
    const secondFixture = await freshFixture({ matchingAttributes: { case_key: "divergent-b" } });
    const firstPolicy = policyFor(firstFixture.preview);
    const secondPolicy = policyFor(secondFixture.preview);
    const first = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-divergent-a-${randomUUID()}`, confirmation: firstFixture.confirmation, preview: firstFixture.preview, policy: firstPolicy });
    const second = await serviceB.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-divergent-b-${randomUUID()}`, confirmation: secondFixture.confirmation, preview: secondFixture.preview, policy: secondPolicy });
    expect(first.reconciliation.baseProjectionVersion).toBe(base);
    expect(second.reconciliation.baseProjectionVersion).toBe(base);
    const decidedA = await serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: first.reconciliation.id, decision: { observationId: first.reconciliation.lines[0].observation.id, locator: first.reconciliation.lines[0].observation.locator, outcome: "create", policyVersion: firstPolicy.version, rationale: "Criar o vencedor desta reconciliação divergente.", version: "1" } });
    const decidedB = await serviceB.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: second.reconciliation.id, decision: { observationId: second.reconciliation.lines[0].observation.id, locator: second.reconciliation.lines[0].observation.locator, outcome: "create", policyVersion: secondPolicy.version, rationale: "Criar o perdedor desta reconciliação divergente.", version: "1" } });
    const before = await tableCounts();
    const results = await Promise.allSettled([
      serviceA.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decidedA.id, idempotencyKey: `story33-divergent-apply-a-${randomUUID()}` }),
      serviceB.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decidedB.id, idempotencyKey: `story33-divergent-apply-b-${randomUUID()}` }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: { code: "PROJECTION_VERSION_CONFLICT" } });
    const after = await tableCounts();
    expect(after.projection_version).toBe(before.projection_version + 1);
    expect(after.applications).toBe(before.applications + 1);
    expect(after.events).toBe(before.events + 1);
    expect(after.projections).toBe(before.projections + 1);
    expect(after.stable_records).toBe(before.stable_records + 1);
  });

  it("aplica keep-current no alvo protegido sem trocar a camada vigente", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const beforeVersion = await repository.currentProjectionVersion();
    const keepAdjustmentEventId = randomUUID();
    const keepDecisionEventId = randomUUID();
    const previousDecision = (await repository.listDecisions(reconciliationId)).at(-1);
    if (!previousDecision) throw new Error("A decisão anterior não foi persistida.");
    await admin.begin(async (tx) => {
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, event_type, layer, payload, actor, occurred_at, version)
        VALUES (${keepAdjustmentEventId}, ${reconciliationId}, ${recordId}, 'adjustment.revised', 'adjustment', ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "12.00" })}, 'Rodrigo', now(), 'adjustment-keep')`;
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, event_type, layer, payload, actor, occurred_at, version, decision_id, decision_rationale, decision_version, decision_decided_at)
        VALUES (${keepDecisionEventId}, ${reconciliationId}, ${recordId}, 'decision.audit', 'decision', ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "12.00" })}, 'Rodrigo', now(), 'decision-keep', ${previousDecision.id}, ${previousDecision.rationale}, ${previousDecision.version}, ${previousDecision.decidedAt})`;
      await tx`UPDATE src_effective_record_projection SET payload = ${tx.json({ codigo: "A-1", data: "2026-01-01", valor: "12.00" })}, adjustment_event_id = ${keepAdjustmentEventId}, decision_event_id = ${keepDecisionEventId}, version = 3, updated_at = now() WHERE record_id = ${recordId}`;
    });
    const keepFixture = await freshFixture({ matchingAttributes: { stable_key: "A-1" } });
    const keepPreview = keepFixture.preview;
    const keepConfirmation = keepFixture.confirmation;
    const policy = policyFor(keepPreview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-keep-${keepPreview.previewId}`, confirmation: keepConfirmation, preview: keepPreview, policy });
    expect(pending.reconciliation.lines[0]).toMatchObject({ category: "conflict", stableRecordId: recordId, conflict: { code: "PROTECTED_LAYER" } });
    expect(pending.reconciliation.lines[0].fieldDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({field:'valor',provenanceKind:'decimal-source',originalPresent:false,proposedPresent:true,layer:'decision'}),
    ]));
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: {
      observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "keep-current", stableRecordId: recordId,
      policyVersion: policy.version, rationale: "Rodrigo manteve a decisão auditada vigente.", version: "1",
    } });
    expect(decided).toMatchObject({ canonicalReopenRequired: true });
    expect(decided.changedLines[0]).toMatchObject({ category: "unchanged", decision: { outcome: "keep-current", stableRecordId: recordId } });
    const canonicalDecisionLeaf = await service.reopenReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id });
    expect(canonicalDecisionLeaf).toMatchObject({ id: decided.id, createdAt: decided.createdAt, status: decided.status, decisions: [decided.decision] });
    expect(canonicalDecisionLeaf.lines).toEqual(expect.arrayContaining(decided.changedLines));
    const applied = await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-keep-apply-${decided.id}` });
    const appliedInternal = await repository.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-keep-apply-${decided.id}` });
    // RF102 records the accepted observation even when keep-current preserves
    // the protected payload, followed by the human decision audit event.
    expect(appliedInternal.events).toHaveLength(2);
    expect(appliedInternal.events.map((event) => event.type)).toEqual(expect.arrayContaining(["observation.accepted", "decision.audit"]));
    expect(appliedInternal.events.every((event) => event.recordId === recordId)).toBe(true);
    expect(applied.projectionVersion).toBe(String(Number(beforeVersion) + 1));
    const [projection] = await admin<Array<{ payload: unknown; decimal_sources:unknown; duration_sources:unknown; source_observation_id: string; decision_event_id: string }>>`
      SELECT payload,decimal_sources,duration_sources,source_observation_id::text,decision_event_id::text
      FROM src_effective_record_projection WHERE record_id = ${recordId}`;
    expect(projection).toMatchObject({payload:{codigo:"A-1",data:"2026-01-01",valor:"12.00"},decimal_sources:null,duration_sources:null,source_observation_id:decided.changedLines[0].observation.id});
    expect(projection?.decision_event_id).toEqual(appliedInternal.events.find((event) => event.type === "decision.audit")?.id);
    expect(projection?.decision_event_id).not.toEqual(keepDecisionEventId);
    const [keptDecisionEvent] = await admin<Array<{decimal_sources:unknown;duration_sources:unknown}>>`
      SELECT decimal_sources,duration_sources FROM src_effective_record_event WHERE id=${projection?.decision_event_id}`;
    expect(keptDecisionEvent).toEqual({decimal_sources:null,duration_sources:null});
    const keepSnapshot = await repository.findSnapshotByReconciliation(decided.id);
    const keepSnapshotRecord=keepSnapshot?.projection.find((item)=>item.recordId===recordId);
    expect(keepSnapshotRecord?.payload).toEqual({codigo:"A-1",data:"2026-01-01",valor:"12.00"});
    expect(keepSnapshotRecord).not.toHaveProperty('decimalSources');
    expect(keepSnapshotRecord).not.toHaveProperty('durationSources');
    const keptHydrated=(await repository.listStableRecords()).find((item)=>item.id===recordId);
    expect(keptHydrated?.effectivePayload).toEqual({codigo:"A-1",data:"2026-01-01",valor:"12.00"});
    expect(keptHydrated).not.toHaveProperty('decimalSources');
    expect(keptHydrated).not.toHaveProperty('durationSources');
  });

  it("prova RF142 no PostgreSQL para clear automático/link e preservação keep-current até snapshot e hydration", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const canonicalSearchTerm = `adjustment-canonical-${randomUUID()}`;
    const staleSearchTerm = `projection-stale-${randomUUID()}`;
    const oldPayload = { codigo: canonicalSearchTerm, data: "2026-01-01", valor: "7.00", duracao: "01:30" };
    const oldDecimal = { valor: { source_text: "7.00", source_scale: 2, normalized_value: "7.00" } };
    const oldDuration = { duracao: { source_text: "01:30", unit: "clock" as const } };
    const stalePayload = { codigo: staleSearchTerm, data: "2026-01-01", valor: "99.00" };
    const staleDecimal = { stale_cache_only: { source_text: "99.00", source_scale: 2, normalized_value: "99.00" } };
    const staleDuration = { stale_cache_only: { source_text: "99", unit: "minutes" as const } };
    const seedTarget = async (key: string, protectedLayer = false) => {
      const id = randomUUID();
      const version = await repository.currentProjectionVersion();
      let adjustmentEventId: string | undefined;
      await admin.begin(async (tx) => {
        await tx`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${id},${tx.json({case_key:key})},now())`;
        if (protectedLayer) {
          adjustmentEventId = randomUUID();
          await tx`INSERT INTO src_effective_record_event(id,reconciliation_id,record_id,event_type,layer,payload,decimal_sources,duration_sources,actor,occurred_at,version)
            VALUES(${adjustmentEventId},${reconciliationId},${id},'adjustment.revised','adjustment',${tx.json(oldPayload)},${tx.json(oldDecimal)},${tx.json(oldDuration)},'Rodrigo',now(),${`rf142-adjustment-${id}`})`;
        }
        await tx`INSERT INTO src_effective_record_projection(record_id,payload,decimal_sources,duration_sources,adjustment_event_id,state,version,updated_at)
          VALUES(${id},${tx.json(protectedLayer ? stalePayload : oldPayload)},${tx.json(protectedLayer ? staleDecimal : oldDecimal)},${tx.json(protectedLayer ? staleDuration : oldDuration)},${adjustmentEventId ?? null},'active',${version}::bigint,now())`;
      });
      return {id,adjustmentEventId};
    };
    const applyAndRead = async (id: string) => {
      const key = `rf142-apply-${randomUUID()}`;
      await service.applyReconciliation({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:id,idempotencyKey:key});
      return repository.applyReconciliation({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:id,idempotencyKey:key});
    };
    const physicalProjection = async (id: string) => (await admin<Array<{payload:unknown;decimal_sources:unknown;duration_sources:unknown;decimal_text:string|null;duration_text:string|null;source_observation_id:string|null;adjustment_event_id:string|null;decision_event_id:string|null}>>`
      SELECT payload,decimal_sources,duration_sources,decimal_sources::text decimal_text,duration_sources::text duration_text,
        source_observation_id::text,adjustment_event_id::text,decision_event_id::text
      FROM src_effective_record_projection WHERE record_id=${id}`)[0];
    const snapshotRecord = async (reconciliation: string, id: string) => {
      const snapshot = await repository.findSnapshotByReconciliation(reconciliation);
      const record = snapshot?.projection.find((candidate) => candidate.recordId === id);
      if (!record) throw new Error(`Snapshot RF142 ausente para ${id}.`);
      return record;
    };
    const hydratedRecord = async (id: string) => {
      const record = (await new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY).listStableRecords()).find((candidate) => candidate.id === id);
      if (!record) throw new Error(`Registro RF142 não hidratado para ${id}.`);
      return record;
    };

    const autoKey = `rf142-auto-${randomUUID()}`;
    const automaticTarget = await seedTarget(autoKey);
    const automaticFixture = await freshFixture({matchingAttributes:{case_key:autoKey},normalizedPayload:{codigo:'AUTO',data:'2026-01-01',valor:'8.00'},decimalSources:{},durationSources:{}});
    const automaticRoot = await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`rf142-auto-${randomUUID()}`,confirmation:automaticFixture.confirmation,preview:automaticFixture.preview,policy:policyFor(automaticFixture.preview)});
    expect(automaticRoot.reconciliation.lines[0]).toMatchObject({stableRecordId:automaticTarget.id,category:'updated'});
    const automaticApplied = await applyAndRead(automaticRoot.reconciliation.id);
    const automaticSource = automaticApplied.events.find((event)=>event.recordId===automaticTarget.id&&event.layer==='source');
    expect(automaticSource).toMatchObject({decimalSources:{},durationSources:{}});
    expect(automaticSource).toHaveProperty('decimalSources');expect(automaticSource).toHaveProperty('durationSources');
    expect(await admin`SELECT decimal_sources,duration_sources,decimal_sources::text decimal_text,duration_sources::text duration_text FROM src_effective_record_event WHERE reconciliation_id=${automaticRoot.reconciliation.id} AND record_id=${automaticTarget.id} AND layer='source'`)
      .toEqual([{decimal_sources:{},duration_sources:{},decimal_text:'{}',duration_text:'{}'}]);
    expect(await physicalProjection(automaticTarget.id)).toMatchObject({decimal_sources:{},duration_sources:{},decimal_text:'{}',duration_text:'{}'});
    expect(await snapshotRecord(automaticRoot.reconciliation.id,automaticTarget.id)).toMatchObject({decimalSources:{},durationSources:{}});
    expect(await hydratedRecord(automaticTarget.id)).toMatchObject({decimalSources:{},durationSources:{}});

    const linkTarget = await seedTarget(`rf142-link-target-${randomUUID()}`);
    const linkFixture = await freshFixture({matchingAttributes:{case_key:`rf142-link-observation-${randomUUID()}`},normalizedPayload:{codigo:'LINK',data:'2026-01-01',valor:'9.00'},decimalSources:{},durationSources:{}});
    const linkRoot = await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`rf142-link-${randomUUID()}`,confirmation:linkFixture.confirmation,preview:linkFixture.preview,policy:policyFor(linkFixture.preview)});
    const linkLine = linkRoot.reconciliation.lines[0];
    const linkLeaf = await service.recordDecision({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:linkRoot.reconciliation.id,decision:{observationId:linkLine.observation.id,locator:linkLine.observation.locator,outcome:'link',stableRecordId:linkTarget.id,policyVersion:linkRoot.reconciliation.policy.version,rationale:'RF142 limpa metadados por vínculo humano.',version:'1'}});
    const linkApplied = await applyAndRead(linkLeaf.id);
    const linkEvents = linkApplied.events.filter((event)=>event.recordId===linkTarget.id);
    expect(linkEvents.map((event)=>event.layer).sort()).toEqual(['decision','source']);
    for (const event of linkEvents) { expect(event).toHaveProperty('decimalSources');expect(event).toHaveProperty('durationSources');expect(event.decimalSources).toEqual({});expect(event.durationSources).toEqual({}); }
    expect(await admin`SELECT layer,decimal_sources,duration_sources,decimal_sources::text decimal_text,duration_sources::text duration_text FROM src_effective_record_event WHERE reconciliation_id=${linkLeaf.id} AND record_id=${linkTarget.id} ORDER BY layer`)
      .toEqual([{layer:'decision',decimal_sources:{},duration_sources:{},decimal_text:'{}',duration_text:'{}'},{layer:'source',decimal_sources:{},duration_sources:{},decimal_text:'{}',duration_text:'{}'}]);
    expect(await physicalProjection(linkTarget.id)).toMatchObject({decimal_sources:{},duration_sources:{},decimal_text:'{}',duration_text:'{}'});
    expect(await snapshotRecord(linkLeaf.id,linkTarget.id)).toMatchObject({decimalSources:{},durationSources:{}});
    expect(await hydratedRecord(linkTarget.id)).toMatchObject({decimalSources:{},durationSources:{}});

    const keepKey = `rf142-keep-${randomUUID()}`;
    const keepTarget = await seedTarget(keepKey,true);
    const unrelatedStaleTarget = await seedTarget(`rf142-unrelated-${randomUUID()}`,true);
    const [resolvedBeforeKeep] = await admin<Array<{effective_payload:unknown;decimal_sources:unknown;duration_sources:unknown;effective_layer:string}>>`
      SELECT effective_payload,decimal_sources,duration_sources,effective_layer
      FROM source_reconciliation_effective_record(${keepTarget.id}::uuid)`;
    expect(resolvedBeforeKeep).toMatchObject({effective_payload:oldPayload,decimal_sources:oldDecimal,duration_sources:oldDuration,effective_layer:'adjustment'});
    const adjustmentSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:canonicalSearchTerm,page:0,pageSize:50});
    expect(adjustmentSearch.records).toEqual(expect.arrayContaining([expect.objectContaining({
      id:keepTarget.id,effectiveLayer:'adjustment',effectivePayload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,
    })]));
    const staleAdjustmentSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:staleSearchTerm,page:0,pageSize:50});
    expect(staleAdjustmentSearch.records.map((record)=>record.id)).not.toEqual(expect.arrayContaining([keepTarget.id,unrelatedStaleTarget.id]));
    const [metricProof] = await admin<Array<{metrics:unknown;accumulator:unknown}>>`
      SELECT source_reconciliation_metrics('[]'::jsonb) metrics,source_reconciliation_metric_accumulator('[]'::jsonb) accumulator`;
    expect(JSON.stringify(metricProof)).not.toContain('stale_cache_only');
    const keepFixture = await freshFixture({matchingAttributes:{case_key:keepKey},normalizedPayload:{codigo:'INCOMING',data:'2026-01-01',valor:'10.00'},decimalSources:{},durationSources:{}});
    const keepRoot = await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`rf142-keep-${randomUUID()}`,confirmation:keepFixture.confirmation,preview:keepFixture.preview,policy:policyFor(keepFixture.preview)});
    expect(keepRoot.reconciliation.lines[0].conflict?.code).toBe('PROTECTED_LAYER');
    expect(keepRoot.reconciliation.lines[0].fieldDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({field:'codigo',original:canonicalSearchTerm,originalPresent:true,layer:'adjustment'}),
      expect.objectContaining({field:'valor',originalPresent:true,provenanceKind:'decimal-source',layer:'adjustment'}),
    ]));
    expect(JSON.stringify(keepRoot.reconciliation.lines[0].fieldDiffs)).not.toContain('stale_cache_only');
    const keepLine=keepRoot.reconciliation.lines[0];
    const keepLeaf=await service.recordDecision({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:keepRoot.reconciliation.id,decision:{observationId:keepLine.observation.id,locator:keepLine.observation.locator,outcome:'keep-current',stableRecordId:keepTarget.id,policyVersion:keepRoot.reconciliation.policy.version,rationale:'RF142 mantém payload, proveniência e ponteiros vigentes.',version:'1'}});
    const keepApplied=await applyAndRead(keepLeaf.id);
    const keepSource=keepApplied.events.find((event)=>event.recordId===keepTarget.id&&event.layer==='source');
    const keepDecision=keepApplied.events.find((event)=>event.recordId===keepTarget.id&&event.layer==='decision');
    expect(keepSource).toMatchObject({decimalSources:{},durationSources:{}});
    expect(keepDecision).toMatchObject({payload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,decisionId:keepLeaf.decision.id});
    const keptProjection=await physicalProjection(keepTarget.id);
    expect(keptProjection).toMatchObject({payload:oldPayload,decimal_sources:oldDecimal,duration_sources:oldDuration,source_observation_id:keepLine.observation.id,adjustment_event_id:keepTarget.adjustmentEventId,decision_event_id:keepDecision?.id});
    await admin`UPDATE src_effective_record_projection SET payload=${admin.json(stalePayload)} WHERE record_id=${keepTarget.id}`;
    try{
      const decisionSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:canonicalSearchTerm,page:0,pageSize:50});
      expect(decisionSearch.records).toEqual(expect.arrayContaining([expect.objectContaining({
        id:keepTarget.id,effectiveLayer:'decision',effectivePayload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,
      })]));
      const staleDecisionSearch=await repository.searchStableRecords({reconciliationId:sparseCurrentId,query:staleSearchTerm,page:0,pageSize:50});
      expect(staleDecisionSearch.records.map((record)=>record.id)).not.toContain(keepTarget.id);
    }finally{
      await admin`UPDATE src_effective_record_projection SET payload=${admin.json(oldPayload)} WHERE record_id=${keepTarget.id}`;
    }
    expect(await snapshotRecord(keepLeaf.id,keepTarget.id)).toMatchObject({payload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,sourceObservationId:keepLine.observation.id,adjustmentEventId:keepTarget.adjustmentEventId,decisionEventId:keepDecision?.id});
    expect(await snapshotRecord(keepLeaf.id,unrelatedStaleTarget.id)).toMatchObject({payload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,adjustmentEventId:unrelatedStaleTarget.adjustmentEventId});
    expect(await physicalProjection(unrelatedStaleTarget.id)).toMatchObject({payload:stalePayload,decimal_sources:staleDecimal,duration_sources:staleDuration,adjustment_event_id:unrelatedStaleTarget.adjustmentEventId});
    expect(await hydratedRecord(keepTarget.id)).toMatchObject({effectivePayload:oldPayload,decimalSources:oldDecimal,durationSources:oldDuration,sourceObservationId:keepLine.observation.id,adjustmentEventId:keepTarget.adjustmentEventId,decisionEventId:keepDecision?.id});
  },60_000);

  it("deriva ausência pelo alvo realmente observado em conflict, reject e redirect link", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const absenceIds = async (id: string) => {
      const first = await repository.listAbsences(id, { page: 0, pageSize: 100 });
      const pages = [first];
      let cursor = first.nextCursor;
      for (let page = 1; cursor; page += 1) {
        const next = await repository.listAbsences(id, { page, pageSize: 100, cursor: cursor });
        pages.push(next);
        cursor = next.nextCursor;
      }
      return pages.flatMap((value) => value.absences.map((item) => item.stableRecordId));
    };
    const [latest] = await admin<Array<{ id: string }>>`SELECT id::text FROM src_reconciliation ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (!latest) throw new Error("A fixture precisa produzir uma reconciliação.");
    const originalId = randomUUID();
    const redirectId = randomUUID();
    const unrelatedAbsenceId = randomUUID();
    const protectedEventId = randomUUID();
    const unrelatedEventId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES
        (${originalId}, ${tx.json({ stable_key: "observed-original" })}, now()),
        (${redirectId}, ${tx.json({ stable_key: "redirect-target" })}, now()),
        (${unrelatedAbsenceId}, ${tx.json({ stable_key: "unrelated-absence" })}, now())`;
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, event_type, layer, payload, decimal_sources, duration_sources, actor, occurred_at, version)
        VALUES
          (${protectedEventId}, ${latest.id}, ${originalId}, 'adjustment.revised', 'adjustment', ${tx.json({ valor: "99.00" })}, '{}'::jsonb, '{}'::jsonb, 'Rodrigo', now(), 'protected-absence'),
          (${unrelatedEventId}, ${latest.id}, ${unrelatedAbsenceId}, 'adjustment.revised', 'adjustment', ${tx.json({ valor: "88.00" })}, '{}'::jsonb, '{}'::jsonb, 'Rodrigo', now(), 'unrelated-absence')`;
      await tx`INSERT INTO src_effective_record_projection
        (record_id, payload, decimal_sources, duration_sources, adjustment_event_id, state, version, updated_at)
        VALUES
          (${originalId}, ${tx.json({ valor: "projection-stale-99" })}, '{}'::jsonb, '{}'::jsonb, ${protectedEventId}, 'active', 17, now()),
          (${unrelatedAbsenceId}, ${tx.json({ valor: "projection-stale-88" })}, '{}'::jsonb, '{}'::jsonb, ${unrelatedEventId}, 'active', 18, now())`;
    });
    const firstFixture = await freshFixture({ matchingAttributes: { stable_key: "observed-original" } });
    const firstPolicy = policyFor(firstFixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-absence-protected-${randomUUID()}`, confirmation: firstFixture.confirmation, preview: firstFixture.preview, policy: firstPolicy });
    expect(pending.reconciliation.lines[0]).toMatchObject({ category: "conflict", stableRecordId: originalId, conflict: { code: "PROTECTED_LAYER" } });
    expect(await absenceIds(pending.reconciliation.id)).not.toContain(originalId);
    expect(await admin`SELECT effective_payload,effective_version FROM src_reconciliation_absence
      WHERE reconciliation_id=${pending.reconciliation.id} AND stable_record_id=${unrelatedAbsenceId} AND present`).toEqual([
      {effective_payload:{valor:"88.00"},effective_version:"18"},
    ]);
    const rejected = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "reject", policyVersion: firstPolicy.version, rationale: "Rejeitar o efeito não apaga o fato de que o alvo foi observado.", version: "1" } });
    expect(await absenceIds(rejected.id)).not.toContain(originalId);

    const secondFixture = await freshFixture({ matchingAttributes: { stable_key: "observed-original" } });
    const secondPolicy = policyFor(secondFixture.preview);
    const secondPending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-absence-link-${randomUUID()}`, confirmation: secondFixture.confirmation, preview: secondFixture.preview, policy: secondPolicy });
    const linked = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: secondPending.reconciliation.id, decision: { observationId: secondPending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: redirectId, policyVersion: secondPolicy.version, rationale: "Redirecionar explicitamente a observação para o novo alvo.", version: "1" } });
    const linkedIds = await absenceIds(linked.id);
    expect(linkedIds).toContain(originalId);
    expect(linkedIds).not.toContain(redirectId);
    expect(await admin`SELECT effective_payload,effective_version FROM src_reconciliation_absence
      WHERE reconciliation_id=${linked.id} AND stable_record_id=${originalId} AND present`).toEqual([
      {effective_payload:{valor:"99.00"},effective_version:"17"},
    ]);
    expect(await admin`SELECT effective_payload,effective_version FROM src_reconciliation_absence_head
      WHERE lineage_id=${secondPending.reconciliation.id} AND stable_record_id=${originalId}`).toEqual([
      {effective_payload:{valor:"99.00"},effective_version:"17"},
    ]);
  });

  it("recusa colisão da identidade alocada para create sem vínculo implícito", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-collision-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: {
      observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version,
      rationale: "A identidade é alocada pelo serviço antes da aplicação.", version: "1",
    } });
    const allocatedId = decided.decision?.stableRecordId;
    if (!allocatedId) throw new Error("A decisão create não recebeu identidade alocada.");
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${allocatedId}, ${admin.json({ collision: "fixture" })}, now())`;
    const before = await tableCounts();
    await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-collision-apply-${decided.id}` })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID", message: "A reconciliação não pôde ser concluída." });
    expect(await tableCounts()).toEqual(before);
  });

  it("faz rollback integral em cada estágio de escrita PostgreSQL", async () => {
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const stages = [
      ["src_stable_record", "INSERT"], ["src_effective_record_event", "INSERT"], ["src_effective_record_projection", "INSERT"],
      ["src_projection_version", "UPDATE"], ["src_reconciliation_application", "INSERT"], ["src_effective_snapshot", "INSERT"], ["src_reconciliation_request", "INSERT"],
    ] as const;
    for (const [table, operation] of stages) {
      const fixture = await freshFixture();
      const rollbackPolicy = policyFor(fixture.preview);
      const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-reconcile-rollback-${table}-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy: rollbackPolicy });
      const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: {
        observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create",
        policyVersion: rollbackPolicy.version, rationale: "Rodrigo confirmou uma nova identidade interna para a linha.", version: "1",
      } });
      expect(decided.status).toBe("ready-to-apply");
      const before = await tableCounts();
      const removeFailure = await injectFailure(table, operation);
      try {
        await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-rollback-${table}-${decided.id}` })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID", message: "A reconciliação não pôde ser concluída." });
      } finally {
        await removeFailure();
      }
      expect(await tableCounts()).toEqual(before);
    }
  });

  it("rejeita a matriz hostil de efeitos derivados antes de qualquer escrita ou aplicação", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const canonicalResult = await service.reconcileConfirmedPreview({
      actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf83-hostile-base-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy,
    });
    const canonical = structuredClone(canonicalResult.reconciliation);
    const [stored] = await admin<Array<{ decisions_hash: string }>>`SELECT decisions_hash FROM src_reconciliation WHERE id = ${canonical.id}`;
    if (!stored) throw new Error("O grafo canônico da matriz hostil não foi persistido.");
    const before = await tableCounts();
    const variants: Array<[string, (graph: typeof canonical) => void]> = [
      ["category", (graph) => { graph.lines[0].category = "updated"; }],
      ["target", (graph) => { graph.lines[0].stableRecordId = randomUUID(); }],
      ["conflicts", (graph) => { graph.conflicts = graph.conflicts.map((item, index) => index === 0 ? { ...item, message: `${item.message} adulterado` } : item); }],
      ["fieldDiffs", (graph) => { graph.lines[0].fieldDiffs = [...graph.lines[0].fieldDiffs, { field: "hostile", original: null, proposed: "1", layer: "none", cause: graph.lines[0].consequence }]; }],
      ["summary", (graph) => { graph.summary = { ...graph.summary, total: graph.summary.total + 1 }; }],
      ["metrics", (graph) => { const metrics = graph.metrics ?? { decimalSums: {}, durationSums: {} }; graph.metrics = { decimalSums: { ...metrics.decimalSums, hostile: "1" }, durationSums: metrics.durationSums }; }],
    ];
    for (const [label, mutate] of variants) {
      const hostile = structuredClone(canonical);
      hostile.id = randomUUID();
      mutate(hostile);
      let writerReturned = false;
      await expect(appA.begin(async (tx) => {
        await tx`SELECT write_source_reconciliation('reconcile', ${tx.json({
          reconciliation: hostile, fingerprint: hostile.fingerprint, idempotencyKey: `story33-rf83-hostile-${label}-${randomUUID()}`,
          decisionsHash: stored.decisions_hash,
        })})`;
        writerReturned = true;
      })).rejects.toMatchObject({ code: "22023" });
      expect(writerReturned, `a mutação ${label} foi aceita pelo writer SQL`).toBe(false);
      expect(await tableCounts()).toEqual(before);
      expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE id = ${hostile.id}`).toEqual([{ count: 0 }]);
      expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_application WHERE reconciliation_id = ${hostile.id}`).toEqual([{ count: 0 }]);
    }
  });

  it("rejeita policy e matchingAttributes fabricados antes do apply, sem escrita ou efeito", async () => {
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const canonicalResult = await service.reconcileConfirmedPreview({
      actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf84-base-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy,
    });
    const hostile = structuredClone(canonicalResult.reconciliation);
    hostile.id = randomUUID();
    hostile.policy = { ...hostile.policy, fields: ["hostile_key"] };
    hostile.lines[0].observation.matchingAttributes = { hostile_key: "A-1" };
    const [fingerprint] = await admin<Array<{ fingerprint: string }>>`SELECT source_reconciliation_fingerprint(${admin.json({ reconciliation: hostile })})::text AS fingerprint`;
    const before = await tableCounts();
    let writerReturned = false;
    await expect(appA.begin(async (tx) => {
      await tx`SELECT write_source_reconciliation('reconcile', ${tx.json({
        reconciliation: hostile, fingerprint: fingerprint.fingerprint, idempotencyKey: `story33-rf84-hostile-${randomUUID()}`,
        decisionsHash: (await admin<Array<{ decisions_hash: string }>>`SELECT decisions_hash FROM src_reconciliation WHERE id = ${canonicalResult.reconciliation.id}`)[0].decisions_hash,
      })})`;
      writerReturned = true;
    })).rejects.toMatchObject({ code: "22023" });
    expect(writerReturned).toBe(false);
    expect(await tableCounts()).toEqual(before);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE id = ${hostile.id}`).toEqual([{ count: 0 }]);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_application WHERE reconciliation_id = ${hostile.id}`).toEqual([{ count: 0 }]);
  });

  it("rejeita replay com mesmo ID e locator quando diverge qualquer campo imutável", async () => {
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const canonicalResult = await service.reconcileConfirmedPreview({
      actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf85-base-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy,
    });
    const [stored] = await admin<Array<{ decisions_hash: string }>>`SELECT decisions_hash FROM src_reconciliation WHERE id = ${canonicalResult.reconciliation.id}`;
    if (!stored) throw new Error("O grafo canônico de RF85 não foi persistido.");
    const before = await tableCounts();
    const variants: Array<[string, (graph: typeof canonicalResult.reconciliation) => void]> = [
      ["sourceRowHash", (graph) => { graph.lines[0].observation.sourceRowHash = "0".repeat(64); }],
      ["functionalHash", (graph) => { graph.lines[0].observation.functionalHash = "0".repeat(64); }],
      ["normalizedPayload", (graph) => { graph.lines[0].observation.normalizedPayload = { ...graph.lines[0].observation.normalizedPayload, valor: "99.99" }; }],
      ["sourceValues", (graph) => { graph.lines[0].observation.sourceValues = { ...graph.lines[0].observation.sourceValues, valor: "99.99" }; }],
      ["decimalSources", (graph) => { graph.lines[0].observation.decimalSources = { valor: { source_text: "99.99", source_scale: 2, normalized_value: "99.99" } }; }],
      ["durationSources", (graph) => { graph.lines[0].observation.durationSources = { duracao: { source_text: "1", unit: "minutes" } }; }],
      ["batchId", (graph) => { graph.lines[0].observation.batchId = randomUUID(); }],
      ["previewId", (graph) => { graph.lines[0].observation.previewId = randomUUID(); }],
      ["sourceFileId", (graph) => { graph.lines[0].observation.sourceFileId = randomUUID(); }],
      ["observedAt", (graph) => { graph.lines[0].observation.observedAt = "2025-01-01T00:00:00.000Z"; }],
      ["matchingAttributes", (graph) => { graph.lines[0].observation.matchingAttributes = { stable_key: "fabricado" }; }],
    ];
    for (const [label, mutate] of variants) {
      const hostile = structuredClone(canonicalResult.reconciliation);
      hostile.id = randomUUID();
      mutate(hostile);
      let writerReturned = false;
      await expect(appA.begin(async (tx) => {
        await tx`SELECT write_source_reconciliation('reconcile', ${tx.json({
          reconciliation: hostile, fingerprint: hostile.fingerprint, idempotencyKey: `story33-rf85-hostile-${label}-${randomUUID()}`,
          decisionsHash: stored.decisions_hash,
        })})`;
        writerReturned = true;
      })).rejects.toMatchObject({ code: "22023" });
      expect(writerReturned, `o replay divergente de ${label} foi aceito`).toBe(false);
      expect(await tableCounts()).toEqual(before);
      expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE id = ${hostile.id}`).toEqual([{ count: 0 }]);
      expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_application WHERE reconciliation_id = ${hostile.id}`).toEqual([{ count: 0 }]);
    }
  });

  it("impede INSERT direto do papel de aplicação nas tabelas da reconciliação", async () => {
    await expect(appA.begin(async (tx) => {
      await tx`SELECT set_config('tria.reconciliation_write', 'on', true)`;
      await tx`INSERT INTO src_source_observation
        (id, batch_id, preview_id, source_file_id, locator, source_row_hash, functional_hash, normalized_payload, source_values, decimal_sources, matching_attributes, observed_at)
        VALUES (${randomUUID()}, ${preview.batchId}, ${preview.previewId}, ${preview.sourceFileId}, 'bypass:valid', ${'b'.repeat(64)}, ${'c'.repeat(64)}, ${tx.json({ stable_key: 'bypass' })}, ${tx.json({ stable_key: 'bypass' })}, ${tx.json({})}, ${tx.json({})}, now())`;
    })).rejects.toMatchObject({ code: "42501" });
    const beforeHostile = await tableCounts();
    const [canonical] = await admin<Array<{ manifest: Record<string, unknown>; decisions_hash: string }>>`SELECT source_reconciliation_materialize_manifest(id) AS manifest, decisions_hash FROM src_reconciliation ORDER BY revision_no DESC, created_at DESC, id DESC LIMIT 1`;
    const hostileReconciliation = { ...canonical.manifest, id: randomUUID(), status: "ready-to-apply", fingerprint: "f".repeat(64), summary: { ...(canonical.manifest.summary as Record<string, unknown>), total: Number((canonical.manifest.summary as Record<string, unknown>).total ?? 0) + 1 } };
    await expect(appA.begin(async (tx) => {
      await tx`SELECT write_source_reconciliation('reconcile', ${tx.json({ reconciliation: hostileReconciliation, fingerprint: hostileReconciliation.fingerprint, idempotencyKey: `hostile-${randomUUID()}`, decisionsHash: canonical.decisions_hash })})`;
    })).rejects.toMatchObject({ code: "22023" });
    expect(await tableCounts()).toEqual(beforeHostile);
    for (const table of ["src_stable_record", "src_source_observation", "src_record_match", "src_reconciliation", "src_import_conflict", "src_reconciliation_decision", "src_effective_record_event", "src_reconciliation_application", "src_effective_snapshot"]) {
      await expect(appA.unsafe(`INSERT INTO ${table} (id) VALUES ('${randomUUID()}')`)).rejects.toThrow();
    }
    const [acl] = await admin<Array<{ importer_manifest:boolean;importer_writer:boolean;importer_apply:boolean;app_manifest:boolean;app_read:boolean;app_page:boolean;app_search:boolean;app_unbounded:boolean;app_pure_helper:boolean;app_field_diff:boolean;app_temp:boolean }>>`SELECT
      has_function_privilege('tria_importer','source_reconciliation_materialize_manifest(uuid)','execute') importer_manifest,
      has_function_privilege('tria_importer','write_source_reconciliation(text,jsonb)','execute') importer_writer,
      has_function_privilege('tria_importer','apply_source_reconciliation(uuid,text,uuid,text)','execute') importer_apply,
      has_function_privilege('tria_app','source_reconciliation_materialize_manifest(uuid)','execute') app_manifest,
      has_function_privilege('tria_app','read_source_reconciliation(uuid)','execute') app_read,
      has_function_privilege('tria_app','source_reconciliation_absence_page(uuid,uuid,integer)','execute') app_page,
      has_function_privilege('tria_app','source_reconciliation_stable_record_page(text,uuid,integer)','execute') app_search,
      has_function_privilege('tria_app','source_reconciliation_absence_rows(uuid)','execute') app_unbounded,
      has_function_privilege('tria_app','source_reconciliation_jcs(jsonb)','execute') app_pure_helper,
      has_function_privilege('tria_app','source_reconciliation_field_diffs(jsonb,uuid,text)','execute') app_field_diff,
      has_database_privilege('tria_app',current_database(),'TEMPORARY') app_temp`;
    expect(acl).toEqual({importer_manifest:false,importer_writer:false,importer_apply:false,app_manifest:false,app_read:true,app_page:true,app_search:true,app_unbounded:false,app_pure_helper:false,app_field_diff:false,app_temp:false});
    await expect(importer`SELECT source_reconciliation_materialize_manifest(${reconciliationId})`).rejects.toMatchObject({ code: "42501" });
    const hostileFixture = await freshFixture();
    const hostileService = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const hostilePending = await hostileService.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `hostile-intent-${randomUUID()}`, confirmation: hostileFixture.confirmation, preview: hostileFixture.preview, policy: policyFor(hostileFixture.preview) });
    const hostileIntent = { observationId: hostilePending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "reject", rationale: "Rejeição hostil estrutural.", version: "1", summary: {} };
    const beforeIntent = await tableCounts();
    await expect(appA`SELECT write_source_reconciliation_decision(${hostilePending.reconciliation.id}::uuid,${appA.json(hostileIntent)},${randomUUID()}::uuid)`).rejects.toMatchObject({ code: "22023" });
    expect(await tableCounts()).toEqual(beforeIntent);
    await expect(admin.begin(async (tx) => { await tx`SET LOCAL ROLE tria_app`; await tx`SELECT write_source_reconciliation_decision(${hostilePending.reconciliation.id}::uuid,${tx.json(hostileIntent)},${randomUUID()}::uuid)`; })).rejects.toMatchObject({ code: "42501" });
    expect(await tableCounts()).toEqual(beforeIntent);
  });

  it("prova a matriz ACL efetiva de todas as relações e assinaturas 030", async () => {
    const protectedRelations=["src_stable_record", "src_source_observation", "src_record_match", "src_reconciliation", "src_import_conflict", "src_reconciliation_decision", "src_reconciliation_line_state", "src_reconciliation_head", "src_reconciliation_line_head", "src_reconciliation_observed_target_head", "src_reconciliation_target_bucket_head", "src_reconciliation_target_bucket_transition", "src_reconciliation_absence_head", "src_reconciliation_absence_span", "src_reconciliation_absence_key", "src_reconciliation_absence_node", "src_reconciliation_metric_head", "src_reconciliation_absence", "src_effective_record_event", "src_projection_version", "src_effective_record_projection", "src_reconciliation_application", "src_reconciliation_confirmation_application", "src_reconciliation_recovery_attempt", "src_effective_snapshot", "src_reconciliation_request"];
    const allowedSelect=new Set(["src_reconciliation_confirmation_application", "src_reconciliation_recovery_attempt", "src_stable_record", "src_effective_record_event", "src_reconciliation", "src_reconciliation_head", "src_reconciliation_request", "src_effective_record_projection", "src_reconciliation_application", "src_effective_snapshot", "src_projection_version"]);
    const relationAcl=await admin<Array<{name:string;app_select:boolean;app_write:boolean;importer_any:boolean;public_any:boolean}>>`SELECT names.name,has_table_privilege('tria_app',names.name,'SELECT') app_select,has_table_privilege('tria_app',names.name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') app_write,has_table_privilege('tria_importer',names.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') importer_any,EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=names.name::regclass AND acl.grantee=0 AND acl.privilege_type IN('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) public_any FROM unnest(${protectedRelations}::text[]) names(name) ORDER BY names.name`;
    expect(relationAcl).toHaveLength(protectedRelations.length);
    for(const row of relationAcl)expect(row).toEqual({name:row.name,app_select:allowedSelect.has(row.name),app_write:false,importer_any:false,public_any:false});
    const allowedExecute=new Set(["read_source_reconciliation(uuid)", "source_reconciliation_absence_page(uuid,uuid,integer)", "source_reconciliation_stable_record_page(text,uuid,integer)", "write_source_reconciliation(text,jsonb)", "write_source_reconciliation_decision(uuid,jsonb,uuid)", "alias_source_reconciliation_request(text,character,character,uuid,boolean)", "next_source_reconciliation_recovery_attempt(uuid,bigint)", "apply_source_reconciliation(uuid,text,uuid,text)"]);
    const routineAcl=await admin<Array<{signature:string;app_execute:boolean;importer_execute:boolean;public_execute:boolean}>>`SELECT p.oid::regprocedure::text signature,has_function_privilege('tria_app',p.oid,'EXECUTE') app_execute,has_function_privilege('tria_importer',p.oid,'EXECUTE') importer_execute,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'source_reconciliation_%' OR p.proname IN('validate_import_graph','validate_source_reconciliation_projection_pointers','validate_source_reconciliation_absence_span','prevent_source_reconciliation_mutation','read_source_reconciliation','write_source_reconciliation','write_source_reconciliation_decision','alias_source_reconciliation_request','next_source_reconciliation_recovery_attempt','apply_source_reconciliation')) ORDER BY signature`;
    expect(routineAcl).toHaveLength(50);
    for(const row of routineAcl){const signature=row.signature.replace(/^public\./,'');expect(row).toEqual({signature:row.signature,app_execute:allowedExecute.has(signature),importer_execute:false,public_execute:false});}
    for (const statement of [
      `SELECT source_reconciliation_has_reserved_key('{}'::jsonb)`,
      `SELECT source_reconciliation_valid_decimal_sources('{}'::jsonb)`,
      `SELECT source_reconciliation_valid_duration_sources('{}'::jsonb)`,
      `SELECT source_reconciliation_validate_staging_row_json()`,
      `SELECT * FROM source_reconciliation_effective_record('${recordId}'::uuid)`,
    ]) await expect(appA.unsafe(statement)).rejects.toMatchObject({code:'42501'});
    await expect(importer`SELECT * FROM source_reconciliation_effective_record(${recordId}::uuid)`).rejects.toMatchObject({code:'42501'});
    const protectedSignatures=routineAcl.map(row=>row.signature);
    const [scope]=await admin<Array<{app_connect:boolean;importer_connect:boolean;app_create:boolean;importer_create:boolean;app_temp:boolean;importer_temp:boolean;app_usage:boolean;importer_usage:boolean;app_schema_create:boolean;importer_schema_create:boolean;public_temp:boolean;unsafe_roles:number;memberships:number;owned_objects:number}>>`SELECT
      has_database_privilege('tria_app',current_database(),'CONNECT') app_connect,has_database_privilege('tria_importer',current_database(),'CONNECT') importer_connect,
      has_database_privilege('tria_app',current_database(),'CREATE') app_create,has_database_privilege('tria_importer',current_database(),'CREATE') importer_create,
      has_database_privilege('tria_app',current_database(),'TEMPORARY') app_temp,has_database_privilege('tria_importer',current_database(),'TEMPORARY') importer_temp,
      has_schema_privilege('tria_app','public','USAGE') app_usage,has_schema_privilege('tria_importer','public','USAGE') importer_usage,
      has_schema_privilege('tria_app','public','CREATE') app_schema_create,has_schema_privilege('tria_importer','public','CREATE') importer_schema_create,
      EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl WHERE d.datname=current_database() AND acl.grantee=0 AND acl.privilege_type='TEMPORARY') public_temp,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN('tria_app','tria_importer') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) unsafe_roles,
      (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member WHERE member.rolname IN('tria_app','tria_importer')) memberships,
      ((SELECT count(*) FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner WHERE c.oid=ANY(SELECT name::regclass FROM unnest(${protectedRelations}::text[]) names(name)) AND owner.rolname IN('tria_app','tria_importer'))+
       (SELECT count(*) FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=ANY(SELECT signature::regprocedure FROM unnest(${protectedSignatures}::text[]) signatures(signature)) AND owner.rolname IN('tria_app','tria_importer'))+
       (SELECT count(*) FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner WHERE n.nspname='public' AND owner.rolname IN('tria_app','tria_importer'))+
       (SELECT count(*) FROM pg_database d JOIN pg_roles owner ON owner.oid=d.datdba WHERE d.datname=current_database() AND owner.rolname IN('tria_app','tria_importer')))::int owned_objects`;
    expect(scope).toEqual({app_connect:true,importer_connect:true,app_create:false,importer_create:false,app_temp:false,importer_temp:false,app_usage:true,importer_usage:true,app_schema_create:false,importer_schema_create:false,public_temp:false,unsafe_roles:0,memberships:0,owned_objects:0});
  });

  it("mantém INSERT legítimo da Story 3.2 sem EXECUTE nos validators e expõe diagnósticos exatos do trigger privado", async () => {
    const locator = `acl-compat:${randomUUID()}`;
    let legitimateInsertCompleted = false;
    await expect(appA.begin(async (tx) => {
      await tx`INSERT INTO src_import_staging_row
        (id,batch_id,locator,source_row_hash,normalized_payload,source_values,decimal_sources,status,field_errors,retain_until)
        VALUES (${randomUUID()},${preview.batchId},${locator},${hash64()},${tx.json({ codigo: "ACL-OK", valor: "1.00" })},${tx.json({ codigo: "ACL-OK", valor: "1.00" })},${tx.json({ valor: { source_text: "1.00", source_scale: 2, normalized_value: "1.00" } })},'valid',${tx.json([])},${preview.retainUntil})`;
      legitimateInsertCompleted = true;
      throw new Error("acl compatibility rollback");
    })).rejects.toThrow("acl compatibility rollback");
    expect(legitimateInsertCompleted).toBe(true);

    const invalidCases = [
      { constraint: 'src_import_staging_row_duration_sources_shape', normalizedPayload: { codigo: 'ACL-BAD' }, sourceValues: { codigo: 'ACL-BAD' }, decimalSources: {}, durationSources: { duracao: { source_text: 'bad', unit: 'clock' } }, matchingAttributes: {} },
      { constraint: 'src_import_staging_row_matching_attributes_shape', normalizedPayload: { codigo: 'ACL-BAD' }, sourceValues: { codigo: 'ACL-BAD' }, decimalSources: {}, durationSources: {}, matchingAttributes: { Curso: 'proibido' } },
      { constraint: 'src_import_staging_row_decimal_sources_canonical', normalizedPayload: { codigo: 'ACL-BAD' }, sourceValues: { codigo: 'ACL-BAD' }, decimalSources: { valor: { source_text: '1.00', source_scale: 2 } }, durationSources: {}, matchingAttributes: {} },
      { constraint: 'src_import_staging_row_payload_reserved_keys', normalizedPayload: { codigo: 'ACL-BAD', TRILHA: 'proibida' }, sourceValues: { codigo: 'ACL-BAD' }, decimalSources: {}, durationSources: {}, matchingAttributes: {} },
    ] as const;
    for (const invalid of invalidCases) {
      await expect(appA`INSERT INTO src_import_staging_row
        (id,batch_id,locator,source_row_hash,normalized_payload,source_values,decimal_sources,duration_sources,matching_attributes,status,field_errors,retain_until)
        VALUES (${randomUUID()},${preview.batchId},${`acl-invalid:${randomUUID()}`},${hash64()},${appA.json(invalid.normalizedPayload as never)},${appA.json(invalid.sourceValues as never)},${appA.json(invalid.decimalSources as never)},${appA.json(invalid.durationSources as never)},${appA.json(invalid.matchingAttributes as never)},'valid',${appA.json([])},${preview.retainUntil})`
      ).rejects.toMatchObject({code:'23514',constraint_name:invalid.constraint});
    }
  });

  it("persiste DUPLICATE_TARGET, bloqueia efeitos e aplica somente após resolver cada linha", async () => {
    const fixture = await duplicateFixture();
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf88-reconcile-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    expect(pending.reconciliation.lines.map((line) => line.conflict?.code)).toEqual(["DUPLICATE_TARGET", "DUPLICATE_TARGET"]);
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const rootBefore = await repository.findReconciliation(pending.reconciliation.id);
    const persisted = await admin<Array<{ code: string; candidate_ids: unknown }>>`SELECT code, candidate_ids FROM src_import_conflict WHERE reconciliation_id = ${pending.reconciliation.id} ORDER BY observation_id`;
    expect(persisted).toHaveLength(2);
    expect(persisted.every((conflict) => conflict.code === "DUPLICATE_TARGET")).toBe(true);
    const beforeBlockedApply = await tableCounts();
    await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, idempotencyKey: `story33-rf88-blocked-${pending.reconciliation.id}` })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID" });
    const afterBlockedApply = await tableCounts();
    expect(afterBlockedApply.events).toBe(beforeBlockedApply.events);
    expect(afterBlockedApply.projections).toBe(beforeBlockedApply.projections);
    expect(afterBlockedApply.applications).toBe(beforeBlockedApply.applications);

    const rejected = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "rf88:1", outcome: "reject", policyVersion: policy.version, rationale: "A primeira observação é rejeitada explicitamente.", version: "1" } });
    expect(rejected.status).toBe("needs-decision");
    expect(rejected.changedLines).toHaveLength(1);
    expect(rejected.changedLines[0].category).toBe("rejected");
    const beforePartialLeafApply = await tableCounts();
    await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: rejected.id, idempotencyKey: `story33-rf88-partial-leaf-${rejected.id}` })).rejects.toMatchObject({ code: "RECONCILIATION_INVALID" });
    expect(await tableCounts()).toEqual(beforePartialLeafApply);
    const resolved = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: rejected.id, decision: { observationId: pending.reconciliation.lines[1].observation.id, locator: "rf88:2", outcome: "link", stableRecordId: fixture.targetId, policyVersion: policy.version, rationale: "A segunda observação é o vínculo escolhido para o registro.", version: "1" } });
    expect(resolved.status).toBe("ready-to-apply");
    expect((resolved as typeof resolved & { decisionCount: number }).decisionCount).toBe(2);
    const decisionStorage = await admin<Array<{ id: string; manifest_size: number; delta_lines: number }>>`
      SELECT id::text, pg_column_size(manifest)::integer AS manifest_size,
        jsonb_array_length(manifest_delta->'lines')::integer AS delta_lines
      FROM src_reconciliation WHERE id IN (${rejected.id}, ${resolved.id}) ORDER BY revision_no`;
    expect(decisionStorage).toHaveLength(2);
    expect(decisionStorage.every((row) => row.manifest_size < 512)).toBe(true);
    expect(decisionStorage.map((row) => row.delta_lines)).toEqual([1, 1]);
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: resolved.id, idempotencyKey: `story33-rf88-apply-${resolved.id}` });
    const appliedInternal = await repository.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: resolved.id, idempotencyKey: `story33-rf88-apply-${resolved.id}` });
    expect(appliedInternal.events).toHaveLength(2);
    expect(appliedInternal.events.map((event) => event.type)).toEqual(expect.arrayContaining(["observation.accepted", "decision.audit"]));
    expect(appliedInternal.events.every((event) => event.recordId === fixture.targetId)).toBe(true);
    expect(await admin`SELECT count(*)::int AS count FROM src_effective_record_event WHERE reconciliation_id = ${resolved.id}`).toEqual([{ count: 2 }]);
    const rootAfter = await repository.findReconciliation(pending.reconciliation.id);
    expect(rootAfter).toEqual(rootBefore);
    const rootAbsences = await repository.listAbsences(pending.reconciliation.id, { page: 0, pageSize: 100 });
    expect(rootAbsences.total).toBe(String(rootAfter?.reconciliation.summary.absent));
    const [deltaRows] = await admin<Array<{ count: number }>>`SELECT count(*)::int AS count FROM src_reconciliation_absence WHERE reconciliation_id IN (${rejected.id}, ${resolved.id})`;
    expect(deltaRows.count).toBeLessThanOrEqual(4);
  });

  it("replay equivalente exige reopen canônico e rejeita policyVersion hostil antes da branch stale", async () => {
    const fixture = await freshFixture({ matchingAttributes: {} });
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const serviceA = new SourceReconciliationService(repository);
    const serviceB = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await serviceA.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `replay-absence-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const absences = await repository.listAbsences(pending.reconciliation.id, { page: 0, pageSize: 1 });
    const target = absences.absences[0]?.stableRecordId;
    if (!target) throw new Error("O replay de vínculo precisa de um alvo inicialmente ausente.");
    const line = pending.reconciliation.lines[0];
    const intent = { observationId: line.observation.id, locator: line.observation.locator, outcome: "link" as const, stableRecordId: target,
      policyVersion: policy.version, rationale: "Vincular o alvo ausente na corrida equivalente.", version: "1" };
    const receipts = await Promise.all([
      serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: intent }),
      serviceB.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: intent }),
    ]);
    const direct = receipts.find((receipt) => !receipt.reused);
    const replay = receipts.find((receipt) => receipt.reused);
    expect(direct?.absenceChanges).toEqual([{ stableRecordId: target, absent: false }]);
    expect(direct).toMatchObject({ canonicalReopenRequired: true });
    expect(replay).toMatchObject({ canonicalReopenRequired: true, absenceChanges: [], changedLines: [] });
    const canonicalAbsences = await repository.listAbsences(replay!.reconciliationId, { page: 0, pageSize: 100 });
    expect(canonicalAbsences.absences.map((item) => item.stableRecordId)).not.toContain(target);
    await expect(serviceA.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id,
      decision: { ...intent, policyVersion: "hostile-policy-v999" } })).rejects.toMatchObject({ code: "DECISION_INVALID" });
  });

  it("replay histórico de A após B exige reopen canônico da leaf completa", async () => {
    const fixture = await duplicateFixture();
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const root = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `replay-chain-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const lineA = root.reconciliation.lines[0];
    const lineB = root.reconciliation.lines[1];
    const intentA = { observationId: lineA.observation.id, locator: lineA.observation.locator, outcome: "reject" as const,
      policyVersion: policy.version, rationale: "Decisão A que será repetida após o avanço da leaf.", version: "1" };
    const l1 = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: root.reconciliation.id, decision: intentA });
    const intentB = { observationId: lineB.observation.id, locator: lineB.observation.locator, outcome: "link" as const, stableRecordId: fixture.targetId,
      policyVersion: policy.version, rationale: "Decisão B não relacionada que avança a leaf.", version: "1" };
    const l2 = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: l1.id, decision: intentB });
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: l2.id, idempotencyKey: `replay-chain-apply-${randomUUID()}` });
    const replay = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: root.reconciliation.id, decision: intentA });
    expect(replay).toMatchObject({ reused: true, reconciliationId: l2.id, status: "applied", summary: l2.summary, canonicalReopenRequired: true });
    expect(replay.changedLines).toEqual([]);
    expect(replay.absenceChanges).toEqual([]);
    const reopened = await service.reopenReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: replay.reconciliationId });
    expect(reopened).toMatchObject({ id: l2.id, status: "applied", summary: l2.summary, createdAt: l2.createdAt });
    expect(reopened.decisions).toEqual(expect.arrayContaining([l1.decision, l2.decision]));
  });

  it("recalcula o bucket K quando link induz DUPLICATE_TARGET", async () => {
    const fixture = await duplicateFixture(true);
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `rf140-induced-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const unresolved = pending.reconciliation.lines.find((line) => line.conflict?.code === "NO_CANDIDATE");
    if (!unresolved) throw new Error("A linha sem candidato não foi criada.");
    const intent = { observationId: unresolved.observation.id, locator: unresolved.observation.locator, outcome: "link" as const, stableRecordId: fixture.targetId,
      policyVersion: policy.version, rationale: "Induzir colisão explícita do bucket para testar K.", version: "1" };
    const receipts = await Promise.all([
      service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: intent }),
      new SourceReconciliationService(new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY)).recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: intent }),
    ]);
    const direct = receipts.find((receipt) => !receipt.reused);
    const replay = receipts.find((receipt) => receipt.reused);
    if (!direct || !replay) throw new Error("A corrida deve produzir um writer e um replay.");
    expect([direct.reused, replay.reused].sort()).toEqual([false, true]);
    expect(direct.changedLines).toHaveLength(2);
    expect(replay).toMatchObject({ canonicalReopenRequired: true, changedLines: [], absenceChanges: [] });
    expect(direct.changedLines.every((line) => line.category === "conflict" && line.conflict?.code === "DUPLICATE_TARGET")).toBe(true);
    expect(replay.changedLines.every((line) => line.category === "conflict" && line.conflict?.code === "DUPLICATE_TARGET")).toBe(true);
    expect(direct.summary.pendingDecisions).toBe(2);
    const [stored] = await admin<Array<{ count: number }>>`SELECT count(*)::int count FROM src_reconciliation_line_state WHERE reconciliation_id=${direct.id}`;
    expect(stored.count).toBe(2);
    const [leastPrivilege] = await admin<Array<{ migrator_temp: boolean; scratch_tables: number }>>`SELECT
      has_database_privilege('tria_migrator',current_database(),'TEMP') AS migrator_temp,
      (SELECT count(*)::int FROM pg_class WHERE relpersistence='t' AND relname LIKE 'decision_line_change%') AS scratch_tables`;
    expect(leastPrivilege).toEqual({ migrator_temp: false, scratch_tables: 0 });
  });

  it("reutiliza a leaf aplicada em replay por nova chave e rejeita decisões divergentes sem efeito", async () => {
    const fixture = await freshFixture({ matchingAttributes: {} });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf113-reconcile-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: pending.reconciliation.lines[0].observation.locator, outcome: "create", policyVersion: policy.version, rationale: "Criar identidade para a confirmação reaplicável.", version: "1" } });
    const applied = await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-rf113-apply-${decided.id}` });
    await admin`SET TIME ZONE '+14:00'`;
    const [zoneA]=await admin<Array<{hash:string}>>`SELECT source_reconciliation_event_hash(${decided.id})::text hash`;
    await admin`SET TIME ZONE '-11:00'`;
    const [zoneB]=await admin<Array<{hash:string}>>`SELECT source_reconciliation_event_hash(${decided.id})::text hash`;
    await admin`SET TIME ZONE 'UTC'`;
    expect(zoneA.hash).toBe(zoneB.hash);
    const [rootIdentity] = await admin<Array<{fingerprint:string;root_request_hash:string;decisions_hash:string}>>`SELECT root.fingerprint,root.root_request_hash,source_reconciliation_decision_set_hash(leaf.id)::text decisions_hash FROM src_reconciliation root JOIN src_reconciliation leaf ON leaf.id=${decided.id} WHERE root.id=${pending.reconciliation.id}`;
    const descendantAliasKey = `story33-root-fingerprint-leaf-${randomUUID()}`;
    const [descendantAlias] = await appA<Array<{ id: string }>>`SELECT alias_source_reconciliation_request(${descendantAliasKey},${rootIdentity.root_request_hash},${rootIdentity.decisions_hash},${decided.id},true)::text AS id`;
    expect(descendantAlias.id).toBe(decided.id);
    expect(await admin`SELECT fingerprint, reconciliation_id::text AS id FROM src_reconciliation_request WHERE operation='reconcile' AND idempotency_key=${descendantAliasKey}`).toEqual([{ fingerprint: rootIdentity.fingerprint, id: pending.reconciliation.id }]);
    const before = await tableCounts();
    const replay = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf113-replay-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy, decisions:[decided.decision] });
    expect(replay).toMatchObject({ reused: true, reconciliation: { id: applied.reconciliation.id, status: "applied" } });
    expect(await tableCounts()).toMatchObject({ ...before, requests: before.requests + 1 });
    await expect(service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf113-divergent-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy, decisions: [{ ...decided.decision, rationale: "ato divergente" }] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await tableCounts()).toEqual({ ...before, requests: before.requests + 1 });
  });

  it("replay de apply A autentica snapshot/ledger congelados após B alterar catálogo e métricas globais", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const keyA = `apply-a-${randomUUID()}`;
    const stableA = randomUUID();
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${stableA},${admin.json({ stable_key: keyA })},now())`;
    const fixtureA = await freshFixture({ matchingAttributes: { stable_key: keyA }, normalizedPayload: { codigo: keyA, valor: "11.00" }, decimalSources: { valor: { source_text: "11.00", source_scale: 2, normalized_value: "11.00" } } });
    const rootA = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `apply-a-root-${randomUUID()}`,
      confirmation: fixtureA.confirmation, preview: fixtureA.preview, policy: policyFor(fixtureA.preview) });
    expect(rootA.reconciliation.status).toBe("ready-to-apply");
    const applyKeyA = `apply-a-${randomUUID()}`;
    const appliedA = await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: rootA.reconciliation.id, idempotencyKey: applyKeyA });
    const keyB = `apply-b-${randomUUID()}`;
    const stableB = randomUUID();
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${stableB},${admin.json({ stable_key: keyB })},now())`;
    const fixtureB = await freshFixture({ matchingAttributes: { stable_key: keyB }, normalizedPayload: { codigo: keyB, valor: "97.25" }, decimalSources: { valor: { source_text: "97.25", source_scale: 2, normalized_value: "97.25" } } });
    const rootB = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `apply-b-root-${randomUUID()}`,
      confirmation: fixtureB.confirmation, preview: fixtureB.preview, policy: policyFor(fixtureB.preview) });
    expect(rootB.reconciliation.metrics).not.toEqual(rootA.reconciliation.metrics);
    const appliedB = await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: rootB.reconciliation.id, idempotencyKey: `apply-b-${randomUUID()}` });
    expect(BigInt(appliedB.projectionVersion)).toBeGreaterThan(BigInt(appliedA.projectionVersion));
    const replayA = await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: rootA.reconciliation.id, idempotencyKey: applyKeyA });
    expect(replayA).toMatchObject({ reused: true, projectionVersion: appliedA.projectionVersion, eventCount: appliedA.eventCount,
      reconciliation: { id: rootA.reconciliation.id, status: "applied", metrics: rootA.reconciliation.metrics } });
  });

  it("retorna a leaf aplicada em replay direto e nunca comunica sucesso para ID fantasma", async () => {
    const targetId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${targetId}, ${admin.json({ case_key: `direct-${targetId}` })}, now())`;
    const fixture = await freshFixture({ matchingAttributes: { case_key: `direct-${targetId}` } });
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const policy = policyFor(fixture.preview);
    const ready = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-direct-replay-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    expect(ready.reconciliation.status).toBe("ready-to-apply");
    expect(ready.reconciliation.decisions).toHaveLength(0);
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: ready.reconciliation.id, idempotencyKey: `story33-direct-replay-apply-${ready.reconciliation.id}` });
    const [stored] = await admin<Array<{ manifest: Record<string, unknown>; fingerprint: string; decisions_hash: string }>>`SELECT source_reconciliation_materialize_manifest(id) AS manifest, fingerprint, decisions_hash FROM src_reconciliation WHERE id = ${ready.reconciliation.id}`;
    const ghostId = randomUUID();
    const ghost = { ...stored.manifest, id: ghostId, fingerprint: stored.fingerprint };
    const aliasKey = `story33-direct-replay-alias-${randomUUID()}`;
    const [reused] = await appA<Array<{ reconciliation_id: string }>>`SELECT write_source_reconciliation('reconcile', ${appA.json({ reconciliation: ghost, fingerprint: stored.fingerprint, idempotencyKey: aliasKey, decisionsHash: stored.decisions_hash })})::text AS reconciliation_id`;
    expect(reused.reconciliation_id).toBe(ready.reconciliation.id);
    expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation WHERE id = ${ghostId}`).toEqual([{ count: 0 }]);
    expect(await admin`SELECT reconciliation_id::text FROM src_reconciliation_request WHERE operation='reconcile' AND idempotency_key=${aliasKey}`).toEqual([{ reconciliation_id: ready.reconciliation.id }]);
  });

  it("entrega busca de estáveis e ausências por páginas no contrato do repository", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const [latest] = await admin<Array<{ id: string }>>`SELECT id::text FROM src_reconciliation ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (!latest) throw new Error("A fixture precisa produzir uma reconciliação.");
    for (const literalQuery of ["%", "_", "\\"]) {
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, query: literalQuery, page: 0, pageSize: 1 })).resolves.toMatchObject({ page: 0, pageSize: 1 });
    }
    const stablePage = await repository.searchStableRecords({ reconciliationId: latest.id, page: 0, pageSize: 1 });
    expect(stablePage.records.length).toBeLessThanOrEqual(1);
    expect(BigInt(stablePage.total)).toBeGreaterThanOrEqual(BigInt(stablePage.records.length));
    if (stablePage.nextCursor && stablePage.records[0]) {
      const secondStablePage = await repository.searchStableRecords({ reconciliationId: latest.id, page: 1, pageSize: 1, cursor: stablePage.nextCursor });
      expect(secondStablePage.records[0]?.id).not.toBe(stablePage.records[0].id);
      expect(BigInt(secondStablePage.total)).toBeGreaterThanOrEqual(BigInt(stablePage.total));
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, query: "outra", page: 1, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/Cursor/);
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 2, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/Cursor/);
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 1, pageSize: 2, cursor: stablePage.nextCursor })).rejects.toThrow(/Cursor/);
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 1, pageSize: 1, cursor: `${stablePage.nextCursor}x` })).rejects.toThrow(/Cursor/);
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 0, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/primeira página/);
      await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 1, pageSize: 1 })).rejects.toThrow(/cursor da página anterior/);
      const [epochBefore] = await admin<Array<{ version: string }>>`SELECT version::text FROM src_projection_version WHERE singleton`;
      if (!epochBefore) throw new Error("Epoch de projeção ausente.");
      await admin`UPDATE src_projection_version SET version=version+1 WHERE singleton`;
      try {
        await expect(repository.searchStableRecords({ reconciliationId: latest.id, page: 1, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/projeção vigente/);
      } finally {
        await admin`UPDATE src_projection_version SET version=${epochBefore.version}::bigint WHERE singleton`;
      }
      await expect(repository.listAbsences(latest.id, { page: 1, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/Cursor/);
      const [otherLeaf] = await admin<Array<{ id: string }>>`SELECT leaf_reconciliation_id::text AS id FROM src_reconciliation_head WHERE leaf_reconciliation_id<>${latest.id} ORDER BY updated_at DESC LIMIT 1`;
      if (otherLeaf) await expect(repository.searchStableRecords({ reconciliationId: otherLeaf.id, page: 1, pageSize: 1, cursor: stablePage.nextCursor })).rejects.toThrow(/Cursor/);
    }
    const absencePage = await repository.listAbsences(latest.id, { page: 0, pageSize: 1 });
    expect(absencePage.absences.length).toBeLessThanOrEqual(1);
    expect(BigInt(absencePage.total)).toBeGreaterThanOrEqual(BigInt(absencePage.absences.length));
    if (BigInt(absencePage.total) > 1n) {
      const secondAbsencePage = await repository.listAbsences(latest.id, { page: 1, pageSize: 1, cursor: absencePage.nextCursor });
      expect(secondAbsencePage.absences.length).toBe(1);
      expect(secondAbsencePage.absences[0].stableRecordId).not.toBe(absencePage.absences[0]?.stableRecordId);
    }
  });

  it("pagina ausências históricas pelo manifesto, inclusive stable record sem projection", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const neverProjectedId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${neverProjectedId}, ${admin.json({ case_key: `absence-${neverProjectedId}` })}, now())`;
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-frozen-absence-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version, rationale: "Criar a observação mantendo a ausência histórica.", version: "1" } });
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-frozen-absence-apply-${decided.id}` });
    const collectAbsences = async () => {
      const first = await repository.listAbsences(decided.id, { page: 0, pageSize: 100 });
      const pages = [first];
      let cursor = first.nextCursor;
      for (let page = 1; cursor; page += 1) {
        const next = await repository.listAbsences(decided.id, { page, pageSize: 100, cursor: cursor });
        pages.push(next);
        cursor = next.nextCursor;
      }
      return { total: first.total, absences: pages.flatMap((item) => item.absences) };
    };
    const frozenBefore = await collectAbsences();
    expect(frozenBefore.absences.map((item) => item.stableRecordId)).toContain(neverProjectedId);
    expect(frozenBefore.absences.length).toBeGreaterThan(1);
    const heldFirstPage = await repository.listAbsences(decided.id, { page: 0, pageSize: 1 });
    expect(heldFirstPage.nextCursor).toBeTruthy();

    const laterFixture = await freshFixture();
    const laterPolicy = policyFor(laterFixture.preview);
    const laterPending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-frozen-absence-later-${randomUUID()}`, confirmation: laterFixture.confirmation, preview: laterFixture.preview, policy: laterPolicy });
    const laterDecided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: laterPending.reconciliation.id, decision: { observationId: laterPending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: laterPolicy.version, rationale: "Aplicação posterior não pode reescrever ausências antigas.", version: "1" } });
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: laterDecided.id, idempotencyKey: `story33-frozen-absence-later-apply-${laterDecided.id}` });

    const heldSecondPage = await repository.listAbsences(decided.id, { page: 1, pageSize: 1, cursor: heldFirstPage.nextCursor });
    expect(heldSecondPage.absences).toEqual([frozenBefore.absences[1]]);
    const frozenAfter = await collectAbsences();
    expect(frozenAfter).toEqual(frozenBefore);
    expect(await repository.findSnapshotByBatch(fixture.confirmation.batchId)).toMatchObject({ reconciliationId: decided.id, batchId: fixture.confirmation.batchId });
  });

  it("recusa ponteiros de projeção entre registros", async () => {
    const left = randomUUID(); const right = randomUUID(); const eventId = randomUUID();
    const [latest] = await admin<Array<{ id: string }>>`SELECT id::text FROM src_reconciliation ORDER BY created_at DESC LIMIT 1`;
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${left},'{}'::jsonb,now()),(${right},'{}'::jsonb,now())`;
    await admin`INSERT INTO src_effective_record_event(id,reconciliation_id,record_id,event_type,layer,payload,actor,occurred_at,version)
      VALUES(${eventId},${latest.id},${left},'adjustment.revised','adjustment','{}'::jsonb,'Rodrigo',now(),'cross-record')`;
    await expect(admin`INSERT INTO src_effective_record_projection(record_id,payload,adjustment_event_id,state,version,updated_at)
      VALUES(${right},'{}'::jsonb,${eventId},'active',1,now())`).rejects.toMatchObject({ code: "23514" });
    expect(await admin`SELECT record_id FROM src_effective_record_projection WHERE record_id=${right}`).toEqual([]);

    const fixture=await freshFixture();
    const repository=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const service=new SourceReconciliationService(repository);
    await admin`INSERT INTO src_effective_record_projection(record_id,payload,state,version,updated_at)
      VALUES(${right},'{}'::jsonb,'active',1,now())`;
    const before=await tableCounts();
    await admin`ALTER TABLE src_effective_record_projection DISABLE TRIGGER src_effective_projection_pointer_guard`;
    try{
      await admin`UPDATE src_effective_record_projection SET adjustment_event_id=${eventId} WHERE record_id=${right}`;
      await expect(admin`SELECT source_reconciliation_metrics('[]'::jsonb)`).rejects.toMatchObject({code:'XX001'});
      await expect(service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`invalid-unrelated-pointer-${randomUUID()}`,confirmation:fixture.confirmation,preview:fixture.preview,policy:policyFor(fixture.preview)}))
        .rejects.toMatchObject({code:'RECONCILIATION_INTEGRITY_FAILURE'});
      expect(await tableCounts()).toEqual(before);
    }finally{
      try{await admin`UPDATE src_effective_record_projection SET adjustment_event_id=NULL WHERE record_id=${right}`;}
      finally{await admin`ALTER TABLE src_effective_record_projection ENABLE TRIGGER src_effective_projection_pointer_guard`;}
    }
    expect(await admin`SELECT adjustment_event_id FROM src_effective_record_projection WHERE record_id=${right}`).toEqual([{adjustment_event_id:null}]);
  });

  it("preserva durationSources no evento, projeção, snapshot e reload", async () => {
    const fixture = await freshFixture({ durationSources: { duracao: { source_text: "59:59", unit: "clock" } } });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-rf118-reconcile-${fixture.preview.previewId}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version, rationale: "Criar identidade para preservar duração.", version: "1" } });
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-rf118-apply-${decided.id}` });
    const appliedInternal = await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-rf118-apply-${decided.id}` });
    const targetId = decided.changedLines[0].stableRecordId;
    expect(targetId).toEqual(expect.any(String));
    expect(appliedInternal.events[0]).toMatchObject({ durationSources: { duracao: { source_text: "59:59", unit: "clock" } } });
    expect(appliedInternal.projections.find((projection) => projection.recordId === targetId)).toMatchObject({ durationSources: { duracao: { source_text: "59:59", unit: "clock" } } });
    expect(appliedInternal.snapshot.projection.find((projection) => projection.recordId === targetId)).toMatchObject({ durationSources: { duracao: { source_text: "59:59", unit: "clock" } } });
    const reloaded = await new PostgresSourceReconciliationRepository(appB, TEST_CURSOR_KEY).listStableRecords();
    expect(reloaded.find((record) => record.id === targetId)).toMatchObject({ durationSources: { duracao: { source_text: "59:59", unit: "clock" } } });
  });

  it("preserva metadata ausente separada de mapa explicitamente vazio no ledger", async () => {
    const [latest] = await admin<Array<{ id: string }>>`SELECT id::text FROM src_reconciliation ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (!latest) throw new Error("A fixture precisa produzir uma reconciliação.");
    const absentRecordId = randomUUID();
    const emptyRecordId = randomUUID();
    const absentObservationId = randomUUID();
    const emptyObservationId = randomUUID();
    const absentEventId = randomUUID();
    const emptyEventId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES
        (${absentRecordId}, ${tx.json({ metadata_key: "absent" })}, now()),
        (${emptyRecordId}, ${tx.json({ metadata_key: "empty" })}, now())`;
      await tx`INSERT INTO src_source_observation
        (id, batch_id, preview_id, source_file_id, locator, source_row_hash, functional_hash, normalized_payload, source_values, decimal_sources, duration_sources, matching_attributes, observed_at)
        VALUES
        (${absentObservationId}, ${preview.batchId}, ${preview.previewId}, ${preview.sourceFileId}, 'metadata:absent', ${hash64()}, ${hash64()}, '{}'::jsonb, '{}'::jsonb, NULL, NULL, '{}'::jsonb, now()),
        (${emptyObservationId}, ${preview.batchId}, ${preview.previewId}, ${preview.sourceFileId}, 'metadata:empty', ${hash64()}, ${hash64()}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())`;
      await tx`INSERT INTO src_effective_record_event
        (id, reconciliation_id, record_id, observation_id, event_type, layer, payload, decimal_sources, duration_sources, actor, occurred_at, version)
        VALUES
        (${absentEventId}, ${latest.id}, ${absentRecordId}, ${absentObservationId}, 'observation.accepted', 'source', '{}'::jsonb, NULL, NULL, 'Rodrigo', now(), 'metadata-absent'),
        (${emptyEventId}, ${latest.id}, ${emptyRecordId}, ${emptyObservationId}, 'observation.accepted', 'source', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Rodrigo', now(), 'metadata-empty')`;
      await tx`INSERT INTO src_effective_record_projection
        (record_id, payload, decimal_sources, duration_sources, source_observation_id, observed_batch_id, state, version, updated_at)
        VALUES
        (${absentRecordId}, '{}'::jsonb, NULL, NULL, ${absentObservationId}, ${preview.batchId}, 'active', 1, now()),
        (${emptyRecordId}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, ${emptyObservationId}, ${preview.batchId}, 'active', 1, now())`;
    });
    const stored = await admin<Array<{ locator: string; decimal_sources: unknown; duration_sources: unknown }>>`SELECT locator, decimal_sources, duration_sources FROM src_source_observation WHERE id IN (${absentObservationId}, ${emptyObservationId}) ORDER BY locator`;
    expect(stored).toEqual([
      { locator: "metadata:absent", decimal_sources: null, duration_sources: null },
      { locator: "metadata:empty", decimal_sources: {}, duration_sources: {} },
    ]);
    const hydrated = await new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY).listStableRecords();
    const absent = hydrated.find((record) => record.id === absentRecordId);
    const empty = hydrated.find((record) => record.id === emptyRecordId);
    expect(absent).not.toHaveProperty("decimalSources");
    expect(absent).not.toHaveProperty("durationSources");
    expect(empty).toMatchObject({ decimalSources: {}, durationSources: {} });
  });

  it("rejeita Curso/TRILHA sem distinção de caixa e provenance com propriedades numéricas extras", async () => {
    const forbiddenRecordId = randomUUID();
    await expect(admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${forbiddenRecordId}, ${admin.json({ Curso: "segredo" })}, now())`).rejects.toMatchObject({ code: "23514" });
    await expect(admin`INSERT INTO src_source_observation
      (id, batch_id, preview_id, source_file_id, locator, source_row_hash, functional_hash, normalized_payload, source_values, decimal_sources, duration_sources, matching_attributes, observed_at)
      VALUES (${randomUUID()}, ${preview.batchId}, ${preview.previewId}, ${preview.sourceFileId}, 'reserved:case', ${hash64()}, ${hash64()}, ${admin.json({ TRILHA: "privada" })}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())`).rejects.toMatchObject({ code: "23514" });
    const [validation] = await admin<Array<{ extra_numeric: boolean; reserved_decimal: boolean; reserved_duration: boolean }>>`SELECT
      source_reconciliation_valid_decimal_sources(${admin.json({ valor: { source_text: "0.0000001", source_scale: 7, normalized_value: "0.0000001", extra: 1e-7 } })}) AS extra_numeric,
      source_reconciliation_valid_decimal_sources(${admin.json({ Curso: { source_text: "1.00", source_scale: 2, normalized_value: "1.00" } })}) AS reserved_decimal,
      source_reconciliation_valid_duration_sources(${admin.json({ TRILHA: { source_text: "10", unit: "minutes" } })}) AS reserved_duration`;
    expect(validation).toEqual({ extra_numeric: false, reserved_decimal: false, reserved_duration: false });
  });

  it("rejeita canonical JSON e provenance fora do subconjunto exato", async () => {
    await expect(admin`SELECT source_reconciliation_jcs('1e-7'::jsonb)`).rejects.toMatchObject({ code: "22023" });
    await expect(admin`SELECT source_reconciliation_jcs(${admin.json({ "á": 1 })})`).rejects.toMatchObject({ code: "22023" });
    const [shape] = await admin<Array<{ bad_decimal: boolean; bad_fraction: boolean; bad_minutes: boolean; bad_clock: boolean }>>`SELECT
      source_reconciliation_valid_decimal_sources(${admin.json({ value: { source_text: "NaN", source_scale: 2, normalized_value: "NaN" } })}) AS bad_decimal,
      source_reconciliation_valid_decimal_sources(${admin.json({ value: { source_text: "1.234", source_scale: 2, normalized_value: "1.234" } })}) AS bad_fraction,
      source_reconciliation_valid_duration_sources(${admin.json({ value: { source_text: "1.5", unit: "minutes" } })}) AS bad_minutes,
      source_reconciliation_valid_duration_sources(${admin.json({ value: { source_text: "1:60", unit: "clock" } })}) AS bad_clock`;
    expect(shape).toEqual({ bad_decimal: false, bad_fraction: false, bad_minutes: false, bad_clock: false });
  });

  it("não transforma uma linha válida sem atributo estável em candidatos universais", async () => {
    const now = new Date().toISOString();
    const sourceRow = preview.rows[0];
    const withReference = {
      ...structuredClone(sourceRow), locator: "browser:with-reference", sourceRowHash: hash64(),
      normalizedPayload: { codigo: "BROWSER-REF", referencia: "RF-REGRESSION", data: "2026-01-01", valor: "10.50" },
      sourceValues: { codigo: "BROWSER-REF", referencia: "RF-REGRESSION", data: "2026-01-01", valor: "10.50" },
      matchingAttributes: { referencia: "RF-REGRESSION" }, durationSources: {},
    };
    const withoutReference = {
      ...structuredClone(sourceRow), locator: "browser:without-reference", sourceRowHash: hash64(),
      normalizedPayload: { codigo: "BROWSER-NONE", data: "2026-01-01", valor: "11.00" },
      sourceValues: { codigo: "BROWSER-NONE", data: "2026-01-01", valor: "11.00" },
      matchingAttributes: {}, durationSources: {},
    };
    const rowResultHash = hash64();
    const candidate: Preview = {
      ...structuredClone(preview), previewId: randomUUID(), batchId: randomUUID(),
      contentHash: hash64(), rowResultHash, previewHash: hash64(), preparedAt: now,
      rows: [withReference, withoutReference],
      summary: { ...preview.summary, found: 2, valid: 2, withError: 0, rejected: 0, rowResultHash },
    };
    const prepared = (await new PostgresImportPreparationRepository(appA).savePrepared({
      preview: candidate, fingerprint: hash64(), idempotencyKey: `story33-browser-shape-prepare-${candidate.previewId}`, requestId: randomUUID(),
    })).preview;
    const candidateConfirmation: PreviewConfirmation = {
      sourceFormat: prepared.sourceFormat, contentHash: prepared.contentHash, rowResultHash: prepared.rowResultHash,
      confirmationId: randomUUID(), previewId: prepared.previewId, batchId: prepared.batchId, sourceFileId: prepared.sourceFileId, fileVersionId: prepared.fileVersionId,
      sourceSha256: prepared.sourceSha256, contractHash: prepared.contractHash, transformationHash: prepared.transformationHash, previewHash: prepared.previewHash,
      confirmedAt: new Date(Date.parse(now) + 1000).toISOString(), actor: "Rodrigo", status: "confirmed", reused: false,
    };
    const confirmed = (await new PostgresImportPreparationRepository(appA).saveConfirmation({
      confirmation: candidateConfirmation, payloadFingerprint: hash64(), idempotencyKey: `story33-browser-shape-confirm-${prepared.previewId}`, requestId: randomUUID(),
    })).confirmation;
    const targetId = randomUUID();
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${targetId}, ${admin.json({ referencia: "RF-REGRESSION" })}, ${now})`;

    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const result = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-browser-shape-reconcile-${prepared.previewId}`, confirmation: confirmed, preview: prepared, policy: policyFor(prepared) });
    expect(result.reconciliation.lines).toMatchObject([
      { category: "updated", stableRecordId: targetId, match: { outcome: "unique", candidateIds: [targetId], matchedRecordId: targetId } },
      { category: "conflict", match: { outcome: "none", candidateIds: [] }, conflict: { code: "NO_CANDIDATE", candidateIds: [] } },
    ]);
  });

  it("serializa versão bigint da projection no snapshot como string exata", async () => {
    const hugeRecordId = randomUUID();
    const hugeVersion = "9007199254740993";
    await admin`INSERT INTO src_stable_record (id, matching_attributes, created_at) VALUES (${hugeRecordId}, ${admin.json({ huge_version: hugeVersion })}, now())`;
    await admin`INSERT INTO src_effective_record_projection (record_id, payload, state, version, updated_at) VALUES (${hugeRecordId}, '{}'::jsonb, 'active', ${hugeVersion}::bigint, now())`;
    const fixture = await freshFixture();
    const policy = policyFor(fixture.preview);
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-bigint-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id, decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "create", policyVersion: policy.version, rationale: "Criar registro para capturar snapshot com bigint alto.", version: "1" } });
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `story33-bigint-apply-${decided.id}` });
    const [captured] = await admin<Array<{ version: string; kind: string }>>`SELECT item->>'version' AS version, jsonb_typeof(item->'version') AS kind
      FROM src_effective_snapshot snapshot, jsonb_array_elements(snapshot.projection) item
      WHERE snapshot.reconciliation_id=${decided.id} AND item->>'record_id'=${hugeRecordId}`;
    expect(captured).toEqual({ version: hugeVersion, kind: "string" });
  });

  it("recusa leaf chain-v3 adulterada antes de qualquer efeito", async () => {
    const fixture = await freshFixture();
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `tamper-root-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id,
      decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "reject", policyVersion: policy.version, rationale: "Decisão canônica antes do tamper.", version: "1" } });
    await admin`INSERT INTO src_reconciliation_decision
      (id,reconciliation_id,preview_id,batch_id,source_file_id,lineage_id,observation_id,locator,stable_record_id,outcome,actor,decided_at,policy_version,rationale,version,revision_no)
      SELECT ${randomUUID()},reconciliation_id,preview_id,batch_id,source_file_id,lineage_id,observation_id,locator,stable_record_id,outcome,actor,decided_at,policy_version,'rationale adulterada',version,revision_no+1
      FROM src_reconciliation_decision WHERE reconciliation_id=${decided.id} ORDER BY revision_no DESC LIMIT 1`;
    const before = await tableCounts();
    await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decided.id, idempotencyKey: `tamper-apply-${randomUUID()}` })).rejects.toMatchObject({ code: "RECONCILIATION_INTEGRITY_FAILURE" });
    const after = await tableCounts();
    expect(after.events).toBe(before.events); expect(after.projections).toBe(before.projections); expect(after.applications).toBe(before.applications);
  });

  it("atualiza acumuladores métricos exatos somente para o target afetado", async () => {
    const targetId = randomUUID();
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${targetId},${admin.json({ metric_key: targetId })},now())`;
    await admin`INSERT INTO src_effective_record_projection(record_id,payload,decimal_sources,duration_sources,state,version,updated_at)
      VALUES(${targetId},${admin.json({ codigo: "old" })},${admin.json({ rf140_decimal: { source_text: "1.230000", source_scale: 6, normalized_value: "1.230000" }, rf140_null: { source_text: "", source_scale: 6, normalized_value: null } })},${admin.json({ rf140_duration: { source_text: "10", unit: "minutes" } })},'active',1,now())`;
    const fixture = await freshFixture({ matchingAttributes: {}, normalizedPayload: { codigo: "new" },
      decimalSources: { rf140_decimal: { source_text: "2.50", source_scale: 2, normalized_value: "2.50" }, rf140_null: { source_text: "", source_scale: 2, normalized_value: null } },
      durationSources: { rf140_duration: { source_text: "01:00", unit: "clock" } } });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const policy = policyFor(fixture.preview);
    const pending = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `rf140-metric-${randomUUID()}`, confirmation: fixture.confirmation, preview: fixture.preview, policy });
    const decided = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pending.reconciliation.id,
      decision: { observationId: pending.reconciliation.lines[0].observation.id, locator: "row:2", outcome: "link", stableRecordId: targetId,
        policyVersion: policy.version, rationale: "Substituir somente a contribuição métrica do alvo escolhido.", version: "1" } });
    expect(decided.changedLines[0].fieldDiffs).toEqual(expect.arrayContaining([
      { field: "codigo", original: "old", proposed: "new", originalPresent: true, proposedPresent: true, layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
      { field: "rf140_decimal", original: '{"normalized_value":"1.230000","source_scale":6,"source_text":"1.230000"}', proposed: '{"normalized_value":"2.50","source_scale":2,"source_text":"2.50"}', originalPresent: true, proposedPresent: true, provenanceKind: "decimal-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
      { field: "rf140_null", original: '{"normalized_value":null,"source_scale":6,"source_text":""}', proposed: '{"normalized_value":null,"source_scale":2,"source_text":""}', originalPresent: true, proposedPresent: true, provenanceKind: "decimal-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
      { field: "rf140_duration", original: '{"source_text":"10","unit":"minutes"}', proposed: '{"source_text":"01:00","unit":"clock"}', originalPresent: true, proposedPresent: true, provenanceKind: "duration-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
    ]));
    expect(decided.metrics?.decimalSums).toMatchObject({ rf140_decimal: "2.50", rf140_null: "0" });
    expect(decided.metrics?.durationSums).toMatchObject({ rf140_duration: "60" });
    const [head] = await admin<Array<{ accumulator: { decimal: Record<string, { sourceCount: number; nonnullCount: number; scaleCounts: Record<string,string> }> } }>>`SELECT accumulator FROM src_reconciliation_metric_head WHERE lineage_id=${pending.reconciliation.id}`;
    expect(head.accumulator.decimal.rf140_decimal).toMatchObject({ sourceCount: 1, nonnullCount: 1, scaleCounts: { "2": 1 } });
    expect(head.accumulator.decimal.rf140_null).toMatchObject({ sourceCount: 1, nonnullCount: 0, scaleCounts: {} });
  });

  it("persiste somente o delta físico de uma decisão", async () => {
    const fixture=await freshFixture({matchingAttributes:{}}),service=new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY)),policy=policyFor(fixture.preview);
    const root=await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`delta-root-${randomUUID()}`,confirmation:fixture.confirmation,preview:fixture.preview,policy});
    const receipt=await service.recordDecision({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:root.reconciliation.id,decision:{observationId:root.reconciliation.lines[0].observation.id,locator:root.reconciliation.lines[0].observation.locator,outcome:'reject',policyVersion:policy.version,rationale:'Persistir somente esta linha alterada.',version:'1'}});
    const [physical]=await admin<Array<{lines:number;decisions:number;delta_bytes:number}>>`SELECT (SELECT count(*)::int FROM src_reconciliation_line_state WHERE reconciliation_id=r.id) lines,(SELECT count(*)::int FROM src_reconciliation_decision WHERE reconciliation_id=r.id) decisions,octet_length(r.manifest_delta::text)::int delta_bytes FROM src_reconciliation r WHERE r.id=${receipt.id}`;
    expect(physical).toMatchObject({lines:1,decisions:1});
    expect(physical.delta_bytes).toBeLessThan(4096);
  });

  it("pagina a AVL de 10.026 ausências com completude, história, path-copy e visitas mensuráveis", async () => {
    const [catalog] = await admin<Array<{count:number}>>`SELECT count(*)::int count FROM src_stable_record r LEFT JOIN src_effective_record_projection p ON p.record_id=r.id WHERE coalesce(p.state,r.state)='active'`;
    const missing = Math.max(0, 10_026 - catalog.count);
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at)
      SELECT overlay(overlay(md5('avl-stable-'||g::text) placing '4' from 13) placing '8' from 17)::uuid,jsonb_build_object('stable_key','avl-'||g::text),now()
      FROM generate_series(1,${missing}) g ON CONFLICT DO NOTHING`;
    const fixture=await freshFixture();
    const repository=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const service=new SourceReconciliationService(repository);
    const root=await service.reconcileConfirmedPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:`avl-root-${randomUUID()}`,confirmation:fixture.confirmation,preview:fixture.preview,policy:policyFor(fixture.preview)});
    largeHistoricalId=root.reconciliation.id;
    const [anchor]=await admin<Array<{absence_count:string;height:number;node_count:string;root_id:string}>>`SELECT r.absence_count::text,n.height,(SELECT count(*)::text FROM src_reconciliation_absence_node x WHERE x.lineage_id=r.id) node_count,r.absence_root_id::text root_id FROM src_reconciliation r JOIN src_reconciliation_absence_node n ON n.id=r.absence_root_id WHERE r.id=${largeHistoricalId}`;
    expect(anchor.absence_count).toBe('10026');
    expect(anchor.height).toBeLessThanOrEqual(Math.ceil(Math.log2(Number(anchor.absence_count)+1))+1);
    expect(anchor.node_count).toBe(anchor.absence_count);
    largeHeight=anchor.height;largeRootNodeId=anchor.root_id;
    const committed=(await admin<Array<{id:string}>>`SELECT stable_record_id::text id FROM src_reconciliation_absence_node WHERE lineage_id=${largeHistoricalId} AND created_revision=1 ORDER BY stable_record_id`).map((row)=>row.id);
    expect(committed).toHaveLength(10_026);

    type DiagnosticPage={items:Array<{stableRecordId:string}>;total_count:string;has_more:boolean;logical_node_visits:number;authenticated_node_row_reads:number;tree_height:number};
    const readPage=async(id:string,after:string|null,limit:number)=>{
      const [result]=await appA<Array<DiagnosticPage>>`SELECT * FROM source_reconciliation_absence_page(${id},${after}::uuid,${limit})`;
      expect(result.tree_height).toBeGreaterThanOrEqual(0);
      expect(result.logical_node_visits).toBeLessThanOrEqual(2*result.tree_height+limit+1);
      expect(result.authenticated_node_row_reads).toBeGreaterThanOrEqual(result.logical_node_visits);
      expect(result.authenticated_node_row_reads).toBeLessThanOrEqual(3*result.logical_node_visits);
      expect(result.authenticated_node_row_reads).toBeLessThanOrEqual(3*(2*result.tree_height+limit+1));
      return result;
    };
    const first=await readPage(largeHistoricalId,null,1);
    expect(first.items.map((item)=>item.stableRecordId)).toEqual([committed[0]]);expect(first.has_more).toBe(true);
    expect(first.authenticated_node_row_reads).toBeGreaterThan(first.logical_node_visits);
    const middleCursor=committed[Math.floor(committed.length/2)];
    const middle=await readPage(largeHistoricalId,middleCursor,1);
    expect(middle.items.map((item)=>item.stableRecordId)).toEqual([committed[Math.floor(committed.length/2)+1]]);
    const nearEnd=await readPage(largeHistoricalId,committed.at(-2)!,1);
    expect(nearEnd.items.map((item)=>item.stableRecordId)).toEqual([committed.at(-1)!]);
    expect(nearEnd.logical_node_visits).toBeLessThanOrEqual(nearEnd.tree_height+2);
    expect(nearEnd.authenticated_node_row_reads).toBeLessThanOrEqual(3*(nearEnd.tree_height+2));
    const afterLast=await readPage(largeHistoricalId,committed.at(-1)!,1);
    expect(afterLast).toMatchObject({items:[],has_more:false,total_count:'10026'});
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${largeHistoricalId},${randomUUID()}::uuid,1)`).rejects.toMatchObject({code:'XX001'});

    const readAll=async(id:string,expectedTotal:number)=>{
      const ids:string[]=[];let cursor:string|null=null;let pageNo=0;
      while(true){
        const page=await readPage(id,cursor,100);ids.push(...page.items.map((item)=>item.stableRecordId));
        expect(page.total_count).toBe(String(expectedTotal));
        if(!page.has_more)break;
        cursor=page.items.at(-1)!.stableRecordId;pageNo+=1;expect(pageNo).toBeLessThan(200);
      }
      expect(new Set(ids).size).toBe(ids.length);return ids;
    };
    expect(await readAll(largeHistoricalId,10_026)).toEqual(committed);

    const [definitions]=await admin<Array<{inner_definition:string;outer_definition:string;anchor_definition:string}>>`SELECT pg_get_functiondef('source_reconciliation_absence_rows(uuid,uuid,integer)'::regprocedure) inner_definition,pg_get_functiondef('source_reconciliation_absence_page(uuid,uuid,integer)'::regprocedure) outer_definition,pg_get_functiondef('source_reconciliation_verify_absence_anchor(uuid)'::regprocedure) anchor_definition`;
    expect(definitions.inner_definition.match(/cursor\s*:=\s*rec\.absence_root_id/gi)).toHaveLength(1);
    expect(definitions.inner_definition).toContain('source_reconciliation_avl_load_verified_node');
    expect(definitions.inner_definition).toMatch(/\bIF\s+emitted\s*>=\s*p_limit\s+THEN\b/i);
    expect(definitions.inner_definition).not.toMatch(/OFFSET|src_reconciliation_absence_(?:head|span|key)/i);
    expect(definitions.outer_definition).toContain('MATERIALIZED');
    expect(definitions.anchor_definition.match(/source_reconciliation_avl_load_verified_node/gi)).toHaveLength(1);
    expect(definitions.anchor_definition).toMatch(/n\s*:=\s*source_reconciliation_avl_load_verified_node/i);
    expect(definitions.anchor_definition).not.toMatch(/SELECT\s+\*\s+INTO\s+n\s+FROM\s+public\.src_reconciliation_absence_node/i);
    const lookupPlan=await admin.unsafe<Array<Record<string,unknown>>>(`EXPLAIN (FORMAT JSON) SELECT * FROM src_reconciliation_absence_node WHERE lineage_id='${largeHistoricalId}'::uuid AND id='${largeRootNodeId}'::uuid`);
    const lookupPlanText=JSON.stringify(lookupPlan);
    expect(lookupPlanText).toMatch(/Index Scan|Index Only Scan/);expect(lookupPlanText).not.toContain('Seq Scan');

    const beforeNodes=BigInt(anchor.node_count);
    const target=committed[Math.floor(committed.length/2)];
    const line=root.reconciliation.lines[0];
    const child=await service.recordDecision({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:largeHistoricalId,decision:{observationId:line.observation.id,locator:line.observation.locator,stableRecordId:target,outcome:'link',policyVersion:root.reconciliation.policy.version,rationale:'Provar path-copy AVL grande com um único delta.',version:'1'}});
    largeCurrentId=child.id;
    const [growth]=await admin<Array<{node_count:string;root_id:string;absence_count:string}>>`SELECT (SELECT count(*)::text FROM src_reconciliation_absence_node n WHERE n.lineage_id=${largeHistoricalId}) node_count,absence_root_id::text root_id,absence_count::text FROM src_reconciliation WHERE id=${largeCurrentId}`;
    expect(growth.absence_count).toBe('10025');expect(growth.root_id).not.toBe(largeRootNodeId);
    expect(BigInt(growth.node_count)-beforeNodes).toBeLessThanOrEqual(BigInt(4*largeHeight+4));
    const currentIds=committed.filter((id)=>id!==target);
    expect(await readAll(largeCurrentId,10_025)).toEqual(currentIds);
    expect(await readAll(largeHistoricalId,10_026)).toEqual(committed);
    const historicalTarget=await readPage(largeHistoricalId,committed[committed.indexOf(target)-1]??null,2);
    expect(historicalTarget.items.some((item)=>item.stableRecordId===target)).toBe(true);
    const currentAround=await readPage(largeCurrentId,committed[committed.indexOf(target)-1]??null,2);
    expect(currentAround.items.some((item)=>item.stableRecordId===target)).toBe(false);
    await expect(admin`SELECT source_reconciliation_verify_absence_anchor(${largeHistoricalId}),source_reconciliation_verify_absence_anchor(${largeCurrentId})`).resolves.toHaveLength(1);

    const [sparseHistorical]=await appA<Array<DiagnosticPage>>`SELECT * FROM source_reconciliation_absence_page(${sparseHistoricalId},NULL::uuid,1)`;
    const [sparseCurrent]=await appA<Array<DiagnosticPage>>`SELECT * FROM source_reconciliation_absence_page(${sparseCurrentId},NULL::uuid,1)`;
    expect(sparseHistorical).toMatchObject({total_count:'1',logical_node_visits:2,authenticated_node_row_reads:2,tree_height:1});expect(sparseCurrent).toMatchObject({items:[],total_count:'0',logical_node_visits:0,authenticated_node_row_reads:0,tree_height:0});
    console.info(JSON.stringify({benchmark:'authenticated-absence-avl',absences:anchor.absence_count,height:anchor.height,nodeCount:anchor.node_count,nearEndLimit1LogicalNodeVisits:nearEnd.logical_node_visits,nearEndLimit1AuthenticatedNodeRowReads:nearEnd.authenticated_node_row_reads}));
  },120_000);

  it("falha fechado para a matriz de adulteração da autoridade AVL", async () => {
    type NodeSnapshot={id:string;lineage_id:string;stable_record_id:string;item:Record<string,unknown>;left_id:string|null;right_id:string|null;height:number;subtree_count:string;subtree_min:string;subtree_max:string;node_hash:string;created_revision:string};
    const repository=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const [saved]=await admin<Array<NodeSnapshot>>`SELECT id::text,lineage_id::text,stable_record_id::text,item,left_id::text,right_id::text,height,subtree_count::text,subtree_min::text,subtree_max::text,encode(node_hash,'hex') node_hash,created_revision::text FROM src_reconciliation_absence_node WHERE id=${largeRootNodeId}`;
    if(!saved.left_id||!saved.right_id)throw new Error('A raiz AVL grande deve ter os dois filhos.');
    const [savedChild]=await admin<Array<NodeSnapshot>>`SELECT id::text,lineage_id::text,stable_record_id::text,item,left_id::text,right_id::text,height,subtree_count::text,subtree_min::text,subtree_max::text,encode(node_hash,'hex') node_hash,created_revision::text FROM src_reconciliation_absence_node WHERE id=${saved.left_id}`;
    const restoreNode=async(node:NodeSnapshot)=>{await admin`INSERT INTO src_reconciliation_absence_node(id,lineage_id,stable_record_id,item,left_id,right_id,height,subtree_count,subtree_min,subtree_max,node_hash,created_revision)
      VALUES(${node.id},${node.lineage_id},${node.stable_record_id},${admin.json(node.item as never)},${node.left_id},${node.right_id},${node.height},${node.subtree_count}::bigint,${node.subtree_min},${node.subtree_max},decode(${node.node_hash},'hex'),${node.created_revision}::bigint)
      ON CONFLICT(id) DO UPDATE SET item=excluded.item,left_id=excluded.left_id,right_id=excluded.right_id,height=excluded.height,subtree_count=excluded.subtree_count,subtree_min=excluded.subtree_min,subtree_max=excluded.subtree_max,node_hash=excluded.node_hash`;};
    const assertCorrupt=async()=>{
      await expect(appA`SELECT * FROM source_reconciliation_absence_page(${largeHistoricalId},NULL::uuid,1)`).rejects.toMatchObject({code:'XX001'});
      await expect(repository.listAbsences(largeHistoricalId,{page:0,pageSize:1})).rejects.toMatchObject({code:'RECONCILIATION_INTEGRITY_FAILURE'});
    };
    const mutations=[
      ["item",`UPDATE src_reconciliation_absence_node SET item=jsonb_set(item,'{label}','"adulterado"'::jsonb) WHERE id='${saved.id}'::uuid`],
      ["node_hash",`UPDATE src_reconciliation_absence_node SET node_hash=decode('${'00'.repeat(32)}','hex') WHERE id='${saved.id}'::uuid`],
      ["height",`UPDATE src_reconciliation_absence_node SET height=height+1 WHERE id='${saved.id}'::uuid`],
      ["count",`UPDATE src_reconciliation_absence_node SET subtree_count=subtree_count+1 WHERE id='${saved.id}'::uuid`],
      ["min",`UPDATE src_reconciliation_absence_node SET subtree_min=stable_record_id WHERE id='${saved.id}'::uuid`],
      ["max",`UPDATE src_reconciliation_absence_node SET subtree_max=stable_record_id WHERE id='${saved.id}'::uuid`],
      ["swapped children",`UPDATE src_reconciliation_absence_node SET left_id=right_id,right_id=left_id WHERE id='${saved.id}'::uuid`],
      ["severed child",`UPDATE src_reconciliation_absence_node SET left_id=NULL WHERE id='${saved.id}'::uuid`],
    ] as const;
    await admin`ALTER TABLE src_reconciliation_absence_node DISABLE TRIGGER src_reconciliation_absence_node_immutable`;
    try{
      for(const [,statement] of mutations){try{await admin.unsafe(statement);await assertCorrupt();}finally{await restoreNode(saved);}}
    }finally{await admin`ALTER TABLE src_reconciliation_absence_node ENABLE TRIGGER src_reconciliation_absence_node_immutable`;}

    await admin`ALTER TABLE src_reconciliation DISABLE TRIGGER src_reconciliation_immutable`;
    try{
      await admin`UPDATE src_reconciliation SET absence_root_id=${saved.left_id} WHERE id=${largeHistoricalId}`;
      await assertCorrupt();
    }finally{
      await admin`UPDATE src_reconciliation SET absence_root_id=${saved.id} WHERE id=${largeHistoricalId}`;
      await admin`ALTER TABLE src_reconciliation ENABLE TRIGGER src_reconciliation_immutable`;
    }

    await admin`ALTER TABLE src_reconciliation_absence_node DISABLE TRIGGER ALL`;
    try{
      await admin`DELETE FROM src_reconciliation_absence_node WHERE id=${savedChild.id}`;
      try{await assertCorrupt();}finally{await restoreNode(savedChild);}
      await admin`DELETE FROM src_reconciliation_absence_node WHERE id=${saved.id}`;
      try{await assertCorrupt();}finally{await restoreNode(saved);}
    }finally{await admin`ALTER TABLE src_reconciliation_absence_node ENABLE TRIGGER ALL`;}
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${largeHistoricalId},NULL::uuid,1)`).resolves.toHaveLength(1);
  },60_000);

  it("mantém paridade de busca entre memória e PostgreSQL sem campos arbitrários", async () => {
    const ids=Array.from({length:5},()=>randomUUID());
    const records:StableRecord[]=[
      {id:ids[0],matchingAttributes:{Special_Key:'Attr-MiXeD'},sourcePayload:{codigo:'ALLOW%PERCENT',valor:'PAGE-PARITY',note:'private-a'}},
      {id:ids[1],matchingAttributes:{another:'other'},sourcePayload:{referencia:'UNDER_SCORE',data:'2026\\PATH',valor:'PAGE-PARITY',arbitrary:'private-b'}},
      {id:ids[2],matchingAttributes:{duration_key:'duration-value'},sourcePayload:{duracao:'DURATION-UNIQUE',valor:'PAGE-PARITY'}},
      {id:ids[3],state:'disregarded',matchingAttributes:{hidden:'DISREGARDED-UNIQUE'},sourcePayload:{valor:'DISREGARDED-UNIQUE'}},
      {id:ids[4],matchingAttributes:{distractor:'plain'},sourcePayload:{codigo:'ALLOWXPERCENT',referencia:'UNDERXSCORE',data:'2026XPATH',valor:'not-page'}},
    ];
    for(const record of records){
      await admin`INSERT INTO src_stable_record(id,state,matching_attributes,created_at) VALUES(${record.id},${record.state??'active'},${admin.json(record.matchingAttributes??{})},now())`;
      if(record.state!=='disregarded')await admin`INSERT INTO src_effective_record_projection(record_id,payload,state,version,updated_at) VALUES(${record.id},${admin.json(record.sourcePayload??{})},'active',0,now())`;
    }
    const fixture=await freshFixture();
    const memory=new InMemorySourceReconciliationRepository(records,TEST_CURSOR_KEY);
    const memoryRoot=reconcileConfirmedPreview({confirmation:fixture.confirmation,preview:fixture.preview,policy:policyFor(fixture.preview),records});
    const savedMemory=await memory.saveReconciliation({reconciliation:memoryRoot,fingerprint:memoryRoot.fingerprint,idempotencyKey:`memory-search-${randomUUID()}`});
    const pg=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const cases:[string,string[]][]=[
      [ids[0].toUpperCase(),[ids[0]]],['special_key',[ids[0]]],['  ATTR-MIXED  ',[ids[0]]],['allow%percent',[ids[0]]],
      ['under_score',[ids[1]]],['2026\\path',[ids[1]]],['duration-unique',[ids[2]]],
      ['private-a',[]],['private-b',[]],['disregarded-unique',[]],['allow_percent',[]],['under\\_score',[]],
    ];
    for(const [query,expected] of cases){
      const [memoryPage,pgPage]=await Promise.all([
        memory.searchStableRecords({reconciliationId:savedMemory.reconciliation.id,query,page:0,pageSize:50}),
        pg.searchStableRecords({reconciliationId:largeCurrentId,query,page:0,pageSize:50}),
      ]);
      expect(memoryPage.records.map((record)=>record.id)).toEqual(expected);
      expect(pgPage.records.map((record)=>record.id)).toEqual(expected);
      expect(pgPage.total).toBe(memoryPage.total);
      expect(pgPage.records.map((record)=>({id:record.id,matchingAttributes:record.matchingAttributes,effectivePayload:record.effectivePayload})))
        .toEqual(memoryPage.records.map((record)=>({id:record.id,matchingAttributes:record.matchingAttributes,effectivePayload:record.effectivePayload})));
    }
    const collect=async(repository:{searchStableRecords:(input:{reconciliationId:string;query:string;page:number;pageSize:number;cursor?:string})=>Promise<{records:StableRecordContext[];total:string;nextCursor?:string}>},reconciliationId:string)=>{
      const found:string[]=[];let cursor: string|undefined;let page=0;let total='';
      do{const result=await repository.searchStableRecords({reconciliationId,query:page===0?'  PAGE-PARITY  ':'page-parity',page,pageSize:1,...(cursor?{cursor}:{})});total=result.total;found.push(...result.records.map((record)=>record.id));cursor=result.nextCursor;page+=1;}while(cursor);
      return {found,total};
    };
    const [memoryPaged,pgPaged]=await Promise.all([collect(memory,savedMemory.reconciliation.id),collect(pg,largeCurrentId)]);
    const expectedPaged=ids.slice(0,3).sort();
    expect(memoryPaged).toEqual({found:expectedPaged,total:'3'});expect(pgPaged).toEqual(memoryPaged);

    // Simula uma linha legada que antecede a CHECK da Story 3.3. A constraint
    // volta imediatamente como NOT VALID: ela bloqueia toda escrita nova, mas
    // permite provar a defesa de leitura sobre o registro legado.
    const legacyId=randomUUID();
    const reservedCursoValue=`reserved-curso-${randomUUID()}`;
    const reservedTrilhaValue=`reserved-trilha-${randomUUID()}`;
    const safeValue=`safe-search-${randomUUID()}`;
    let constraintRestored=false;
    let legacyInserted=false;
    await admin`ALTER TABLE src_stable_record DROP CONSTRAINT src_stable_record_matching_attributes_check`;
    try{
      await admin`INSERT INTO src_stable_record(id,state,matching_attributes,created_at)
        VALUES(${legacyId},'active',${admin.json({CuRsO:reservedCursoValue,tRiLhA:reservedTrilhaValue,safe_marker:safeValue})},now())`;
      legacyInserted=true;
      await admin`ALTER TABLE src_stable_record ADD CONSTRAINT src_stable_record_matching_attributes_check
        CHECK (jsonb_typeof(matching_attributes)='object' AND NOT source_reconciliation_has_reserved_key(matching_attributes)) NOT VALID`;
      constraintRestored=true;

      for(const reservedQuery of ['curso','TRILHA',reservedCursoValue,reservedTrilhaValue]){
        const result=await pg.searchStableRecords({reconciliationId:largeCurrentId,query:reservedQuery,page:0,pageSize:50});
        expect(result.records).toEqual([]);
        expect(result.total).toBe('0');
      }
      const safeResult=await pg.searchStableRecords({reconciliationId:largeCurrentId,query:safeValue,page:0,pageSize:50});
      expect(safeResult.records).toHaveLength(1);
      expect(safeResult.records[0]).toMatchObject({id:legacyId,matchingAttributes:{safe_marker:safeValue}});
      expect(Object.keys(safeResult.records[0].matchingAttributes).map((key)=>key.toLowerCase())).not.toEqual(expect.arrayContaining(['curso','trilha']));
      const legacyDto=(await pg.listStableRecords()).find((record)=>record.id===legacyId);
      expect(legacyDto?.matchingAttributes).toEqual({safe_marker:safeValue});
    }finally{
      if(legacyInserted){
        await admin`ALTER TABLE src_stable_record DISABLE TRIGGER src_stable_record_immutable`;
        try{await admin`DELETE FROM src_stable_record WHERE id=${legacyId}`;}
        finally{await admin`ALTER TABLE src_stable_record ENABLE TRIGGER src_stable_record_immutable`;}
      }
      if(!constraintRestored){
        await admin`ALTER TABLE src_stable_record ADD CONSTRAINT src_stable_record_matching_attributes_check
          CHECK (jsonb_typeof(matching_attributes)='object' AND NOT source_reconciliation_has_reserved_key(matching_attributes))`;
      }else{
        await admin`ALTER TABLE src_stable_record VALIDATE CONSTRAINT src_stable_record_matching_attributes_check`;
      }
    }
  });

  it("falha fechado em ponteiro inválido fora do filtro e além da primeira página", async () => {
    const repository=new PostgresSourceReconciliationRepository(appA,TEST_CURSOR_KEY);
    const ids=[
      'ffffffff-ffff-4fff-bfff-fffffffffff1',
      'ffffffff-ffff-4fff-bfff-fffffffffff2',
      'ffffffff-ffff-4fff-bfff-fffffffffff3',
    ];
    const [foreign]=await admin<Array<{source_observation_id:string;adjustment_event_id:string;decision_event_id:string}>>`SELECT
      (SELECT observation_id::text FROM src_effective_record_event WHERE layer='source' AND observation_id IS NOT NULL ORDER BY id LIMIT 1) source_observation_id,
      (SELECT id::text FROM src_effective_record_event WHERE layer='adjustment' ORDER BY id LIMIT 1) adjustment_event_id,
      (SELECT id::text FROM src_effective_record_event WHERE layer='decision' ORDER BY id LIMIT 1) decision_event_id`;
    if(!foreign?.source_observation_id||!foreign.adjustment_event_id||!foreign.decision_event_id)throw new Error('Ponteiros estrangeiros de prova ausentes.');
    let seeded=false;
    let guardDisabled=false;
    try{
      await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES
        (${ids[0]},${admin.json({integrity_marker:'source-pointer-corrupt'})},now()),
        (${ids[1]},${admin.json({integrity_marker:'adjustment-pointer-corrupt'})},now()),
        (${ids[2]},${admin.json({integrity_marker:'decision-pointer-corrupt'})},now())`;
      await admin`INSERT INTO src_effective_record_projection(record_id,payload,state,version,updated_at) VALUES
        (${ids[0]},${admin.json({codigo:'physical-source-stale'})},'active',0,now()),
        (${ids[1]},${admin.json({codigo:'physical-adjustment-stale'})},'active',0,now()),
        (${ids[2]},${admin.json({codigo:'physical-decision-stale'})},'active',0,now())`;
      seeded=true;
      await admin`ALTER TABLE src_effective_record_projection DISABLE TRIGGER src_effective_projection_pointer_guard`;
      guardDisabled=true;
      for(const pointer of [
        {id:ids[0],column:'source_observation_id',value:foreign.source_observation_id},
        {id:ids[1],column:'adjustment_event_id',value:foreign.adjustment_event_id},
        {id:ids[2],column:'decision_event_id',value:foreign.decision_event_id},
      ]){
        await admin.unsafe(`UPDATE src_effective_record_projection SET ${pointer.column}='${pointer.value}'::uuid WHERE record_id='${pointer.id}'::uuid`);
        try{
          await expect(repository.searchStableRecords({reconciliationId:largeCurrentId,query:`off-filter-${randomUUID()}`,page:0,pageSize:1}))
            .rejects.toMatchObject({code:'RECONCILIATION_INTEGRITY_FAILURE'});
          await expect(repository.searchStableRecords({reconciliationId:largeCurrentId,query:'',page:0,pageSize:1}))
            .rejects.toMatchObject({code:'RECONCILIATION_INTEGRITY_FAILURE'});
        }finally{
          await admin.unsafe(`UPDATE src_effective_record_projection SET ${pointer.column}=NULL WHERE record_id='${pointer.id}'::uuid`);
        }
      }
    }finally{
      try{
        if(guardDisabled)await admin`ALTER TABLE src_effective_record_projection ENABLE TRIGGER src_effective_projection_pointer_guard`;
      }finally{
        if(seeded){
          await admin`DELETE FROM src_effective_record_projection WHERE record_id=ANY(${ids}::uuid[])`;
          await admin`ALTER TABLE src_stable_record DISABLE TRIGGER src_stable_record_immutable`;
          try{await admin`DELETE FROM src_stable_record WHERE id=ANY(${ids}::uuid[])`;}
          finally{await admin`ALTER TABLE src_stable_record ENABLE TRIGGER src_stable_record_immutable`;}
        }
      }
    }
  });

  it("preserva missing versus mapa vazio até observação e evento e rejeita raiz adulterada", async () => {
    const repository = new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY);
    const service = new SourceReconciliationService(repository);
    const missing = await freshFixture();
    expect(missing.preview.rows[0]).not.toHaveProperty("durationSources");
    const records = await repository.listStableRecords();
    const baseProjectionVersion = await repository.currentProjectionVersion();
    const hostile = reconcileConfirmedPreview({ confirmation: missing.confirmation, preview: missing.preview, records, policy: policyFor(missing.preview), baseProjectionVersion });
    hostile.lines[0].observation.durationSources = {};
    await expect(repository.saveReconciliation({ reconciliation: hostile, fingerprint: hostile.fingerprint,
      idempotencyKey: `story33-duration-hostile-${randomUUID()}`, requestId: randomUUID() })).rejects.toMatchObject({ code: "22023" });

    const pendingMissing = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-duration-missing-${randomUUID()}`,
      confirmation: missing.confirmation, preview: missing.preview, policy: policyFor(missing.preview) });
    const decidedMissing = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pendingMissing.reconciliation.id,
      decision: { observationId: pendingMissing.reconciliation.lines[0].observation.id, locator: pendingMissing.reconciliation.lines[0].observation.locator,
        outcome: "create", policyVersion: policyFor(missing.preview).version, rationale: "Criar registro preservando proveniência ausente.", version: "1" } });
    const missingApplyKey=`story33-duration-missing-apply-${randomUUID()}`;
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decidedMissing.id, idempotencyKey: missingApplyKey });
    const missingApplied=await repository.applyReconciliation({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:decidedMissing.id,idempotencyKey:missingApplyKey});
    expect(await admin`SELECT duration_sources FROM src_source_observation WHERE id=${pendingMissing.reconciliation.lines[0].observation.id}`).toEqual([{ duration_sources: null }]);
    expect(await admin`SELECT duration_sources FROM src_effective_record_event WHERE reconciliation_id=${decidedMissing.id} AND layer='source'`).toEqual([{ duration_sources: null }]);
    expect(missingApplied.events.find((event)=>event.layer==='source')).not.toHaveProperty('durationSources');
    const missingRecordId=decidedMissing.changedLines[0].stableRecordId;
    if(!missingRecordId)throw new Error('A identidade criada sem duração deve ser opaca e persistida.');
    const missingSnapshot=await repository.findSnapshotByReconciliation(decidedMissing.id);
    const missingSnapshotRecord=missingSnapshot?.projection.find((item)=>item.recordId===missingRecordId);
    const missingHydratedRecord=(await repository.listStableRecords()).find((item)=>item.id===missingRecordId);
    if(!missingSnapshotRecord||!missingHydratedRecord)throw new Error('A projeção missing deve existir no snapshot e na hidratação.');
    expect(missingSnapshotRecord).not.toHaveProperty('durationSources');
    expect(missingHydratedRecord).not.toHaveProperty('durationSources');

    const empty = await freshFixture({ durationSources: {} });
    const pendingEmpty = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-duration-empty-${randomUUID()}`,
      confirmation: empty.confirmation, preview: empty.preview, policy: policyFor(empty.preview) });
    const decidedEmpty = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: pendingEmpty.reconciliation.id,
      decision: { observationId: pendingEmpty.reconciliation.lines[0].observation.id, locator: pendingEmpty.reconciliation.lines[0].observation.locator,
        outcome: "create", policyVersion: policyFor(empty.preview).version, rationale: "Criar registro preservando o mapa vazio explícito.", version: "1" } });
    const emptyApplyKey=`story33-duration-empty-apply-${randomUUID()}`;
    await service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: decidedEmpty.id, idempotencyKey: emptyApplyKey });
    const emptyApplied=await repository.applyReconciliation({actor:'Rodrigo',requestId:randomUUID(),reconciliationId:decidedEmpty.id,idempotencyKey:emptyApplyKey});
    expect(await admin`SELECT duration_sources FROM src_source_observation WHERE id=${pendingEmpty.reconciliation.lines[0].observation.id}`).toEqual([{ duration_sources: {} }]);
    expect(await admin`SELECT duration_sources FROM src_effective_record_event WHERE reconciliation_id=${decidedEmpty.id} AND layer='source'`).toEqual([{ duration_sources: {} }]);
    expect(emptyApplied.events.find((event)=>event.layer==='source')).toHaveProperty('durationSources',{});
  });

  it("isola a autenticação do bucket por lineage quando o mesmo alvo existe em outra árvore", async () => {
    const targetId = randomUUID();
    const key = `lineage-shared-${targetId}`;
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${targetId},${admin.json({ case_key: key })},now())`;
    const firstFixture = await freshFixture({ matchingAttributes: { case_key: key } });
    const secondFixture = await freshFixture({ matchingAttributes: { case_key: key } });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const first = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-lineage-a-${randomUUID()}`,
      confirmation: firstFixture.confirmation, preview: firstFixture.preview, policy: policyFor(firstFixture.preview) });
    const second = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-lineage-b-${randomUUID()}`,
      confirmation: secondFixture.confirmation, preview: secondFixture.preview, policy: policyFor(secondFixture.preview) });
    expect(first.reconciliation.status).toBe("ready-to-apply");
    expect(second.reconciliation.status).toBe("ready-to-apply");
    await admin`UPDATE src_reconciliation_target_bucket_head SET reference_count=2 WHERE lineage_id=${second.reconciliation.id} AND stable_record_id=${targetId}`;
    try {
      await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: first.reconciliation.id,
        idempotencyKey: `story33-lineage-a-apply-${randomUUID()}` })).resolves.toMatchObject({ reconciliation: { id: first.reconciliation.id } });
    } finally {
      await admin`UPDATE src_reconciliation_target_bucket_head SET reference_count=1 WHERE lineage_id=${second.reconciliation.id} AND stable_record_id=${targetId}`;
    }
  });

  it("recusa decisão física injetada na raiz chain-v3", async () => {
    const targetId = randomUUID();
    const key = `root-anchor-${targetId}`;
    await admin`INSERT INTO src_stable_record(id,matching_attributes,created_at) VALUES(${targetId},${admin.json({ case_key: key })},now())`;
    const fixture = await freshFixture({ matchingAttributes: { case_key: key } });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const root = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-root-anchor-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) });
    const injectedId = randomUUID();
    const observation = root.reconciliation.lines[0].observation;
    await admin`INSERT INTO src_reconciliation_decision
      (id,reconciliation_id,preview_id,batch_id,source_file_id,lineage_id,observation_id,locator,stable_record_id,outcome,actor,decided_at,policy_version,rationale,version,revision_no)
      VALUES(${injectedId},${root.reconciliation.id},${root.reconciliation.previewId},${root.reconciliation.batchId},${root.reconciliation.sourceFileId},${root.reconciliation.id},
        ${observation.id},${observation.locator},NULL,'reject','Rodrigo',now(),${root.reconciliation.policy.version},'Decisão física hostil injetada na raiz.','1',1)`;
    try {
      await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: root.reconciliation.id,
        idempotencyKey: `story33-root-anchor-apply-${randomUUID()}` })).rejects.toMatchObject({ code: "RECONCILIATION_INTEGRITY_FAILURE" });
      expect(await admin`SELECT count(*)::int AS count FROM src_reconciliation_application WHERE reconciliation_id=${root.reconciliation.id}`).toEqual([{ count: 0 }]);
    } finally {
      await admin`ALTER TABLE src_reconciliation_decision DISABLE TRIGGER src_reconciliation_decision_immutable`;
      await admin`DELETE FROM src_reconciliation_decision WHERE id=${injectedId}`;
      await admin`ALTER TABLE src_reconciliation_decision ENABLE TRIGGER src_reconciliation_decision_immutable`;
    }
  });

  it("ignora caches legados e falha fechado quando a AVL autenticada diverge", async () => {
    const fixture = await freshFixture({ matchingAttributes: {} });
    const service = new SourceReconciliationService(new PostgresSourceReconciliationRepository(appA, TEST_CURSOR_KEY));
    const root = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: randomUUID(), idempotencyKey: `story33-span-root-${randomUUID()}`,
      confirmation: fixture.confirmation, preview: fixture.preview, policy: policyFor(fixture.preview) });
    const child = await service.recordDecision({ actor: "Rodrigo", requestId: randomUUID(), reconciliationId: root.reconciliation.id,
      decision: { observationId: root.reconciliation.lines[0].observation.id, locator: root.reconciliation.lines[0].observation.locator,
        outcome: "reject", policyVersion: root.reconciliation.policy.version, rationale: "Criar leaf para leitura histórica da raiz.", version: "1" } });
    expect(child.id).not.toBe(root.reconciliation.id);
    for (const invalidLimit of [null, 0, -1, 101]) {
      await expect(appA`SELECT * FROM source_reconciliation_absence_page(${root.reconciliation.id},NULL::uuid,${invalidLimit}::integer)`).rejects.toMatchObject({ code: "22023" });
    }
    const [bounded] = await appA<Array<{items:unknown[]}>>`SELECT items FROM source_reconciliation_absence_page(${root.reconciliation.id},NULL::uuid,100)`;
    expect(bounded.items.length).toBeLessThanOrEqual(100);
    const boundedPlan = await appA.unsafe<Array<{ "QUERY PLAN": string }>>(`EXPLAIN (ANALYZE) SELECT * FROM source_reconciliation_absence_page('${root.reconciliation.id}'::uuid,NULL::uuid,100)`);
    const boundedPlanText = boundedPlan.map((row) => row["QUERY PLAN"]).join(" ");
    expect(boundedPlanText).toContain("Function Scan on source_reconciliation_absence_page");
    expect(boundedPlanText).toMatch(new RegExp(`actual [^\n)]*rows=1`));
    const [span] = await admin<Array<{ stable_record_id: string; valid_from_revision: string; valid_to_revision: string | null;
      status: string; label: string; effective_payload: unknown; effective_version: string | null }>>`
      SELECT stable_record_id::text,valid_from_revision::text,valid_to_revision::text,status,label,effective_payload,effective_version
      FROM src_reconciliation_absence_span WHERE lineage_id=${root.reconciliation.id} ORDER BY stable_record_id LIMIT 1`;
    if (!span) throw new Error("A fixture deve produzir ao menos um span de ausência.");
    await expect(admin`UPDATE src_reconciliation_absence_span SET effective_payload='{}'::jsonb WHERE lineage_id=${root.reconciliation.id} AND stable_record_id=${span.stable_record_id}`)
      .rejects.toMatchObject({ code: "55000" });
    await admin`ALTER TABLE src_reconciliation_absence_span DISABLE TRIGGER src_reconciliation_absence_span_guard`;
    await admin`UPDATE src_reconciliation_absence_span SET effective_payload=${admin.json({ adulterado: "sim" })} WHERE lineage_id=${root.reconciliation.id} AND stable_record_id=${span.stable_record_id}`;
    await admin`ALTER TABLE src_reconciliation_absence_span ENABLE TRIGGER src_reconciliation_absence_span_guard`;
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${root.reconciliation.id},NULL::uuid,10)`).resolves.toHaveLength(1);
    await admin`ALTER TABLE src_reconciliation_absence_span DISABLE TRIGGER src_reconciliation_absence_span_guard`;
    await admin`UPDATE src_reconciliation_absence_span SET effective_payload=${admin.json(span.effective_payload as never)} WHERE lineage_id=${root.reconciliation.id} AND stable_record_id=${span.stable_record_id}`;
    await admin`ALTER TABLE src_reconciliation_absence_span ENABLE TRIGGER src_reconciliation_absence_span_guard`;
    await admin`ALTER TABLE src_reconciliation_absence_span DISABLE TRIGGER src_reconciliation_absence_span_immutable`;
    await admin`DELETE FROM src_reconciliation_absence_span WHERE lineage_id=${root.reconciliation.id} AND stable_record_id=${span.stable_record_id} AND valid_from_revision=${span.valid_from_revision}::bigint`;
    await admin`ALTER TABLE src_reconciliation_absence_span ENABLE TRIGGER src_reconciliation_absence_span_immutable`;
    await expect(appA`SELECT * FROM source_reconciliation_absence_page(${root.reconciliation.id},NULL::uuid,10)`).resolves.toHaveLength(1);
    await admin`INSERT INTO src_reconciliation_absence_span(lineage_id,stable_record_id,valid_from_revision,valid_to_revision,status,label,effective_payload,effective_version)
      VALUES(${root.reconciliation.id},${span.stable_record_id},${span.valid_from_revision}::bigint,${span.valid_to_revision}::bigint,${span.status},${span.label},${admin.json(span.effective_payload as never)},${span.effective_version})`;
    const [rootNode]=await admin<Array<{id:string;node_hash:string}>>`SELECT n.id::text,encode(n.node_hash,'hex') node_hash FROM src_reconciliation r JOIN src_reconciliation_absence_node n ON n.id=r.absence_root_id WHERE r.id=${root.reconciliation.id}`;
    await admin`ALTER TABLE src_reconciliation_absence_node DISABLE TRIGGER src_reconciliation_absence_node_immutable`;
    await admin`UPDATE src_reconciliation_absence_node SET node_hash=decode(${'00'.repeat(32)},'hex') WHERE id=${rootNode.id}`;
    try { await expect(appA`SELECT * FROM source_reconciliation_absence_page(${root.reconciliation.id},NULL::uuid,10)`).rejects.toMatchObject({code:'XX001'}); }
    finally { await admin`UPDATE src_reconciliation_absence_node SET node_hash=decode(${rootNode.node_hash},'hex') WHERE id=${rootNode.id}`;await admin`ALTER TABLE src_reconciliation_absence_node ENABLE TRIGGER src_reconciliation_absence_node_immutable`; }
  });

});
