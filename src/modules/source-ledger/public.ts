import {
  SourceLedgerService,
  type ConfirmImportPreviewCommand,
  type PrepareImportPreviewCommand,
  type InspectSourceCommand,
} from "./application/prepare-import-preview";
import type { ImportPreparationRepository } from "./application/repository";
import type { SourceFileReader } from "./domain/ports";
import type {
  CsvParseOptions,
  HeaderDescriptor,
  HeaderMapping,
  ImportContract,
  ParserLimits,
  SheetSelection,
  SourceFormat,
  SourceSchemaField,
  SourceSchemaVersion,
  RegistrySelection,
} from "./domain/import-contract";
import type {
  ImportError,
  Preview,
  PreviewConfirmation,
  PrepareImportPreviewResult,
  SourceInspection,
} from "./domain/dtos";
import type { HeaderMappingSelection } from "./domain/header-mapping";
import type { PublicReconciliation as PublicReconciliationShape } from "./domain/reconciliation";
import type { ReconciliationDecisionReceipt as DecisionReceiptShape } from "./application/reconciliation-repository";
import type { PublicReconciliationApplyResult as PublicApplyResultShape } from "./application/reconcile-import";

export type {
  CsvParseOptions,
  HeaderDescriptor,
  HeaderMapping,
  ImportContract,
  ParserLimits,
  SheetSelection,
  SourceFormat,
  SourceSchemaField,
  SourceSchemaVersion,
  RegistrySelection,
};
export type { SourceFileReader } from "./domain/ports";
export type { ImportPreparationRepository } from "./application/repository";

export type ConsolidatedSourceDescriptorDTO = {
  sourceFileId: string;
  fileVersionId: string;
  sourceSha256: string;
  sourceFormat: SourceFormat;
  sizeBytes: number;
  status: "active";
};
export type SheetOptionDTO = SheetSelection;
export type CsvParseOptionsDTO = CsvParseOptions;
export type HeaderMappingDTO = HeaderMapping;
export type HeaderMappingSelectionDTO = HeaderMappingSelection;
export type { HeaderMappingSelection };
export type PrepareImportPreviewResultDTO = PrepareImportPreviewResult;
export type PreviewConfirmationDTO = PreviewConfirmation;
export type {
  ImportError,
  Preview,
  PreviewConfirmation,
  PrepareImportPreviewResult,
  SourceInspection,
};
export type { ConfirmImportPreviewCommand, PrepareImportPreviewCommand, InspectSourceCommand };
export { SourceLedgerError, SourceLedgerService, syntheticProcessingEnabled } from "./application/prepare-import-preview";
export { syntheticRegistryIds, resolveSyntheticImportRegistry } from "./domain/import-registry";
export {
  SourceReconciliationError,
  SourceReconciliationService,
  syntheticReconciliationEnabled,
  type ApplyReconciliationCommand,
  type ReconcileConfirmedPreviewCommand,
  type RecordReconciliationDecisionCommand,
  type PublicReconciliationApplyResult,
} from "./application/reconcile-import";
export { ReconciliationRevisionConflict, ReconciliationIdempotencyConflict } from "./application/reconciliation-repository";
export type { AbsencePage, SourceReconciliationRepository, ReconciliationDecisionReceipt, StableRecordContext, StableRecordPage, StoredReconciliation } from "./application/reconciliation-repository";
export {
  buildRecordMatch,
  applyReconciliationDecision,
  createSourceObservation,
  createStableRecordId,
  eventsForReconciliation,
  reconcileConfirmedPreview,
  reduceEffectiveProjection,
  sumExactDecimals,
  sumExactDurations,
  compareExactDecimals,
  compareExactDurations,
  formatExactDurationSeconds,
  compareOfficialValues,
  orderOfficialLines,
  IGNORED_RECONCILIATION_FIELDS,
  SERVER_OWNED_RECONCILIATION_POLICY_VERSION,
} from "./domain/reconciliation";
export type {
  AbsenceCoverage,
  DecisionOutcome,
  EffectiveRecordEvent,
  EffectiveRecordProjection,
  EffectiveSnapshot,
  ImportConflict,
  MatchOutcome,
  MatchingPolicy,
  PublicReconciliation,
  ReconciliationCategory,
  ReconciliationDecision,
  ReconciliationMetrics,
  ReconciliationLine,
  ReconciliationStatus,
  RecordMatch,
  SourceObservation,
  StableRecord,
  ExactDecimalSource,
  ExactDurationSource,
  OfficialOrdering,
} from "./domain/reconciliation";

/** Compatibility names used by the immutable Story 3.3 action boundary. Both aliases describe only public payloads. */
export type Reconciliation = PublicReconciliationShape | DecisionReceiptShape;
export type ReconciliationApplyResult = PublicApplyResultShape;

export function createSourceLedgerService(dependencies: { reader: SourceFileReader; repository: ImportPreparationRepository }) {
  return new SourceLedgerService(dependencies);
}

export { getSourceLedgerService } from "./server";
export { getSourceReconciliationService } from "./reconciliation-server";
