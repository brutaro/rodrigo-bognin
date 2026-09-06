import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceLedgerService, type HeaderMappingSelection } from "../public";
import { InMemoryImportPreparationRepository, InMemorySourceFileReader } from "../adapters/in-memory";
import { syntheticRegistryIds } from "../domain/import-registry";
import { buildHeaderDescriptors } from "../domain/header-mapping";

const original = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE, runtime: process.env.TRIA_RUNTIME };
const csvOptions = { encoding: "utf-8" as const, delimiter: "," as const, quote: '"' as const, escape: "double-quote" as const, allowMultilineQuotedField: false };
function enable() { process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only"; process.env.TRIA_INTEGRATION_ISOLATED = "confirmed"; process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-test"; delete process.env.TRIA_RUNTIME; }
afterEach(() => { for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: original.upload, TRIA_INTEGRATION_ISOLATED: original.isolated, TRIA_INTEGRATION_NAMESPACE: original.namespace, TRIA_RUNTIME: original.runtime })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

function fixture(text: string, suffix: string) {
  const bytes = new TextEncoder().encode(text); const hash = createHash("sha256").update(bytes).digest("hex");
  return { sourceFileId: `10000000-0000-4000-8000-0000000000${suffix}`, fileVersionId: `10000000-0000-4000-8000-0000000001${suffix}`, sha256: hash, sourceFormat: "CSV" as const, sizeBytes: bytes.byteLength, namespace: "tria-evidence-test", bytes };
}
function command(source: ReturnType<typeof fixture>, mappingSelections: HeaderMappingSelection[], idempotencyKey = "prepare-1") {
  return { actor: "Rodrigo" as const, requestId: "10000000-0000-4000-8000-000000000010", idempotencyKey, payload: { sourceFileId: source.sourceFileId, registry: syntheticRegistryIds, csvParseOptions: csvOptions, mappingSelections } };
}
function mappings(source: ReturnType<typeof fixture>, labels = ["codigo", "data", "valor"]): HeaderMappingSelection[] {
  return labels.map((field, ordinal) => ({ sourceHeaderId: buildHeaderDescriptors(labels, source.sha256)[ordinal].headerId, sourceOrdinal: ordinal, logicalFieldId: field }));
}

