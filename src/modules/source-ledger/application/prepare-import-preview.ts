import { createHash, randomUUID } from "node:crypto";
import { buildServerHeaderMappings, HeaderMappingError, validateHeaderStructure } from "../domain/header-mapping";
import { buildImportContract, type CsvParseOptions, type HeaderMapping, type RegistrySelection, type SheetSelection } from "../domain/import-contract";
import { ImportRegistryError, resolveSyntheticImportRegistry, validateCsvOptions, type ResolvedImportRegistry } from "../domain/import-registry";
import type { ExactSourceReference, SourceFileDescriptor, SourceFileReader } from "../domain/ports";
import { PassiveTabularReader, PassiveTabularReaderError, type PassiveReadResult } from "../domain/passive-tabular-reader";
import type { ImportPreparationRepository } from "./repository";
import { validateRows } from "../domain/row-validation";
import { sha256ImportCanonical } from "../shared/hash-canonical";
import type { ImportError, Preview, PreviewConfirmation, PrepareImportPreviewResult, SourceInspection } from "../domain/dtos";
import type { HeaderMappingSelection } from "../domain/header-mapping";

export type PreparationPayload = {
  sourceFileId: string;
  registry: RegistrySelection;
  sheetSelection?: SheetSelection;
  csvParseOptions?: CsvParseOptions;
  mappingSelections?: HeaderMappingSelection[];
};
export type PrepareImportPreviewCommand = { actor: "Rodrigo"; requestId: string; idempotencyKey: string; payload: PreparationPayload };
export type InspectSourceCommand = { actor: "Rodrigo"; requestId: string; payload: Omit<PreparationPayload, "mappingSelections"> };
export type ConfirmImportPreviewCommand = {
  actor: "Rodrigo";
  requestId: string;
  idempotencyKey: string;
  payload: { batchId: string; sourceFormat: SourceFileDescriptor["sourceFormat"]; contentHash: string; rowResultHash: string; previewId: string; sourceFileId: string; fileVersionId: string; sourceSha256: string; contractHash: string; transformationHash: string; previewHash: string };
};

export class SourceLedgerError extends Error {
  constructor(readonly code: string, message: string, readonly requestId: string, readonly fieldErrors?: ImportError["fieldErrors"]) {
    super(message);
    this.name = "SourceLedgerError";
  }
  toDTO(kind: "structural" | "row" = "structural"): ImportError {
    return { code: this.code, message: this.message, requestId: this.requestId, kind, ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}) };
  }
}

const namespacePattern = /^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/;
const hashPattern = /^[0-9a-f]{64}$/i;

export function syntheticProcessingEnabled(reader: SourceFileReader) {
  void reader;
  return process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD === "synthetic-fixtures-only" &&
    process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
    process.env.TRIA_RUNTIME !== "railway" &&
    namespacePattern.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
}

function gate(reader: SourceFileReader, requestId: string) {
  if (!syntheticProcessingEnabled(reader)) throw new SourceLedgerError("SOURCE_PROCESSING_DISABLED", "A preparação está disponível somente para fixtures sintéticas isoladas.", requestId);
}

function resolveRegistry(selection: RegistrySelection, requestId: string) {
  try { return resolveSyntheticImportRegistry(selection); }
  catch (error) { throw new SourceLedgerError("IMPORT_REGISTRY_INVALID", error instanceof Error ? error.message : "O registry de importação é inválido.", requestId); }
}

function descriptorIsUsable(descriptor: SourceFileDescriptor | undefined): descriptor is SourceFileDescriptor {
  return Boolean(descriptor && descriptor.syntheticAttested && descriptor.status === "active" &&
    descriptor.namespace === process.env.TRIA_INTEGRATION_NAMESPACE && hashPattern.test(descriptor.sha256));
}

async function resolveSource(reader: SourceFileReader, sourceFileId: string, requestId: string) {
  const descriptor = await reader.resolveSourceFile(sourceFileId);
  if (!descriptorIsUsable(descriptor)) throw new SourceLedgerError("SOURCE_PROCESSING_DISABLED", "A fonte não possui atestação sintética válida para este ambiente.", requestId);
  return descriptor;
}

