import type { Preview, PreviewConfirmation } from "../domain/dtos";

export type StoredPreparedPreview = {
  preview: Preview;
  fingerprint: string;
  idempotencyKey: string;
  requestId?: string;
};

export type StoredConfirmation = {
  confirmation: PreviewConfirmation;
  payloadFingerprint: string;
  idempotencyKey: string;
  requestId?: string;
};

export type RejectedPreparation = {
  batchId: string;
  sourceFileId: string;
  fileVersionId: string;
  sourceSha256: string;
  sourceFormat: string;
  actor: string;
  requestId: string;
  idempotencyKey: string;
  fingerprint: string;
  code: string;
  message: string;
};

export interface ImportPreparationRepository {
  findPreparedByFingerprint(fingerprint: string): Promise<StoredPreparedPreview | undefined>;
  findPreparedByIdempotencyKey(idempotencyKey: string): Promise<StoredPreparedPreview | undefined>;
  findRejectedByIdempotencyKey(idempotencyKey: string): Promise<RejectedPreparation | undefined>;
  findPreview(previewId: string): Promise<StoredPreparedPreview | undefined>;
  savePrepared(value: StoredPreparedPreview): Promise<StoredPreparedPreview>;
  findConfirmationByIdempotencyKey(idempotencyKey: string): Promise<StoredConfirmation | undefined>;
  findConfirmationByPreview(previewId: string): Promise<StoredConfirmation | undefined>;
  saveConfirmation(value: StoredConfirmation): Promise<StoredConfirmation>;
  recordRejected(value: RejectedPreparation): Promise<void>;
}