describe("source-ledger — preparação sintética atestada", () => {
  it.each(["é".repeat(10000), "😀".repeat(5000)])("conta bytes UTF-8 reais antes de descartar colunas ignoradas", async (value) => {
    enable();
    const labels = ["codigo", "data", "valor", ...Array(35).fill("curso")];
    const record = ["A", "2026-01-01", "1.00", ...Array(35).fill(value)].join(",");
    const source = fixture(labels.join(",") + "\n" + record, "07");
    expect(Buffer.byteLength(record)).toBe(700052);
    expect(source.sizeBytes).toBe(700280);
    const repository = new InMemoryImportPreparationRepository();
    const service = createSourceLedgerService({ reader: new InMemorySourceFileReader([source]), repository });
    const selected = buildHeaderDescriptors(labels, source.sha256).slice(0, 3).map((header) => ({ sourceHeaderId: header.headerId, sourceOrdinal: header.ordinal, logicalFieldId: header.normalizedLabel }));
    const result = await service.prepareImportPreview(command(source, selected));
    expect(result.preview.summary.valid).toBe(1);
    expect(result.preview.rows[0].normalizedPayload).toEqual({ codigo: "A", data: "2026-01-01", valor: "1.00" });
    expect(JSON.stringify(result.preview.rows)).not.toContain(value);
    expect(repository.rejectedCount).toBe(0);
  });
  it("hash da linha distingue texto original e localização após normalização", async () => {
    enable();
    const source = fixture("codigo,data,valor\nA-1,2026-01-01,10\n A-1 ,2026-01-01,10\nA-1,2026-01-01,10\n", "09");
    const service = createSourceLedgerService({ reader: new InMemorySourceFileReader([source]), repository: new InMemoryImportPreparationRepository() });
    const {preview} = await service.prepareImportPreview(command(source, mappings(source)));
    expect(preview.rows[0].normalizedPayload).toEqual(preview.rows[1].normalizedPayload);
    expect(preview.rows[1].sourceValues.codigo).toBe(" A-1 ");
    expect(new Set(preview.rows.map(row=>row.sourceRowHash)).size).toBe(3);
  });
  it("falha fechada antes de abrir bytes sem gate isolado", async () => {
    const source = fixture("codigo,data\nA-1,2026-01-01\n", "01"); const reader = new InMemorySourceFileReader([source]); const service = createSourceLedgerService({ reader, repository: new InMemoryImportPreparationRepository() });
    await expect(service.prepareImportPreview(command(source, mappings(source)))).rejects.toMatchObject({ code: "SOURCE_PROCESSING_DISABLED" });
    expect(reader.openCount).toBe(0);
  });

  it("resolve registry no servidor, remove curso/trilha antes da validação e preserva o hash funcional", async () => {
    enable();
    const text = "codigo,curso,trilha,data,valor\nA-1,privado,privado,2026-01-01,10\n"; const source = fixture(text, "02"); const copy = fixture(text, "03"); const repository = new InMemoryImportPreparationRepository(); const service = createSourceLedgerService({ reader: new InMemorySourceFileReader([source, copy]), repository });
    const selection = (source: ReturnType<typeof fixture>) => [{ sourceHeaderId: buildHeaderDescriptors(["codigo", "curso", "trilha", "data", "valor"], source.sha256)[0].headerId, sourceOrdinal: 0, logicalFieldId: "codigo" }, { sourceHeaderId: buildHeaderDescriptors(["codigo", "curso", "trilha", "data", "valor"], source.sha256)[3].headerId, sourceOrdinal: 3, logicalFieldId: "data" }, { sourceHeaderId: buildHeaderDescriptors(["codigo", "curso", "trilha", "data", "valor"], source.sha256)[4].headerId, sourceOrdinal: 4, logicalFieldId: "valor" }];
    const first = await service.prepareImportPreview(command(source, selection(source))); const second = await service.prepareImportPreview(command(copy, selection(copy), "prepare-copy"));
    expect(first.preview.rows[0].normalizedPayload).toEqual({ codigo: "A-1", data: "2026-01-01", valor: "10" }); expect(JSON.stringify(first)).not.toMatch(/privado/); expect(first.preview.rowResultHash).toBe(second.preview.rowResultHash); expect(first.preview.contentHash).toBe(second.preview.contentHash); expect(first.preview.previewHash).toBe(second.preview.previewHash); expect(repository.preparedCount).toBe(2);
  });

  it("mantém linhas válidas, localiza erros e não persiste prévia estruturalmente inválida", async () => {
    enable(); const source = fixture("codigo,data,valor\nA-1,2026-01-01,10.20\nA-2,data inválida,abc\nA-3,,30\n", "04"); const bad = fixture("codigo,data\nA-1,2026-01-01\n", "05"); const repository = new InMemoryImportPreparationRepository(); const service = createSourceLedgerService({ reader: new InMemorySourceFileReader([source, bad]), repository });
    const result = await service.prepareImportPreview(command(source, mappings(source))); expect(result.preview.summary).toMatchObject({ found: 3, valid: 1, withError: 2, rejected: 2 }); expect(result.preview.rows[1].fieldErrors).toEqual(expect.arrayContaining([expect.objectContaining({ fieldId: "data", code: "FIELD_TOO_LONG", locator: "row:3" }), expect.objectContaining({ fieldId: "valor", code: "INVALID_DECIMAL", locator: "row:3" })]));
    await expect(service.prepareImportPreview(command(bad, [], "bad-1"))).rejects.toMatchObject({ code: "HEADER_MAPPING_INVALID" }); expect(repository.preparedCount).toBe(1); expect(repository.rejectedCount).toBe(1); await expect(service.prepareImportPreview(command(bad, [], "bad-1"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deriva a evidência de matching somente do campo declarado pelo registry", async () => {
    enable();
    const source = fixture("codigo,referencia,data,valor\nA-1,RF-1,2026-01-01,10.50\n", "08");
    const repository = new InMemoryImportPreparationRepository();
    const service = createSourceLedgerService({ reader: new InMemorySourceFileReader([source]), repository });
    const result = await service.prepareImportPreview(command(source, mappings(source, ["codigo", "referencia", "data", "valor"]), "prepare-registry-match"));
    expect(result.preview.rows[0]).toMatchObject({ matchingAttributes: { referencia: "RF-1" }, normalizedPayload: { codigo: "A-1", referencia: "RF-1", data: "2026-01-01", valor: "10.50" } });
    expect(result.preview.rows[0].matchingAttributes).not.toHaveProperty("codigo");
    expect(result.preview.rows[0].matchingAttributes).not.toHaveProperty("valor");
  });

  it("é idempotente, reabre dentro da retenção e exige vínculo exato na confirmação", async () => {
    enable(); const source = fixture("codigo,data\nA-1,2026-01-01\n", "06"); const reader = new InMemorySourceFileReader([source]); const repository = new InMemoryImportPreparationRepository(); const service = createSourceLedgerService({ reader, repository }); const prepared = await service.prepareImportPreview(command(source, mappings(source, ["codigo", "data"]))); const repeated = await service.prepareImportPreview(command(source, mappings(source, ["codigo", "data"])));
    expect(repeated.preview.previewId).toBe(prepared.preview.previewId); expect(reader.openCount).toBe(1); const reopened = await service.reopenPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000011", previewId: prepared.preview.previewId }); expect(reopened?.previewHash).toBe(prepared.preview.previewHash);
    const payload = { batchId: prepared.preview.batchId, sourceFormat: prepared.preview.sourceFormat, contentHash: prepared.preview.contentHash, rowResultHash: prepared.preview.rowResultHash, previewId: prepared.preview.previewId, sourceFileId: source.sourceFileId, fileVersionId: source.fileVersionId, sourceSha256: source.sha256, contractHash: prepared.preview.contractHash, transformationHash: prepared.preview.transformationHash, previewHash: prepared.preview.previewHash }; const confirmation = await service.confirmImportPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000012", idempotencyKey: "confirm-1", payload }); expect(confirmation.status).toBe("confirmed"); expect(repository.confirmationCount).toBe(1); await expect(service.confirmImportPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000013", idempotencyKey: "confirm-2", payload: { ...payload, previewHash: "f".repeat(64) } })).rejects.toMatchObject({ code: "PREVIEW_LINK_MISMATCH" });
  });
});
