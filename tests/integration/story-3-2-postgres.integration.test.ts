import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSourceLedgerService, type CsvParseOptions, type PrepareImportPreviewCommand } from "../../src/modules/source-ledger/public";
import { DatabaseSourceFileReader } from "../../src/modules/source-ledger/adapters/database-source-file-reader";
import { PostgresImportPreparationRepository } from "../../src/modules/source-ledger/adapters/postgres-import-preparation-repository";
import { syntheticRegistryIds } from "../../src/modules/source-ledger/domain/import-registry";
import { PassiveTabularReader, syntheticParserLimitsV1 } from "../../src/modules/source-ledger/domain/passive-tabular-reader";
import { buildHeaderDescriptors } from "../../src/modules/source-ledger/domain/header-mapping";
import { canonicalStringify, sha256ImportCanonical } from "../../src/modules/source-ledger/shared/hash-canonical";
import type { HeaderMappingSelection } from "../../src/modules/source-ledger/domain/header-mapping";
import type { Preview } from "../../src/modules/source-ledger/domain/dtos";
import { consolidatedSourceUploadEnabled, receiveConsolidatedSource } from "../../src/lib/consolidated-source-repository";

const sources = {
  primary: "42000000-0000-4000-8000-000000000001",
  copy: "42000000-0000-4000-8000-000000000002",
  unattested: "42000000-0000-4000-8000-000000000003",
  rejected: "42000000-0000-4000-8000-000000000004",
} as const;

const csvOptions: CsvParseOptions = {
  encoding: "utf-8" as const,
  delimiter: "," as const,
  quote: '"' as const,
  escape: "double-quote" as const,
  allowMultilineQuotedField: false,
};

type SourceMeta = {
  sourceFileId: string;
  fileVersionId: string;
  sha256: string;
  sourceFormat: "CSV";
};

let appA: Sql;
let appB: Sql;
let admin: Sql;
let preparedPrimary: Preview;
let preparedCopy: Preview;
let primaryKey: string;
const meta = new Map<string, SourceMeta>();

function connectionOptions(username: string, password: string) {
  return {
    host: process.env.PGHOST ?? "db",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "tria",
    username,
    password,
    max: 2,
    prepare: false,
  };
}

async function password(path: string | undefined) {
  if (!path) throw new Error("Segredo descartável não montado no runner.");
  return (await readFile(path, "utf8")).trim();
}

function service(sql: Sql) {
  return createSourceLedgerService({
    reader: new DatabaseSourceFileReader(),
    repository: new PostgresImportPreparationRepository(sql),
  });
}

function mappingSelections(sourceSha256: string): HeaderMappingSelection[] {
  const headers = buildHeaderDescriptors(["codigo", "curso", "trilha", "data", "valor"], sourceSha256);
  return [0, 3, 4].map((ordinal) => ({
    sourceHeaderId: headers[ordinal].headerId,
    sourceOrdinal: ordinal,
    logicalFieldId: headers[ordinal].normalizedLabel,
  }));
}

function preparationCommand(source: SourceMeta, idempotencyKey: string, mapping = mappingSelections(source.sha256)): PrepareImportPreviewCommand {
  return {
    actor: "Rodrigo" as const,
    requestId: randomUUID(),
    idempotencyKey,
    payload: {
      sourceFileId: source.sourceFileId,
      registry: syntheticRegistryIds,
      csvParseOptions: csvOptions,
      mappingSelections: mapping,
    },
  };
}

function confirmationCommand(preview: Preview, idempotencyKey: string) {
  return {
    actor: "Rodrigo" as const,
    requestId: randomUUID(),
    idempotencyKey,
    payload: {
      batchId: preview.batchId, sourceFormat: preview.sourceFormat, contentHash: preview.contentHash, rowResultHash: preview.rowResultHash,
      previewId: preview.previewId,
      sourceFileId: preview.sourceFileId,
      fileVersionId: preview.fileVersionId,
      sourceSha256: preview.sourceSha256,
      contractHash: preview.contractHash,
      transformationHash: preview.transformationHash,
      previewHash: preview.previewHash,
    },
  };
}

async function graphCounts() {
  const [row] = await admin<{
    batches: number;
    previews: number;
    staging: number;
    confirmations: number;
    events: number;
  }[]>`SELECT
    (SELECT count(*)::int FROM src_import_batch) batches,
    (SELECT count(*)::int FROM src_import_preview) previews,
    (SELECT count(*)::int FROM src_import_staging_row) staging,
    (SELECT count(*)::int FROM src_import_preview_confirmation) confirmations,
    (SELECT count(*)::int FROM src_import_event) events`;
  return row;
}

