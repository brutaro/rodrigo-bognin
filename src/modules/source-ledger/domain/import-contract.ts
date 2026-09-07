import { canonicalHashVersion, sha256ImportCanonical } from "../shared/hash-canonical";

export type SourceFormat = "XLS" | "XLSX" | "CSV";
export type CsvParseOptions = {
  encoding: "utf-8" | "utf-8-bom";
  delimiter: "," | ";" | "\t" | "|";
  quote: '"' | null;
  escape: "double-quote";
  allowMultilineQuotedField: boolean;
};
export type ParserLimits = {
  version: string;
  maxSourceBytes: number;
  maxExpandedBytes: number;
  maxZipEntries: number;
  maxCompressionRatio: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCellCharacters: number;
  maxCsvRecordBytes: number;
  maxXmlDepth: number;
  maxXmlNodes?: number;
  maxXmlAttributes: number;
  maxMilliseconds: number;
};
export type SourceSchemaField = { id: string; label: string; required: boolean; type: "text" | "date" | "decimal" | "duration"; maxCharacters?: number };
export type SourceSchemaVersion = { version: string; fields: SourceSchemaField[] };
export type SheetSelection = { sheetId: string; name: string; ordinal: number; visible: boolean };
export type HeaderDescriptor = { ordinal: number; rawLabel: string; normalizedLabel: string; headerId: string };
export type HeaderMapping = {
  sourceHeaderId: string;
  sourceOrdinal: number;
  logicalFieldId: string;
  mode: "canonical-normalized" | "explicit";
  coercionProfile: "identity-v1";
};
export type RegistrySelection = { schemaId: string; parserProfileId: string; transformationId: string; limitsProfileId: string };
export type ImportContract = RegistrySelection & {
  contractSchemaVersion: "import-contract-v1";
  canonicalHashVersion: typeof canonicalHashVersion;
  sourceFormat: SourceFormat;
  sheetSelection?: SheetSelection;
  csvParseOptions?: CsvParseOptions;
  schemaVersion: string;
  parserVersion: string;
  transformationVersion: string;
  transformationHash: string;
  headerMapping: HeaderMapping[];
  ignoredColumns: ["curso", "trilha"];
  limits: ParserLimits;
  contractHash: string;
};

export function buildTransformationHash(input: { version: string; ignoredColumns: ["curso", "trilha"] }) {
  return sha256ImportCanonical({
    transformationSchemaVersion: "source-transformation-v1",
    version: input.version,
    ignoredColumns: input.ignoredColumns,
    headerNormalization: "nfc-lowercase-strip-diacritics-trim-outer-spaces",
    formulaPolicy: "reject-formulas-v1",
  });
}

export function buildImportContract(input: Omit<ImportContract, "contractHash" | "transformationHash" | "canonicalHashVersion" | "contractSchemaVersion" | "ignoredColumns" | "schemaVersion" | "parserVersion" | "transformationVersion" | "limits"> & {
  schemaVersion: string;
  parserVersion: string;
  transformationVersion: string;
  limits: ParserLimits;
  transformationHash?: string;
}) {
  const transformationHash = input.transformationHash ?? buildTransformationHash({ version: input.transformationVersion, ignoredColumns: ["curso", "trilha"] });
  const body: Omit<ImportContract, "contractHash"> = {
    contractSchemaVersion: "import-contract-v1",
    canonicalHashVersion,
    schemaId: input.schemaId,
    parserProfileId: input.parserProfileId,
    transformationId: input.transformationId,
    limitsProfileId: input.limitsProfileId,
    sourceFormat: input.sourceFormat,
    ...(input.sourceFormat === "CSV" ? { csvParseOptions: input.csvParseOptions } : { sheetSelection: input.sheetSelection }),
    schemaVersion: input.schemaVersion,
    parserVersion: input.parserVersion,
    transformationVersion: input.transformationVersion,
    transformationHash,
    headerMapping: [...input.headerMapping].sort((left, right) => left.sourceOrdinal - right.sourceOrdinal),
    ignoredColumns: ["curso", "trilha"],
    limits: input.limits,
  };
  return { ...body, contractHash: sha256ImportCanonical(body) } as ImportContract;
}

export function validateParserLimits(limits: ParserLimits | undefined) {
  if (!limits || !limits.version || Object.values(limits).some((value) => typeof value !== "string" && (!Number.isSafeInteger(value) || Number(value) <= 0))) {
    throw new Error("Limites do parser ausentes ou inválidos.");
  }
}
