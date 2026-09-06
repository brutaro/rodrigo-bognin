import { randomUUID } from "node:crypto";
import type { SourceFileDescriptor, SourceFileReader, ExactSourceReference, VerifiedSourceBytes } from "../domain/ports";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import type { ImportPreparationRepository, RejectedPreparation } from "../application/repository";

export type SyntheticSourceFixture = Omit<SourceFileDescriptor, "status" | "sha256" | "syntheticAttested"> & { sha256?: string; sourceSha256?: string; status?: SourceFileDescriptor["status"]; bytes: Uint8Array };

export class InMemorySourceFileReader implements SourceFileReader {
  readonly adapterKind = "memory-test" as const;
  openCount = 0;
  private readonly fixtures = new Map<string, SourceFileDescriptor & { bytes: Uint8Array }>();

  constructor(fixtures: SyntheticSourceFixture[]) {
    for (const fixture of fixtures) {
      const sha256 = fixture.sha256 ?? fixture.sourceSha256;
      if (!sha256) throw new Error("Fixture sem SHA-256.");
      this.fixtures.set(fixture.sourceFileId, { sourceFileId: fixture.sourceFileId, fileVersionId: fixture.fileVersionId, sha256, sourceFormat: fixture.sourceFormat, sizeBytes: fixture.sizeBytes, status: fixture.status ?? "active", namespace: fixture.namespace, syntheticAttested: true, bytes: fixture.bytes.slice() });
    }
  }

  async resolveSourceFile(sourceFileId: string) {
    const fixture = this.fixtures.get(sourceFileId);
    if (!fixture) return undefined;
    return { sourceFileId: fixture.sourceFileId, fileVersionId: fixture.fileVersionId, sha256: fixture.sha256, sourceFormat: fixture.sourceFormat, sizeBytes: fixture.sizeBytes, status: fixture.status, namespace: fixture.namespace, syntheticAttested: true as const };
  }

  async resolveExact(reference: ExactSourceReference) {
    const fixture = this.fixtures.get(reference.sourceFileId);
    if (!fixture || fixture.fileVersionId !== reference.fileVersionId || fixture.sha256 !== reference.sha256 || fixture.sourceFormat !== reference.sourceFormat) return undefined;
    return { sourceFileId: fixture.sourceFileId, fileVersionId: fixture.fileVersionId, sha256: fixture.sha256, sourceFormat: fixture.sourceFormat, sizeBytes: fixture.sizeBytes, status: fixture.status, namespace: fixture.namespace, syntheticAttested: true as const };
  }

  async openExact(reference: ExactSourceReference): Promise<VerifiedSourceBytes> {
    const fixture = await this.resolveExact(reference);
    const source = this.fixtures.get(reference.sourceFileId);
    if (!fixture || !source || source.bytes.byteLength !== source.sizeBytes) throw new Error("Fonte exata não disponível.");
    this.openCount += 1;
    return { descriptor: fixture, bytes: source.bytes.slice() };
  }
}

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

export type AuditEvent = {
  type: "source.import.preview_prepared.v1" | "source.import.preview_confirmed.v1";
  id: string;
  previewId: string;
  actor: string;
  occurredAt: string;
  requestId?: string;
};

export class InMemoryImportPreparationRepository implements ImportPreparationRepository {
  private readonly previewsByFingerprint = new Map<string, StoredPreparedPreview>();
  private readonly previewsByIdempotency = new Map<string, StoredPreparedPreview>();
  private readonly previewsById = new Map<string, StoredPreparedPreview>();
  private readonly confirmationsByIdempotency = new Map<string, StoredConfirmation>();
  private readonly confirmationsByPreview = new Map<string, StoredConfirmation>();
  private readonly events: AuditEvent[] = [];
  private readonly rejections: RejectedPreparation[] = [];

  get preparedCount() { return this.previewsById.size; }
  get confirmationCount() { return this.confirmationsByPreview.size; }
  get rejectedCount() { return this.rejections.length; }
  get auditEvents() { return [...this.events]; }

  async findPreparedByFingerprint(fingerprint: string) { return this.previewsByFingerprint.get(fingerprint); }
  async findPreparedByIdempotencyKey(idempotencyKey: string) { return this.previewsByIdempotency.get(idempotencyKey); }
  async findRejectedByIdempotencyKey(idempotencyKey: string) { return this.rejections.find((item) => item.idempotencyKey === idempotencyKey); }
  async findPreview(previewId: string) { return this.previewsById.get(previewId); }
  async findConfirmationByIdempotencyKey(idempotencyKey: string) { return this.confirmationsByIdempotency.get(idempotencyKey); }
  async findConfirmationByPreview(previewId: string) { return this.confirmationsByPreview.get(previewId); }

  async savePrepared(value: Omit<StoredPreparedPreview, "preview"> & { preview: Preview }) {
    const byFingerprint = this.previewsByFingerprint.get(value.fingerprint);
    if (byFingerprint) return byFingerprint;
    const byKey = this.previewsByIdempotency.get(value.idempotencyKey);
    if (byKey) return byKey;
    const stored = { ...value, preview: structuredClone(value.preview) };
    this.previewsByFingerprint.set(stored.fingerprint, stored);
    this.previewsByIdempotency.set(stored.idempotencyKey, stored);
    this.previewsById.set(stored.preview.previewId, stored);
    this.events.push({ type: "source.import.preview_prepared.v1", id: randomUUID(), previewId: stored.preview.previewId, actor: stored.preview.actor, occurredAt: stored.preview.preparedAt, ...(stored.requestId ? { requestId: stored.requestId } : {}) });
    return stored;
  }

  async saveConfirmation(value: StoredConfirmation) {
    const byKey = this.confirmationsByIdempotency.get(value.idempotencyKey);
    if (byKey) return byKey;
    const byPreview = this.confirmationsByPreview.get(value.confirmation.previewId);
    if (byPreview) return byPreview;
    const stored = { ...value, confirmation: structuredClone(value.confirmation) };
    this.confirmationsByIdempotency.set(stored.idempotencyKey, stored);
    this.confirmationsByPreview.set(stored.confirmation.previewId, stored);
    this.events.push({ type: "source.import.preview_confirmed.v1", id: randomUUID(), previewId: stored.confirmation.previewId, actor: stored.confirmation.actor, occurredAt: stored.confirmation.confirmedAt, ...(stored.requestId ? { requestId: stored.requestId } : {}) });
    return stored;
  }

  async recordRejected(value: RejectedPreparation) {
    if (this.rejections.some((item) => item.idempotencyKey === value.idempotencyKey)) return;
    this.rejections.push(structuredClone(value));
  }

  snapshot() {
    return {
      previews: [...this.previewsById.values()].map((item) => structuredClone(item)),
      confirmations: [...this.confirmationsByPreview.values()].map((item) => structuredClone(item)),
      rejections: structuredClone(this.rejections),
      events: [...this.events],
    };
  }
}