function exactReference(descriptor: SourceFileDescriptor): ExactSourceReference {
  return { sourceFileId: descriptor.sourceFileId, fileVersionId: descriptor.fileVersionId, sha256: descriptor.sha256, sourceFormat: descriptor.sourceFormat };
}

async function readDocument(input: { reader: SourceFileReader; descriptor: SourceFileDescriptor; registry: ResolvedImportRegistry; sheetSelection?: SheetSelection; csvParseOptions?: CsvParseOptions; tabularReader: PassiveTabularReader; requestId: string }) {
  const reference = exactReference(input.descriptor);
  const opened = await input.reader.openExact(reference);
  if (!descriptorIsUsable(opened.descriptor) || opened.descriptor.fileVersionId !== reference.fileVersionId || opened.descriptor.sha256 !== reference.sha256 ||
      opened.bytes.byteLength !== opened.descriptor.sizeBytes || createHash("sha256").update(opened.bytes).digest("hex") !== reference.sha256) {
    throw new SourceLedgerError("SOURCE_INTEGRITY_INVALID", "A integridade da fonte protegida não pôde ser verificada.", input.requestId);
  }
  const csvOptions = input.descriptor.sourceFormat === "CSV" ? validateCsvOptions(input.csvParseOptions, input.registry) : undefined;
  if (input.descriptor.sourceFormat === "CSV" && input.sheetSelection) throw new SourceLedgerError("CSV_SHEET_FORBIDDEN", "CSV não possui seleção de aba.", input.requestId);
  if (input.descriptor.sourceFormat !== "CSV" && input.csvParseOptions) throw new SourceLedgerError("WORKBOOK_OPTIONS_FORBIDDEN", "Opções CSV não pertencem a um workbook.", input.requestId);
  const document = await input.tabularReader.enumerate({ bytes: opened.bytes, sourceSha256: reference.sha256, sourceFormat: reference.sourceFormat, limits: input.registry.limits, csvParseOptions: csvOptions });
  const selected = input.descriptor.sourceFormat === "CSV" || input.sheetSelection
    ? input.tabularReader.read({ document, sourceSha256: reference.sha256, sheetSelection: input.sheetSelection })
    : undefined;
  return { document, selected, csvOptions };
}

function requestFingerprint(payload: PreparationPayload, descriptor: SourceFileDescriptor, registry: ResolvedImportRegistry) {
  return sha256ImportCanonical({
    source_file_id: descriptor.sourceFileId,
    file_version_id: descriptor.fileVersionId,
    source_sha256: descriptor.sha256,
    source_format: descriptor.sourceFormat,
    registry: payload.registry,
    sheet_selection: payload.sheetSelection ?? null,
    csv_parse_options: descriptor.sourceFormat === "CSV" ? (payload.csvParseOptions ?? registry.csvDefaults) : null,
    mapping_selections: [...(payload.mappingSelections ?? [])].sort((left, right) => left.sourceOrdinal - right.sourceOrdinal),
  });
}

function safeStructureError(error: unknown, requestId: string) {
  if (error instanceof SourceLedgerError) return error;
  if (error instanceof Error && error.name === "ImportIdempotencyConflict") return new SourceLedgerError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro pedido.", requestId);
  if (error instanceof ImportRegistryError) return new SourceLedgerError("IMPORT_REGISTRY_INVALID", "O registry de importação não está disponível.", requestId);
  if (error instanceof PassiveTabularReaderError) {
    const code = error.code === "TABULAR_LIMIT_EXCEEDED" ? "TABULAR_LIMIT_EXCEEDED" : error.code === "XLS_BINARY_UNSUPPORTED" ? "XLS_BINARY_UNSUPPORTED" : error.code === "WORKBOOK_UNSAFE" ? "WORKBOOK_UNSAFE" : error.code;
    return new SourceLedgerError(code, "Não foi possível preparar este arquivo. Revise a estrutura e tente novamente.", requestId);
  }
  if (error instanceof HeaderMappingError) return new SourceLedgerError(error.code, "Não foi possível preparar este arquivo. Revise os cabeçalhos e o mapeamento.", requestId);
  return new SourceLedgerError("IMPORT_STRUCTURE_INVALID", "Não foi possível preparar este arquivo. Revise a estrutura e tente novamente.", requestId);
}

