import "server-only";

import { randomUUID } from "node:crypto";
import { persistOpaqueUpload } from "./file-repository";

export const consolidatedSourceUploadLimitBytes = 50 * 1024 * 1024;
export const consolidatedSourceLabel = "Base consolidada de aplicação de recursos";

export class ConsolidatedSourceUploadError extends Error {
  constructor(message: string, readonly code: "invalid" | "too-large" | "disabled") {
    super(message);
    this.name = "ConsolidatedSourceUploadError";
  }
}

type SourceFormat = "XLS" | "XLSX" | "CSV";

function strictPositiveSize(value: string | null) {
  if (!value || !/^[1-9][0-9]*$/.test(value)) {
    throw new ConsolidatedSourceUploadError("Tamanho declarado inválido.", "invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConsolidatedSourceUploadError("Tamanho declarado inválido.", "invalid");
  }
  return parsed;
}

function safeMediaType(value: string | null) {
  return value && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)
    ? value.slice(0, 200)
    : "application/octet-stream";
}

export function validateConsolidatedSourceUploadMetadata(input: {
  originalName: string;
  declaredSize: string | null;
  transportSize: string | null;
  mediaType: string | null;
}) {
  const declaredSize = strictPositiveSize(input.declaredSize);
  const transportSize = strictPositiveSize(input.transportSize);
  if (declaredSize > consolidatedSourceUploadLimitBytes || transportSize > consolidatedSourceUploadLimitBytes) {
    throw new ConsolidatedSourceUploadError("O arquivo excede 50 MiB.", "too-large");
  }
  if (declaredSize !== transportSize) {
    throw new ConsolidatedSourceUploadError("Os tamanhos declarados divergem.", "invalid");
  }
  const originalName = input.originalName.normalize("NFC");
  if (originalName.length < 5 || originalName.length > 255 || originalName.trim() !== originalName ||
      /[\\/\u0000-\u001f\u007f]/.test(originalName)) {
    throw new ConsolidatedSourceUploadError("Nome de arquivo inválido.", "invalid");
  }
  const match = /^([^.]+)\.(xls|xlsx|csv)$/i.exec(originalName);
  if (!match) throw new ConsolidatedSourceUploadError("Use um arquivo XLS, XLSX ou CSV.", "invalid");
  return {
    originalName,
    expectedSize: declaredSize,
    format: match[2].toUpperCase() as SourceFormat,
    mediaType: safeMediaType(input.mediaType),
  };
}

export function realSourceUploadEnabled() {
  const mode = process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD;
  return process.env.TRIA_RUNTIME === "railway" ? mode === "authenticated-owner" : mode === "local-owner";
}

export function consolidatedSourceUploadEnabled() {
  if (realSourceUploadEnabled()) return true;
  return process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD === "synthetic-fixtures-only" &&
    process.env.TRIA_RUNTIME !== "railway" &&
    process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
    /^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
}

export type ConsolidatedSourceReceipt = {
  receiptId: string;
  format: SourceFormat;
  sizeBytes: number;
  receivedAt: string;
  status: "protected";
};

export function sanitizedConsolidatedSourceReceipt(receipt: ConsolidatedSourceReceipt): ConsolidatedSourceReceipt {
  return {
    receiptId: receipt.receiptId,
    format: receipt.format,
    sizeBytes: receipt.sizeBytes,
    receivedAt: receipt.receivedAt,
    status: "protected",
  };
}

export async function receiveConsolidatedSource(input: {
  originalName: string;
  declaredSize: string | null;
  transportSize: string | null;
  mediaType: string | null;
  body: ReadableStream<Uint8Array> | null;
}) {
  if (!consolidatedSourceUploadEnabled()) {
    throw new ConsolidatedSourceUploadError("Recebimento de fonte desativado.", "disabled");
  }
  const metadata = validateConsolidatedSourceUploadMetadata(input);
  const sourceId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  return persistOpaqueUpload({
    expectedSize: metadata.expectedSize,
    body: input.body,
    catalog: async (tx, artifact) => {
      await tx`INSERT INTO file_document
        (id, project_id, title, status, created_at, updated_at, include_in_publication, document_kind)
        VALUES (${documentId}, NULL, ${consolidatedSourceLabel}, 'active', ${artifact.createdAt}, ${artifact.createdAt}, false, 'source')`;
      await tx`INSERT INTO file_version
        (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
        VALUES (${versionId}, ${documentId}, 1, ${artifact.objectKey}, ${metadata.originalName}, ${metadata.mediaType},
          ${artifact.size}, ${artifact.sha256}, 'active', ${artifact.createdAt})`;
      await tx`INSERT INTO source_file
        (id, document_id, file_version_id, source_format, received_by, received_at)
        VALUES (${sourceId}, ${documentId}, ${versionId}, ${metadata.format.toLowerCase()}, 'Rodrigo', ${artifact.createdAt})`;
      await tx`INSERT INTO source_file_event
        (id, source_file_id, operation, byte_count, actor, occurred_at)
        VALUES (${randomUUID()}, ${sourceId}, 'source.file.received.v1', ${artifact.size}, 'Rodrigo', ${artifact.createdAt})`;
      if (!realSourceUploadEnabled()) {
      await tx`SELECT set_config('tria.synthetic_namespace', ${process.env.TRIA_INTEGRATION_NAMESPACE ?? ""}, true)`;
      await tx`SELECT attest_new_synthetic_receipt(${sourceId}::uuid)`;
      }
      return sanitizedConsolidatedSourceReceipt({
        receiptId: sourceId,
        format: metadata.format,
        sizeBytes: artifact.size,
        receivedAt: artifact.createdAt,
        status: "protected",
      });
    },
  });
}
