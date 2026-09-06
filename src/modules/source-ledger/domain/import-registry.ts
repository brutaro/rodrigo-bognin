import type { CsvParseOptions, ParserLimits, RegistrySelection, SourceSchemaVersion } from "./import-contract";

export const syntheticRegistryIds = Object.freeze({
  schemaId: "synthetic-source-schema-v1",
  parserProfileId: "synthetic-safe-v1",
  transformationId: "remove-course-track-v1",
  limitsProfileId: "synthetic-safe-v1",
} satisfies RegistrySelection);

const schema: SourceSchemaVersion = {
  version: "synthetic-source-schema-v1",
  fields: [
    { id: "codigo", label: "Código", required: true, type: "text", maxCharacters: 120 },
    { id: "referencia", label: "Referência estável", required: false, type: "text", maxCharacters: 120 },
    { id: "data", label: "Data", required: true, type: "date", maxCharacters: 10 },
    { id: "valor", label: "Valor", required: false, type: "decimal", maxCharacters: 64 },
    { id: "duracao", label: "Duração", required: false, type: "duration", maxCharacters: 64 },
  ],
};
Object.freeze(schema.fields);
Object.freeze(schema);
/** Registry-owned evidence key used only by the synthetic browser fixture. */
const syntheticMatchingAttributeFields = Object.freeze(["referencia"] as const);

export const syntheticSafeLimits: ParserLimits = Object.freeze({
  version: "synthetic-safe-v1",
  maxSourceBytes: 50 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxZipEntries: 2_048,
  maxCompressionRatio: 100,
  maxSheets: 32,
  maxRows: 10_000,
  maxColumns: 256,
  maxCellCharacters: 10_000,
  maxCsvRecordBytes: 1024 * 1024,
  maxXmlDepth: 64,
  maxXmlAttributes: 64,
  maxMilliseconds: 5_000,
});

const csvDefaults: CsvParseOptions = Object.freeze({
  encoding: "utf-8",
  delimiter: ",",
  quote: '"',
  escape: "double-quote",
  allowMultilineQuotedField: false,
});

export type ResolvedImportRegistry = RegistrySelection & {
  schema: SourceSchemaVersion;
  readonly matchingAttributeFields: readonly string[];
  parserVersion: "synthetic-passive-tabular-v1";
  transformationVersion: "source-transformation-v1";
  limits: ParserLimits;
  csvDefaults: CsvParseOptions;
};

export class ImportRegistryError extends Error {
  readonly code = "IMPORT_REGISTRY_INVALID" as const;
}

export function resolveSyntheticImportRegistry(selection: RegistrySelection): ResolvedImportRegistry {
  if (selection.schemaId !== syntheticRegistryIds.schemaId ||
      selection.parserProfileId !== syntheticRegistryIds.parserProfileId ||
      selection.transformationId !== syntheticRegistryIds.transformationId ||
      selection.limitsProfileId !== syntheticRegistryIds.limitsProfileId) {
    throw new ImportRegistryError("Os perfis de preparação não pertencem ao registry sintético aprovado.");
  }
  return {
    ...syntheticRegistryIds,
    schema: structuredClone(schema),
    matchingAttributeFields: syntheticMatchingAttributeFields,
    parserVersion: "synthetic-passive-tabular-v1",
    transformationVersion: "source-transformation-v1",
    limits: { ...syntheticSafeLimits },
    csvDefaults: { ...csvDefaults },
  };
}

export function validateCsvOptions(options: CsvParseOptions | undefined, registry: ResolvedImportRegistry) {
  const value = options ?? registry.csvDefaults;
  if (!(["utf-8", "utf-8-bom"] as string[]).includes(value.encoding) ||
      !([",", ";", "\t", "|"] as string[]).includes(value.delimiter) ||
      !([null, '"'] as unknown[]).includes(value.quote) || value.escape !== "double-quote" || typeof value.allowMultilineQuotedField !== "boolean") {
    throw new ImportRegistryError("As opções CSV não pertencem ao parser aprovado.");
  }
  return { ...value };
}