function previewManifest(preview: Omit<Preview, "previewHash" | "preparedAt" | "actor" | "status" | "batchId" | "previewId" | "retainUntil">) {
  return {
    preview_schema_version: "source-import-preview-v1",
    source_sha256: preview.sourceSha256,
    source_format: preview.sourceFormat,
    sheet_selection: preview.sheetSelection ?? null,
    csv_parse_options: preview.csvParseOptions ?? null,
    registry: preview.registry,
    contract_hash: preview.contractHash,
    transformation_hash: preview.transformationHash,
    content_hash: preview.contentHash,
    row_result_hash: preview.rowResultHash,
    header_mapping: preview.contract.headerMapping,
    ignored_columns: preview.contract.ignoredColumns,
    rows: preview.rows,
    summary: preview.summary,
    headers: preview.headers,
  };
}

function buildPreview(input: { descriptor: SourceFileDescriptor; registry: ResolvedImportRegistry; selected: PassiveReadResult; mappings: HeaderMapping[]; csvOptions?: CsvParseOptions; actor: "Rodrigo" }) {
  if (input.selected.rows.some((row) => row.length !== input.selected.headers.length)) {
    throw new PassiveTabularReaderError("CSV_MALFORMED", "Uma linha possui quantidade de colunas diferente do cabeçalho.");
  }
  const ignoredOrdinals = new Set(input.selected.headers.filter((header) => header.normalizedLabel === "curso" || header.normalizedLabel === "trilha").map((header) => header.ordinal));
  const functionalHeaders = input.selected.headers.filter((header) => !ignoredOrdinals.has(header.ordinal));
  const functionalRows = input.selected.rows.map((row) => functionalHeaders.map((header) => row[header.ordinal] ?? ""));
  if (functionalRows.some((row) => row.some((value) => value.trimStart().startsWith("=")))) throw new PassiveTabularReaderError("WORKBOOK_UNSAFE", "Fórmulas não são permitidas nesta versão.");
  const functionalMappings = input.mappings.filter((mapping) => !ignoredOrdinals.has(mapping.sourceOrdinal)).map((mapping) => ({ ...mapping, sourceOrdinal: functionalHeaders.findIndex((header) => header.ordinal === mapping.sourceOrdinal) }));
  const validatedRows = validateRows({ rows: functionalRows, locators: input.selected.locators, headers: functionalMappings, schema: input.registry.schema, rowHash: (row) => sha256ImportCanonical({ version: "source-row-retained-v2", locator:row.locator, source_values:row.sourceValues }) });
  // Matching evidence is a registry-owned projection of the immutable preview
  // row. It is never accepted from the browser and is kept separate from the
  // normalized payload so ordinary fields cannot become match keys by naming.
  const rows = validatedRows.map((row) => ({
    ...row,
    matchingAttributes: Object.fromEntries(input.registry.matchingAttributeFields.flatMap((field) => {
      const value = row.normalizedPayload[field];
      return typeof value === "string" && value.trim() ? [[field, value.trim()]] : [];
    })),
  }));
  const rowResultHash = sha256ImportCanonical({ rows: rows.map((row) => ({ locator: row.locator, sourceRowHash: row.sourceRowHash, normalizedPayload: row.normalizedPayload, sourceValues: row.sourceValues, decimalSources: row.decimalSources, durationSources: row.durationSources ?? {}, matchingAttributes: row.matchingAttributes, status: row.status, fieldErrors: row.fieldErrors })) });
  const summary = {
    found: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    withError: rows.filter((row) => row.fieldErrors.length > 0).length,
    rejected: rows.filter((row) => row.status === "rejected").length,
    inserted: "não avaliadas nesta etapa" as const,
    updated: "não avaliadas nesta etapa" as const,
    unchanged: "não avaliadas nesta etapa" as const,
    conflicts: [] as Array<{ code: string; message: string; locator?: string }>,
    rowResultHash,
  };
  const contract = buildImportContract({
    ...input.registry,
    sourceFormat: input.descriptor.sourceFormat,
    sheetSelection: input.selected.sheetSelection,
    csvParseOptions: input.csvOptions,
    schemaVersion: input.registry.schema.version,
    parserVersion: input.registry.parserVersion,
    transformationVersion: input.registry.transformationVersion,
    headerMapping: input.mappings,
    limits: input.registry.limits,
  });
  const contentHash = sha256ImportCanonical({
    source_sha256: input.descriptor.sha256,
    source_format: input.descriptor.sourceFormat,
    sheet_selection: input.selected.sheetSelection ?? null,
    csv_parse_options: input.csvOptions ?? null,
    registry: { schemaId: input.registry.schemaId, parserProfileId: input.registry.parserProfileId, transformationId: input.registry.transformationId, limitsProfileId: input.registry.limitsProfileId },
    contract_hash: contract.contractHash,
    transformation_hash: contract.transformationHash,
    row_result_hash: rowResultHash,
    rows,
  });
  const preparedAt = new Date().toISOString();
  const retainUntil = new Date(new Date(preparedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const base = {
    sourceFileId: input.descriptor.sourceFileId,
    fileVersionId: input.descriptor.fileVersionId,
    sourceSha256: input.descriptor.sha256,
    sourceFormat: input.descriptor.sourceFormat,
    contentHash,
    rowResultHash,
    retainUntil,
    registry: { schemaId: input.registry.schemaId, parserProfileId: input.registry.parserProfileId, transformationId: input.registry.transformationId, limitsProfileId: input.registry.limitsProfileId },
    ...(input.selected.sheetSelection ? { sheetSelection: input.selected.sheetSelection } : { csvParseOptions: input.csvOptions }),
    schemaVersion: input.registry.schema.version,
    parserVersion: input.registry.parserVersion,
    transformationVersion: input.registry.transformationVersion,
    contractHash: contract.contractHash,
    transformationHash: contract.transformationHash,
    contract,
    summary,
    rows,
    headers: functionalHeaders,
  };
  const previewHash = sha256ImportCanonical(previewManifest(base));
  return { ...base, previewHash, preparedAt, actor: input.actor, status: "Validado" as const, batchId: randomUUID(), previewId: randomUUID() };
}

export class SourceLedgerService {
  constructor(private readonly dependencies: { reader: SourceFileReader; repository: ImportPreparationRepository; tabularReader?: PassiveTabularReader }) {}

  async reopenPreview(command: { actor: "Rodrigo"; requestId: string; previewId: string }): Promise<Preview | undefined> {
    gate(this.dependencies.reader, command.requestId);
    const stored = await this.dependencies.repository.findPreview(command.previewId);
    if (!stored) return undefined;
    await this.assertLivePreview(stored.preview, command.requestId);
    return structuredClone(stored.preview);
  }

  async reopenConfirmedPreview(command: { actor: "Rodrigo"; requestId: string; previewId: string }): Promise<{ preview: Preview; confirmation: PreviewConfirmation } | undefined> {
    gate(this.dependencies.reader, command.requestId);
    const [storedPreview, confirmation] = await Promise.all([
      this.dependencies.repository.findPreview(command.previewId),
      this.dependencies.repository.findConfirmationByPreview(command.previewId),
    ]);
    if (!storedPreview || !confirmation) return undefined;
    await this.assertLivePreview(storedPreview.preview, command.requestId);
    return { preview: structuredClone(storedPreview.preview), confirmation: structuredClone(confirmation.confirmation) };
  }

  private async assertLivePreview(preview: Preview, requestId: string) {
    if (Date.parse(preview.retainUntil) <= Date.now()) throw new SourceLedgerError("PREVIEW_EXPIRED", "O prazo para reabrir esta prévia expirou.", requestId);
    const descriptor = await resolveSource(this.dependencies.reader, preview.sourceFileId, requestId);
    if (descriptor.fileVersionId !== preview.fileVersionId || descriptor.sha256 !== preview.sourceSha256 || descriptor.sourceFormat !== preview.sourceFormat) throw new SourceLedgerError("PREVIEW_LINK_MISMATCH", "A fonte da prévia não corresponde à versão atestada.", requestId);
  }

  async inspectSource(command: InspectSourceCommand): Promise<SourceInspection> {
    try {
    gate(this.dependencies.reader, command.requestId);
    const registry = resolveRegistry(command.payload.registry, command.requestId);
    const descriptor = await resolveSource(this.dependencies.reader, command.payload.sourceFileId, command.requestId);
    const tabularReader = this.dependencies.tabularReader ?? new PassiveTabularReader();
    const { selected, document } = await readDocument({ reader: this.dependencies.reader, descriptor, registry, sheetSelection: command.payload.sheetSelection, csvParseOptions: command.payload.csvParseOptions, tabularReader, requestId: command.requestId });
    if (selected) {
      validateHeaderStructure(selected.headers, registry.schema);
    }
    return {
      sourceFileId: descriptor.sourceFileId,
      fileVersionId: descriptor.fileVersionId,
      sourceSha256: descriptor.sha256,
      sourceFormat: descriptor.sourceFormat,
      ...(document.sheets ? { sheets: document.sheets.map((sheet) => sheet.selection) } : {}),
      headers: selected?.headers ?? [],
      schemaId: registry.schemaId,
      schema: registry.schema,
      parserProfileId: registry.parserProfileId,
      limitsProfileId: registry.limitsProfileId,
    };
    } catch (error) { throw safeStructureError(error, command.requestId); }
  }

  async prepareImportPreview(command: PrepareImportPreviewCommand): Promise<PrepareImportPreviewResult> {
    gate(this.dependencies.reader, command.requestId);
    const registry = resolveRegistry(command.payload.registry, command.requestId);
    const descriptor = await resolveSource(this.dependencies.reader, command.payload.sourceFileId, command.requestId);
    const fingerprint = requestFingerprint(command.payload, descriptor, registry);
    const sameKey = await this.dependencies.repository.findPreparedByIdempotencyKey(command.idempotencyKey);
    if (sameKey && sameKey.fingerprint !== fingerprint) throw new SourceLedgerError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro pedido.", command.requestId);
    if (sameKey) { await this.assertLivePreview(sameKey.preview, command.requestId); return { preview: structuredClone(sameKey.preview), reused: true }; }
    if (await this.dependencies.repository.findRejectedByIdempotencyKey(command.idempotencyKey)) throw new SourceLedgerError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada por uma preparação rejeitada.", command.requestId);
    const sameFingerprint = await this.dependencies.repository.findPreparedByFingerprint(fingerprint);
    if (sameFingerprint) {
      await this.assertLivePreview(sameFingerprint.preview, command.requestId);
      try {
        await this.dependencies.repository.savePrepared({ ...sameFingerprint, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
      } catch (error) { throw safeStructureError(error, command.requestId); }
      return { preview: structuredClone(sameFingerprint.preview), reused: true };
    }
    const tabularReader = this.dependencies.tabularReader ?? new PassiveTabularReader();
    try {
      const { selected, csvOptions } = await readDocument({ reader: this.dependencies.reader, descriptor, registry, sheetSelection: command.payload.sheetSelection, csvParseOptions: command.payload.csvParseOptions, tabularReader, requestId: command.requestId });
      if (!selected) throw new SourceLedgerError("SHEET_SELECTION_REQUIRED", "Escolha uma única aba antes de preparar a prévia.", command.requestId);
      validateHeaderStructure(selected.headers, registry.schema);
      const mappings = buildServerHeaderMappings({ headers: selected.headers, selections: command.payload.mappingSelections, schema: registry.schema });
      const preview = buildPreview({ descriptor, registry, selected, mappings, csvOptions, actor: command.actor });
      const saved = await this.dependencies.repository.savePrepared({ preview, fingerprint, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
      return { preview: structuredClone(saved.preview), reused: saved.preview.previewId !== preview.previewId };
    } catch (error) {
      const failure = safeStructureError(error, command.requestId);
      if ((error instanceof PassiveTabularReaderError || error instanceof HeaderMappingError || error instanceof SourceLedgerError) && failure.code !== "IDEMPOTENCY_CONFLICT") {
        try {
          await this.dependencies.repository.recordRejected({ batchId: randomUUID(), sourceFileId: descriptor.sourceFileId, fileVersionId: descriptor.fileVersionId, sourceSha256: descriptor.sha256, sourceFormat: descriptor.sourceFormat, actor: command.actor, requestId: command.requestId, idempotencyKey: command.idempotencyKey, fingerprint, code: failure.code, message: failure.message });
        } catch (persistenceError) { throw safeStructureError(persistenceError, command.requestId); }
      }
      throw failure;
    }
  }

  async confirmImportPreview(command: ConfirmImportPreviewCommand): Promise<PreviewConfirmation> {
    gate(this.dependencies.reader, command.requestId);
    const existing = await this.dependencies.repository.findConfirmationByIdempotencyKey(command.idempotencyKey);
    const payloadFingerprint = sha256ImportCanonical(command.payload);
    if (existing && existing.payloadFingerprint !== payloadFingerprint) throw new SourceLedgerError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro pedido.", command.requestId);
    if (existing) {
      const saved = await this.dependencies.repository.findPreview(existing.confirmation.previewId);
      if (!saved) throw new SourceLedgerError("PREVIEW_NOT_FOUND", "A prévia não está disponível.", command.requestId);
      await this.assertLivePreview(saved.preview, command.requestId);
      return { ...structuredClone(existing.confirmation), reused: true };
    }
    const storedPreview = await this.dependencies.repository.findPreview(command.payload.previewId);
    if (!storedPreview) throw new SourceLedgerError("PREVIEW_NOT_FOUND", "A prévia não está disponível para confirmação.", command.requestId);
    const preview = storedPreview.preview;
    await this.assertLivePreview(preview, command.requestId);
    const linked = preview.batchId === command.payload.batchId && preview.sourceFormat === command.payload.sourceFormat && preview.contentHash === command.payload.contentHash && preview.rowResultHash === command.payload.rowResultHash && preview.sourceFileId === command.payload.sourceFileId && preview.fileVersionId === command.payload.fileVersionId && preview.sourceSha256 === command.payload.sourceSha256 && preview.contractHash === command.payload.contractHash && preview.transformationHash === command.payload.transformationHash && preview.previewHash === command.payload.previewHash;
    if (!linked) throw new SourceLedgerError("PREVIEW_LINK_MISMATCH", "A confirmação não corresponde exatamente à prévia preparada.", command.requestId);
    const confirmation: PreviewConfirmation = {
      confirmationId: randomUUID(), batchId: preview.batchId, previewId: preview.previewId, sourceFileId: preview.sourceFileId, fileVersionId: preview.fileVersionId,
      sourceFormat: preview.sourceFormat, contentHash: preview.contentHash, rowResultHash: preview.rowResultHash,
      sourceSha256: preview.sourceSha256, contractHash: preview.contractHash, transformationHash: preview.transformationHash, previewHash: preview.previewHash,
      confirmedAt: new Date().toISOString(), actor: command.actor, status: "confirmed", reused: false,
    };
    try {
      const saved = await this.dependencies.repository.saveConfirmation({ confirmation, payloadFingerprint, idempotencyKey: command.idempotencyKey, requestId: command.requestId });
      return structuredClone(saved.confirmation);
    } catch (error) {
      if (error instanceof Error && error.name === "ImportIdempotencyConflict") throw new SourceLedgerError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro pedido.", command.requestId);
      throw safeStructureError(error, command.requestId);
    }
  }
}
