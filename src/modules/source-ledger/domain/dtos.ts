import type { HeaderDescriptor, ImportContract, CsvParseOptions, SheetSelection, SourceFormat, SourceSchemaVersion, RegistrySelection } from "./import-contract";
import type { FieldError } from "./row-validation";

export type ImportError = {
  code: string;
  message: string;
  requestId: string;
  kind: "structural" | "row";
  fieldErrors?: FieldError[];
  /** Current immutable leaf when a concurrent decision superseded this revision. */
  leafReconciliationId?: string;
};

export type PreviewRow = {
  locator: string;
  sourceRowHash: string;
  normalizedPayload: Record<string, string | null>;
  sourceValues: Record<string, string>;
  decimalSources: Record<string, { source_text: string; source_scale: number; normalized_value: string | null }>;
  /** The schema's duration type is carried explicitly into reconciliation metrics. */
  durationSources?: Record<string, { source_text: string; unit: "minutes" | "clock" }>;
  /** Stable matching evidence, when a server approved policy explicitly supplies it. */
  matchingAttributes?: Record<string, string>;
  status: "valid" | "rejected";
  fieldErrors: FieldError[];
};

export type PreviewSummary = {
  found: number;
  valid: number;
  withError: number;
  rejected: number;
  inserted: "não avaliadas nesta etapa";
  updated: "não avaliadas nesta etapa";
  unchanged: "não avaliadas nesta etapa";
  conflicts: Array<{ code: string; message: string; locator?: string }>;
  rowResultHash: string;
};

export type Preview = {
  previewId: string;
  batchId: string;
  sourceFileId: string;
  fileVersionId: string;
  sourceSha256: string;
  sourceFormat: SourceFormat;
  contentHash: string;
  rowResultHash: string;
  retainUntil: string;
  registry: RegistrySelection;
  sheetSelection?: SheetSelection;
  csvParseOptions?: CsvParseOptions;
  schemaVersion: string;
  parserVersion: string;
  transformationVersion: string;
  contractHash: string;
  transformationHash: string;
  previewHash: string;
  preparedAt: string;
  actor: string;
  status: "Validado";
  contract: ImportContract;
  summary: PreviewSummary;
  rows: PreviewRow[];
  headers: HeaderDescriptor[];
};

export type PrepareImportPreviewResult = {
  preview: Preview;
  reused: boolean;
};

export type PreviewConfirmation = {
  sourceFormat: SourceFormat;
  contentHash: string;
  rowResultHash: string;
  confirmationId: string;
  previewId: string;
  batchId: string;
  sourceFileId: string;
  fileVersionId: string;
  sourceSha256: string;
  contractHash: string;
  transformationHash: string;
  previewHash: string;
  confirmedAt: string;
  actor: string;
  status: "confirmed";
  reused: boolean;
};

export type SourceInspection = {
  sourceFileId: string;
  fileVersionId: string;
  sourceSha256: string;
  sourceFormat: SourceFormat;
  sheets?: SheetSelection[];
  headers: HeaderDescriptor[];
  schemaId: string;
  schema: SourceSchemaVersion;
  parserProfileId: string;
  limitsProfileId: string;
};