async function installFailureTrigger(name: string, eventType: string) {
  await admin.unsafe(`CREATE OR REPLACE FUNCTION story32_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'story-3-2 injected rollback'; END; $$`);
  await admin.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON src_import_event FOR EACH ROW WHEN (NEW.event_type = '${eventType}') EXECUTE FUNCTION story32_injected_failure()`);
}

async function removeFailureTrigger(name: string) {
  await admin.unsafe(`DROP TRIGGER IF EXISTS ${name} ON src_import_event`);
  await admin.unsafe("DROP FUNCTION IF EXISTS story32_injected_failure()");
}

describe.sequential("Story 3.2 — integração sintética PostgreSQL dedicada", () => {
  it("G-09: seed remove apenas objeto criado pela operação que falhou", async () => {
    const directory = await mkdtemp(join(tmpdir(), "story32-seed-rollback-"));
    const uuid = randomUUID();
    const uuidPath = join(directory, "uuid");
    try {
      await writeFile(uuidPath, uuid, { mode: 0o600 });
      await writeFile(join(directory, ".tria-volume"), uuid, { mode: 0o600 });
      const environment = { ...process.env, TRIA_FILE_STORE_PATH: directory, TRIA_FILE_STORE_UUID_FILE: uuidPath, PGPASSWORD_FILE: process.env.TRIA_APP_PASSWORD_FILE, PGUSER: "tria_app" };
      const run = () => promisify(execFile)(process.execPath, ["scripts/seed-synthetic-import-source.mjs", "primary"], { env: environment });
      // The primary document already exists in this real database: SQL fails after wx created the new temporary object.
      await expect(run()).rejects.toMatchObject({ code: 1 });
      expect(await readdir(join(directory, "objects"))).toEqual([]);
      const original = join(directory, "objects", "42000000-0000-4000-8000-000000003101");
      await writeFile(original, "existing synthetic object", { flag: "wx", mode: 0o600 });
      await expect(run()).rejects.toMatchObject({ code: 1 });
      expect(await readFile(original, "utf8")).toBe("existing synthetic object");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  beforeAll(async () => {
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    delete process.env.TRIA_RUNTIME;

    const [appPassword, adminPassword] = await Promise.all([
      password(process.env.TRIA_APP_PASSWORD_FILE),
      password(process.env.TRIA_ADMIN_PASSWORD_FILE),
    ]);
    appA = postgres(connectionOptions("tria_app", appPassword));
    appB = postgres(connectionOptions("tria_app", appPassword));
    admin = postgres(connectionOptions("tria_admin", adminPassword));

    const [migration] = await admin<{ name: string; sha256: string }[]>`SELECT name, sha256 FROM schema_migration WHERE name = '029_source_import_preparation.sql'`;
    expect(migration?.name).toBe("029_source_import_preparation.sql");
    expect(migration?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const rows = await admin<SourceMeta[]>`SELECT sf.id::text "sourceFileId", sf.file_version_id::text "fileVersionId", v.sha256, upper(sf.source_format) "sourceFormat"
      FROM source_file sf JOIN file_version v ON v.id = sf.file_version_id AND v.document_id = sf.document_id ORDER BY sf.id`;
    for (const row of rows) meta.set(row.sourceFileId, row);
    expect(rows).toHaveLength(4);
    expect(await admin`SELECT count(*)::int FROM src_import_source_attestation`).toEqual([{ count: 3 }]);
  });

  afterAll(async () => {
    await removeFailureTrigger("story32_fail_prepare_event").catch(() => undefined);
    await removeFailureTrigger("story32_fail_confirmation_event").catch(() => undefined);
    const runtimeSql = (globalThis as typeof globalThis & { triaSql?: Sql }).triaSql;
    await Promise.all([
      appA?.end({ timeout: 2 }).catch(() => undefined),
      appB?.end({ timeout: 2 }).catch(() => undefined),
      admin?.end({ timeout: 2 }).catch(() => undefined),
      runtimeSql?.end({ timeout: 2 }).catch(() => undefined),
    ]);
  });

  it("G-03/G-04: exige registry e atestação persistida antes dos bytes", async () => {
    const source = meta.get(sources.unattested)!;
    const reader = new DatabaseSourceFileReader();
    expect(await reader.resolveSourceFile(source.sourceFileId)).toBeUndefined();
    const before = await graphCounts();
    await expect(service(appA).prepareImportPreview(preparationCommand(source, "unattested-key", []))).rejects.toMatchObject({ code: "SOURCE_PROCESSING_DISABLED" });
    expect(await graphCounts()).toEqual(before);

    const forgedRegistry = { ...syntheticRegistryIds, schemaId: "client-schema-v999" };
    await expect(service(appA).inspectSource({
      actor: "Rodrigo",
      requestId: randomUUID(),
      payload: { sourceFileId: meta.get(sources.primary)!.sourceFileId, registry: forgedRegistry },
    })).rejects.toMatchObject({ code: "IMPORT_REGISTRY_INVALID" });

    const primary = meta.get(sources.primary)!;
    const descriptor = await reader.resolveExact(primary);
    expect(descriptor).toMatchObject({ sourceFileId: primary.sourceFileId, fileVersionId: primary.fileVersionId, sha256: primary.sha256, syntheticAttested: true });
    const opened = await reader.openExact(primary);
    expect(createHash("sha256").update(opened.bytes).digest("hex")).toBe(primary.sha256);
  });

  it("G-05/G-06/G-07: mantém parsing passivo, limites e hashes canônicos", async () => {
    const reader = new PassiveTabularReader();
    await expect(reader.enumerate({
      bytes: Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
      sourceSha256: "a".repeat(64),
      sourceFormat: "XLS",
      limits: syntheticParserLimitsV1,
    })).rejects.toMatchObject({ code: "XLS_BINARY_UNSUPPORTED" });
    await expect(reader.enumerate({
      bytes: new TextEncoder().encode(`codigo\n${"x".repeat(20_000)}`),
      sourceSha256: "b".repeat(64),
      sourceFormat: "CSV",
      limits: syntheticParserLimitsV1,
      csvParseOptions: csvOptions,
    })).rejects.toMatchObject({ code: "TABULAR_LIMIT_EXCEEDED" });
    expect(canonicalStringify({ b: 2, a: 1, zero: -0 })).toBe('{"a":1,"b":2,"zero":0}');
    expect(sha256ImportCanonical({ rows: [{ locator: "row:3" }, { locator: "row:2" }] })).toBe(sha256ImportCanonical({ rows: [{ locator: "row:2" }, { locator: "row:3" }] }));
  });

  it("G-08/G-09: usa duas conexões e mantém um único vencedor idempotente", async () => {
    const primary = meta.get(sources.primary)!;
    primaryKey = "story32-concurrent-prepare";
    const [left, right] = await Promise.all([
      service(appA).prepareImportPreview(preparationCommand(primary, primaryKey)),
      service(appB).prepareImportPreview(preparationCommand(primary, primaryKey)),
    ]);
    preparedPrimary = left.preview;
    expect(right.preview.previewId).toBe(left.preview.previewId);
    expect(right.preview.batchId).toBe(left.preview.batchId);
    expect(right.reused || left.reused).toBe(true);
    expect(left.preview.summary).toMatchObject({ found: 3, valid: 1, withError: 2, rejected: 2 });
    expect(JSON.stringify(left.preview)).not.toContain("não usar");
    expect(left.preview.rows.every((row) => !Object.hasOwn(row.normalizedPayload, "curso") && !Object.hasOwn(row.normalizedPayload, "trilha"))).toBe(true);

    const copy = meta.get(sources.copy)!;
    const copyResult = await service(appB).prepareImportPreview(preparationCommand(copy, "story32-copy-prepare"));
    preparedCopy = copyResult.preview;
    expect(preparedCopy.previewId).not.toBe(preparedPrimary.previewId);
    expect(preparedCopy.contentHash).toBe(preparedPrimary.contentHash);
    expect(preparedCopy.rowResultHash).toBe(preparedPrimary.rowResultHash);
    expect(preparedCopy.previewHash).toBe(preparedPrimary.previewHash);

    const primaryCounts = await admin<{ batches: number; previews: number; staging: number; events: number }[]>`SELECT
      (SELECT count(*)::int FROM src_import_batch WHERE source_file_id = ${primary.sourceFileId}::uuid) batches,
      (SELECT count(*)::int FROM src_import_preview WHERE source_file_id = ${primary.sourceFileId}::uuid) previews,
      (SELECT count(*)::int FROM src_import_staging_row WHERE batch_id = ${preparedPrimary.batchId}::uuid) staging,
      (SELECT count(*)::int FROM src_import_event WHERE batch_id = ${preparedPrimary.batchId}::uuid) events`;
    expect(primaryCounts[0]).toEqual({ batches: 1, previews: 1, staging: 3, events: 1 });

    const beforeRollback = await graphCounts();
    await installFailureTrigger("story32_fail_prepare_event", "source.import.preview_prepared.v1");
    const rollbackPreview = structuredClone(preparedPrimary);
    rollbackPreview.previewId = randomUUID();
    rollbackPreview.batchId = randomUUID();
    rollbackPreview.previewHash = "f".repeat(64);
    rollbackPreview.preparedAt = new Date(Date.now() + 1000).toISOString();
    rollbackPreview.retainUntil = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    await expect(new PostgresImportPreparationRepository(appA).savePrepared({
      preview: rollbackPreview,
      fingerprint: "e".repeat(64),
      idempotencyKey: "story32-rollback-prepare",
      requestId: randomUUID(),
    })).rejects.toThrow("story-3-2 injected rollback");
    await removeFailureTrigger("story32_fail_prepare_event");
    expect(await graphCounts()).toEqual(beforeRollback);
    expect(await admin`SELECT count(*)::int FROM src_import_batch WHERE id = ${rollbackPreview.batchId}::uuid`).toEqual([{ count: 0 }]);
  });

  it("G-10/G-11: confirma somente o grafo exato e reabre o staging retido", async () => {
    const confirmation = await service(appA).confirmImportPreview(confirmationCommand(preparedPrimary, "story32-confirm-primary"));
    expect(confirmation.status).toBe("confirmed");
    await expect(service(appB).confirmImportPreview({
      ...confirmationCommand(preparedPrimary, "story32-tampered-confirmation"),
      payload: { ...confirmationCommand(preparedPrimary, "story32-tampered-confirmation").payload, previewHash: "a".repeat(64) },
    })).rejects.toMatchObject({ code: "PREVIEW_LINK_MISMATCH" });

    const [storedLink] = await admin<{ contract_id: string }[]>`SELECT contract_id::text FROM src_import_preview WHERE id = ${preparedPrimary.previewId}::uuid`;
    if (!storedLink) throw new Error("Contrato da prévia sintética não foi persistido.");
    const primary = meta.get(sources.primary)!;
    await expect(appA.begin(async (tx) => {
      await tx`INSERT INTO src_import_preview_confirmation
        (id, preview_id, batch_id, source_file_id, file_version_id, source_sha256, contract_id, contract_hash,
         transformation_hash, content_hash, row_result_hash, source_format, preview_hash, actor, confirmed_at, idempotency_key, payload_fingerprint, confirmation_payload)
          VALUES (${randomUUID()}::uuid, ${preparedCopy.previewId}::uuid, ${preparedCopy.batchId}::uuid,
          ${primary.sourceFileId}::uuid, ${primary.fileVersionId}::uuid, ${primary.sha256}, ${storedLink.contract_id}::uuid,
          ${preparedCopy.contractHash}, ${preparedCopy.transformationHash}, ${preparedCopy.contentHash}, ${preparedCopy.rowResultHash}, ${preparedCopy.sourceFormat}, ${preparedCopy.previewHash}, 'Rodrigo', now(),
          'story32-direct-tamper', ${"b".repeat(64)}, ${tx.json({ tampered: true })})`;
    })).rejects.toMatchObject({ code: "23503" });

    await expect(appA.begin(async (tx) => {
      await tx`INSERT INTO src_import_staging_row
        (id, batch_id, locator, source_row_hash, normalized_payload, source_values, decimal_sources, status, field_errors, retain_until)
        VALUES (${randomUUID()}::uuid, ${preparedPrimary.batchId}::uuid, 'row:999', ${"c".repeat(64)},
          ${tx.json({ codigo: "leak", curso: "não persistir" })}, ${tx.json({})}, ${tx.json({})}, 'valid', ${tx.json([])}, now() + interval '30 days')`;
    })).rejects.toMatchObject({ code: "23514" });

    const [retention] = await admin<{ prepared_at: string; retain_until: string }[]>`SELECT prepared_at::text, retain_until::text FROM src_import_preview WHERE id = ${preparedPrimary.previewId}::uuid`;
    if (!retention) throw new Error("Retenção da prévia sintética não foi persistida.");
    expect(new Date(retention.retain_until).getTime() - new Date(retention.prepared_at).getTime()).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
    const reopened = await service(appB).reopenPreview({ actor: "Rodrigo", requestId: randomUUID(), previewId: preparedPrimary.previewId });
    expect(reopened?.previewHash).toBe(preparedPrimary.previewHash);
    expect(reopened?.rows).toEqual(preparedPrimary.rows);

    const alteredKeyPayload = preparationCommand(meta.get(sources.primary)!, primaryKey);
    alteredKeyPayload.payload.csvParseOptions = { ...csvOptions, delimiter: ";" };
    await expect(service(appB).prepareImportPreview(alteredKeyPayload)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const rejected = meta.get(sources.rejected)!;
    await expect(service(appA).prepareImportPreview(preparationCommand(rejected, "story32-rejected-key", []))).rejects.toMatchObject({ code: "HEADER_MAPPING_INVALID" });
    await expect(service(appB).prepareImportPreview(preparationCommand(rejected, "story32-rejected-key"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(admin`SELECT count(*)::int FROM src_import_batch WHERE idempotency_key = 'story32-rejected-key' AND status = 'Rejeitado'`).resolves.toEqual([{ count: 1 }]);
  });

  it("G-09/G-14: confirma rollback da confirmação e grants de menor privilégio", async () => {
    const before = await graphCounts();
    await installFailureTrigger("story32_fail_confirmation_event", "source.import.preview_confirmed.v1");
    await expect(service(appA).confirmImportPreview(confirmationCommand(preparedCopy, "story32-rollback-confirmation"))).rejects.toMatchObject({code:'IMPORT_STRUCTURE_INVALID'});
    await removeFailureTrigger("story32_fail_confirmation_event");
    expect(await graphCounts()).toEqual(before);

    const [grants] = await admin<{
      app_can_insert_attestation: boolean;
      importer_can_insert_attestation: boolean;
      importer_can_insert_batch: boolean;
      app_can_update_preview: boolean;
      app_can_delete_event: boolean;
    }[]>`SELECT
      has_table_privilege('tria_app', 'src_import_source_attestation', 'insert') app_can_insert_attestation,
      has_table_privilege('tria_importer', 'src_import_source_attestation', 'insert') importer_can_insert_attestation,
      has_table_privilege('tria_importer', 'src_import_batch', 'insert') importer_can_insert_batch,
      has_table_privilege('tria_app', 'src_import_preview', 'update') app_can_update_preview,
      has_table_privilege('tria_app', 'src_import_event', 'delete') app_can_delete_event`;
    expect(grants).toEqual({ app_can_insert_attestation: false, importer_can_insert_attestation: true, importer_can_insert_batch: false, app_can_update_preview: false, app_can_delete_event: false });
    await expect(appA`UPDATE src_import_preview SET summary = summary WHERE id = ${preparedPrimary.previewId}::uuid`).rejects.toMatchObject({ code: "42501" });
    await expect(appA`DELETE FROM src_import_event WHERE batch_id = ${preparedPrimary.batchId}::uuid`).rejects.toMatchObject({ code: "42501" });
  });

  it("G-15: não escreve na suíte de importação real nem nos módulos de ativação", async () => {
    const [row] = await admin<{ real_batches: number; relations: number; activities: number; notes: number; leaked_ignored: number }[]>`SELECT
      (SELECT count(*)::int FROM import_batch) real_batches,
      (SELECT count(*)::int FROM financial_relation) relations,
      (SELECT count(*)::int FROM bm_activity) activities,
      (SELECT count(*)::int FROM fiscal_note) notes,
      (SELECT count(*)::int FROM src_import_staging_row WHERE normalized_payload ? 'curso' OR normalized_payload ? 'trilha') leaked_ignored`;
    expect(row).toEqual({ real_batches: 0, relations: 0, activities: 0, notes: 0, leaked_ignored: 0 });
  });
  it("G-08/G-10: aliases K1/A→K2/A→K2/B conflitam em preparação e confirmação", async () => {
    const original = meta.get(sources.primary)!;
    const reuse = await service(appA).prepareImportPreview(preparationCommand(original, "alias-prepare"));
    expect(reuse.reused).toBe(true);
    const changed = preparationCommand(original, "alias-prepare");
    changed.payload.csvParseOptions = { ...csvOptions, delimiter: ";" };
    await expect(service(appB).prepareImportPreview(changed)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const confirmed = await service(appA).confirmImportPreview(confirmationCommand(preparedPrimary, "alias-confirm"));
    expect(confirmed.reused).toBe(true);
    await expect(service(appB).confirmImportPreview(confirmationCommand(preparedCopy, "alias-confirm"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("G-08: corrida payload divergente e rejeições mantém resultado determinístico", async () => {
    const source = meta.get(sources.rejected)!;
    const key = "race-rejected";
    const invalidMapping=[{sourceHeaderId:"f".repeat(64),sourceOrdinal:0,logicalFieldId:"invalid"}];
    const results = await Promise.allSettled([
      service(appA).prepareImportPreview(preparationCommand(source, key, invalidMapping)),
      service(appB).prepareImportPreview(preparationCommand(source, key, invalidMapping)),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const [count] = await admin`SELECT count(*)::int count FROM src_import_batch WHERE idempotency_key='race-rejected'`;
    expect(count.count).toBe(1);
    await expect(service(appA).prepareImportPreview(preparationCommand(source, key))).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    const [left,right] = await Promise.all([
      service(appA).confirmImportPreview(confirmationCommand(preparedPrimary,"race-confirm-left")),
      service(appB).confirmImportPreview(confirmationCommand(preparedPrimary,"race-confirm-right")),
    ]);
    expect(left.confirmationId).toBe(right.confirmationId); expect(left.reused && right.reused).toBe(true);
  });

  it("G-09/G-14: falha após cada escrita da preparação desfaz todo o grafo", async () => {
    for (const table of ['src_import_contract','src_import_batch','src_import_staging_row','src_import_preview','src_import_event','src_import_request']) {
      const before=await graphCounts();
      const [contractsBefore]=await admin`SELECT count(*)::int count FROM src_import_contract`;
      const clone=structuredClone(preparedPrimary);
      clone.batchId=randomUUID(); clone.previewId=randomUUID(); clone.previewHash=createHash('sha256').update(table).digest('hex');
      clone.contractHash=createHash('sha256').update('contract:'+table).digest('hex'); clone.contract.contractHash=clone.contractHash;
      await admin.unsafe(`CREATE FUNCTION fault_each_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'after-write fault'; END; $$`);
      await admin.unsafe(`CREATE TRIGGER fault_each_write AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fault_each_write()`);
      try {
        await expect(new PostgresImportPreparationRepository(appA).savePrepared({preview:clone,fingerprint:createHash('sha256').update('fingerprint:'+table).digest('hex'),idempotencyKey:'fault:'+table})).rejects.toThrow('after-write fault');
      } finally { await admin.unsafe(`DROP TRIGGER fault_each_write ON ${table}`); await admin.unsafe('DROP FUNCTION fault_each_write()'); }
      expect(await graphCounts()).toEqual(before);
      expect((await admin`SELECT count(*)::int count FROM src_import_contract`)[0]).toEqual(contractsBefore);
    }
  });

  it("G-09/G-14: confirmação/evento/alias são atômicos e retry técnico permanece válido", async () => {
    for (const table of ['src_import_preview_confirmation','src_import_event','src_import_request']) {
      const clone=structuredClone(preparedPrimary); clone.batchId=randomUUID(); clone.previewId=randomUUID(); clone.previewHash=createHash('sha256').update('confirm:'+table).digest('hex');
      await new PostgresImportPreparationRepository(appA).savePrepared({preview:clone,fingerprint:createHash('sha256').update('confirmfp:'+table).digest('hex'),idempotencyKey:'confirmprep:'+table});
      const before=await graphCounts();
      await admin.unsafe(`CREATE FUNCTION fault_each_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'after-write fault'; END; $$`);
      await admin.unsafe(`CREATE TRIGGER fault_each_write AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fault_each_write()`);
      try { await expect(service(appA).confirmImportPreview(confirmationCommand(clone,'confirmfault:'+table))).rejects.toMatchObject({code:'IMPORT_STRUCTURE_INVALID'}); }
      finally { await admin.unsafe(`DROP TRIGGER fault_each_write ON ${table}`); await admin.unsafe('DROP FUNCTION fault_each_write()'); }
      expect(await graphCounts()).toEqual(before);
      expect((await service(appB).confirmImportPreview(confirmationCommand(clone,'confirmfault:'+table))).status).toBe('confirmed');
    }
  });

  it("G-10/G-11: SQL direto recusa manifestos, formatos, retenção, contagens e eventos divergentes", async () => {
    const cases: Array<(p: Preview)=>void>=[
      p=>{p.sourceFormat='XLSX';}, p=>{p.summary.found++;}, p=>{p.rows[0].sourceValues.curso='proibido';},
      p=>{p.summary.valid++;}, p=>{p.retainUntil=p.preparedAt;},
    ];
    for (const [i,mutate] of cases.entries()) {
      const p=structuredClone(preparedPrimary);p.batchId=randomUUID();p.previewId=randomUUID();p.previewHash=createHash('sha256').update('tamper:'+i).digest('hex');mutate(p);
      const before=await graphCounts();
      await expect(new PostgresImportPreparationRepository(appA).savePrepared({preview:p,fingerprint:createHash('sha256').update('tamperfp:'+i).digest('hex'),idempotencyKey:'tamper:'+i})).rejects.toThrow();
      expect(await graphCounts()).toEqual(before);
    }
    const p=structuredClone(preparedPrimary);p.batchId=randomUUID();p.previewId=randomUUID();p.previewHash=createHash('sha256').update('expired').digest('hex');
    p.preparedAt=new Date(Date.now()-32*86400000).toISOString();p.retainUntil=new Date(Date.now()-86400000).toISOString();
    await new PostgresImportPreparationRepository(appA).savePrepared({preview:p,fingerprint:createHash('sha256').update('expiredfp').digest('hex'),idempotencyKey:'expired'});
    await expect(service(appA).reopenPreview({actor:'Rodrigo',requestId:randomUUID(),previewId:p.previewId})).rejects.toMatchObject({code:'PREVIEW_EXPIRED'});
    await expect(service(appA).confirmImportPreview(confirmationCommand(p,'expiredconfirm'))).rejects.toMatchObject({code:'PREVIEW_EXPIRED'});
  });

  it("G-04: ponte aceita somente receipt recém-criado no namespace persistido", async () => {
    await expect(appA.begin(async tx=>{ await tx`SELECT set_config('tria.synthetic_namespace',${process.env.TRIA_INTEGRATION_NAMESPACE!},true)`;await tx`SELECT attest_new_synthetic_receipt(${sources.unattested}::uuid)`; })).rejects.toThrow('receipt is not newly received');
    await expect(appA`INSERT INTO src_import_synthetic_context(namespace) VALUES ('tria-adjustments-forged')`).rejects.toMatchObject({code:'42501'});
    await expect(appA`SELECT attest_new_synthetic_receipt(${sources.unattested}::uuid)`).rejects.toThrow('synthetic bridge disabled');
  });

  it("G-04/G-11: reabrir e replay de confirmação revalidam fonte ativa e ambiente", async () => {
    const source=meta.get(sources.primary)!;
    // Privileged corruption injection is limited to the disposable fixture database.
    await admin.begin(async tx=>{ await tx`SET LOCAL session_replication_role = replica`; await tx`UPDATE file_version SET status='purging' WHERE id=${source.fileVersionId}::uuid`; });
    try {
      await expect(service(appA).reopenPreview({actor:'Rodrigo',requestId:randomUUID(),previewId:preparedPrimary.previewId})).rejects.toMatchObject({code:'SOURCE_PROCESSING_DISABLED'});
      await expect(service(appA).confirmImportPreview(confirmationCommand(preparedPrimary,'story32-confirm-primary'))).rejects.toMatchObject({code:'SOURCE_PROCESSING_DISABLED'});
    } finally { await admin.begin(async tx=>{ await tx`SET LOCAL session_replication_role = replica`; await tx`UPDATE file_version SET status='active' WHERE id=${source.fileVersionId}::uuid`; }); }
    process.env.TRIA_RUNTIME='railway';
    try { expect(await new DatabaseSourceFileReader().resolveExact(source)).toBeUndefined(); await expect(service(appA).reopenPreview({actor:'Rodrigo',requestId:randomUUID(),previewId:preparedPrimary.previewId})).rejects.toMatchObject({code:'SOURCE_PROCESSING_DISABLED'}); }
    finally { delete process.env.TRIA_RUNTIME; }
    const wrong={...source,sha256:'f'.repeat(64)};expect(await new DatabaseSourceFileReader().resolveExact(wrong)).toBeUndefined();
  });

  it("G-08: duas instâncias com payloads válidos diferentes disputam a mesma chave", async () => {
    const before=await graphCounts();
    const results=await Promise.allSettled([
      service(appA).prepareImportPreview(preparationCommand(meta.get(sources.primary)!, 'race-distinct-payloads')),
      service(appB).prepareImportPreview(preparationCommand(meta.get(sources.copy)!, 'race-distinct-payloads')),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const losing=results.find(r=>r.status==='rejected');expect(losing?.status==='rejected' && losing.reason).toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await graphCounts()).toEqual(before);
    expect(await admin`SELECT count(*)::int count FROM src_import_request WHERE operation='prepare' AND idempotency_key='race-distinct-payloads'`).toEqual([{count:1}]);
  });

  it("G-10: cada vínculo de confirmação adulterado é recusado sem novos efeitos", async () => {
    const original=confirmationCommand(preparedPrimary,'each-link').payload;
    for (const field of Object.keys(original) as Array<keyof typeof original>) {
      const changed: Record<string,string>={...original};
      changed[field]=field==='sourceFormat'?'XLSX':field.endsWith('Id')?randomUUID():'f'.repeat(64);
      await expect(service(appA).confirmImportPreview({actor:'Rodrigo',requestId:randomUUID(),idempotencyKey:'each-link:'+field,payload:changed as typeof original})).rejects.toMatchObject({code:field==='previewId'?'PREVIEW_NOT_FOUND':'PREVIEW_LINK_MISMATCH'});
    }
  });

  it("G-03/G-10: SQL rejeita cada campo normativo divergente, ausente ou adicional no contrato", async () => {
    const [stored] = await appA`SELECT * FROM src_import_contract WHERE contract_hash=${preparedPrimary.contractHash}`;
    const mutations: Record<string, unknown> = {
      contractHash: "f".repeat(64), contractSchemaVersion: "unapproved", canonicalHashVersion: "unapproved", sourceFormat: "XLSX",
      schemaId: "unapproved", parserProfileId: "unapproved", transformationId: "unapproved", limitsProfileId: "unapproved",
      schemaVersion: "unapproved", parserVersion: "unapproved-parser-v99", transformationVersion: "unapproved",
      transformationHash: "f".repeat(64), headerMapping: [], ignoredColumns: [], limits: {},
      csvParseOptions: { ...preparedPrimary.csvParseOptions, delimiter: ";" }, sheetSelection: {}, unexpected: true,
    };
    for (const [field, changed] of Object.entries(mutations)) {
      for (const remove of [false, true]) {
        if (remove && !Object.hasOwn(stored.contract_payload, field)) continue;
        const hash = createHash("sha256").update(randomUUID()).digest("hex");
        const payload = { ...stored.contract_payload, contractHash: hash };
        if (remove) delete payload[field]; else payload[field] = changed;
        await expect(appA`INSERT INTO src_import_contract
          (id,contract_hash,source_format,sheet_selection,csv_parse_options,schema_id,parser_profile_id,
           transformation_id,limits_profile_id,schema_version,parser_version,transformation_version,
           transformation_hash,header_mapping,ignored_columns,limits,contract_payload)
          SELECT ${randomUUID()}::uuid,${hash},source_format,sheet_selection,csv_parse_options,schema_id,parser_profile_id,
            transformation_id,limits_profile_id,schema_version,parser_version,transformation_version,
            transformation_hash,header_mapping,ignored_columns,limits,${appA.json(payload)}
          FROM src_import_contract WHERE id=${stored.id}::uuid`).rejects.toThrow("invalid contract payload");
      }
    }
    for (const [field, value] of Object.entries({ parserVersion: "unapproved", schemaVersion: "unapproved", transformationVersion: "unapproved", registry: {}, csvParseOptions: { ...preparedPrimary.csvParseOptions, delimiter: ";" }, sheetSelection: {} })) {
      const preview = { ...structuredClone(preparedPrimary), batchId: randomUUID(), previewId: randomUUID(), previewHash: createHash("sha256").update(randomUUID()).digest("hex"), [field]: value };
      await expect(new PostgresImportPreparationRepository(appA).savePrepared({ preview, fingerprint: createHash("sha256").update(randomUUID()).digest("hex"), idempotencyKey: randomUUID() })).rejects.toThrow("invalid preview manifest");
    }
  });

  it("G-04/G-15: ausência de contexto preserva recepção opaca mas não autoriza processamento", async () => {
    const [saved] = await admin`SELECT namespace FROM src_import_synthetic_context`;
    const namespace = process.env.TRIA_INTEGRATION_NAMESPACE;
    await admin`DELETE FROM src_import_synthetic_context`;
    try {
      for (const kind of ["evidence", "vault", "adjustments"]) {
        process.env.TRIA_INTEGRATION_NAMESPACE = `tria-${kind}-opaque-regression`;
        expect(consolidatedSourceUploadEnabled()).toBe(true);
        const bytes = Buffer.from("synthetic opaque XLS bytes");
        const receipt = await receiveConsolidatedSource({ originalName: "synthetic.xls", declaredSize: String(bytes.length), transportSize: String(bytes.length), mediaType: "application/x-unexpected", body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });
        expect(receipt).toMatchObject({ status: "protected", format: "XLS", sizeBytes: bytes.length });
        expect(await appA`SELECT id FROM src_import_source_attestation WHERE source_file_id=${receipt.receiptId}::uuid`).toHaveLength(0);
        await expect(service(appA).inspectSource({ actor: "Rodrigo", requestId: randomUUID(), payload: { sourceFileId: receipt.receiptId, registry: syntheticRegistryIds } })).rejects.toMatchObject({ code: "SOURCE_PROCESSING_DISABLED" });
      }
    } finally {
      process.env.TRIA_INTEGRATION_NAMESPACE = namespace;
      await admin`INSERT INTO src_import_synthetic_context(namespace) VALUES (${saved.namespace})`;
    }
  });
});
