import "server-only";

import { createHash } from "node:crypto";
import { getSql } from "@/lib/database";
import { verifiedStoredObjectNodeStream } from "@/lib/file-store";
import type { ExactSourceReference, SourceFileDescriptor, SourceFileReader, VerifiedSourceBytes } from "../domain/ports";

const sourceLimitBytes = 50 * 1024 * 1024;
const namespacePattern = /^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/;

function isolatedRuntime() {
  return process.env.TRIA_RUNTIME !== "railway" &&
    process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
    namespacePattern.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
}

function toDescriptor(row: { source_file_id: string; file_version_id: string; sha256: string; source_format: string; size_bytes: string; namespace: string } | undefined) {
  if (!row || !isolatedRuntime() || row.namespace !== process.env.TRIA_INTEGRATION_NAMESPACE || Number(row.size_bytes) > sourceLimitBytes) return undefined;
  return {
    sourceFileId: row.source_file_id,
    fileVersionId: row.file_version_id,
    sha256: row.sha256,
    sourceFormat: row.source_format.toUpperCase() as SourceFileDescriptor["sourceFormat"],
    sizeBytes: Number(row.size_bytes),
    status: "active" as const,
    namespace: row.namespace,
    syntheticAttested: true as const,
  };
}

export class DatabaseSourceFileReader implements SourceFileReader {
  readonly adapterKind = "database" as const;

  async resolveSourceFile(sourceFileId: string): Promise<SourceFileDescriptor | undefined> {
    if (!isolatedRuntime()) return undefined;
    const [row] = await getSql()<Array<{ source_file_id: string; file_version_id: string; sha256: string; source_format: string; size_bytes: string; namespace: string }>>`
      SELECT sf.id::text source_file_id, sf.file_version_id::text file_version_id, v.sha256,
        upper(sf.source_format) source_format, v.size_bytes::text, att.namespace
      FROM source_file sf
      JOIN file_version v ON v.id = sf.file_version_id AND v.document_id = sf.document_id
      JOIN file_document d ON d.id = sf.document_id
      JOIN src_import_source_attestation att
        ON att.source_file_id = sf.id AND att.file_version_id = sf.file_version_id
      WHERE sf.id = ${sourceFileId} AND v.status = 'active' AND d.status = 'active'
        AND d.document_kind = 'source' AND att.attestation_kind = 'synthetic-seed-v1'
        AND att.file_version_id = v.id AND att.source_sha256 = v.sha256 AND upper(att.source_format) = upper(sf.source_format)`;
    return toDescriptor(row);
  }

  async resolveExact(reference: ExactSourceReference): Promise<SourceFileDescriptor | undefined> {
    const descriptor = await this.resolveSourceFile(reference.sourceFileId);
    return descriptor && descriptor.fileVersionId === reference.fileVersionId && descriptor.sha256 === reference.sha256 && descriptor.sourceFormat === reference.sourceFormat
      ? descriptor
      : undefined;
  }

  async openExact(reference: ExactSourceReference): Promise<VerifiedSourceBytes> {
    const descriptor = await this.resolveExact(reference);
    if (!descriptor) throw new Error("Fonte sintética não atestada ou não encontrada.");
    const [version] = await getSql()<Array<{ object_key: string }>>`
      SELECT v.object_key::text FROM source_file sf
      JOIN file_version v ON v.id = sf.file_version_id AND v.document_id = sf.document_id
      WHERE sf.id = ${reference.sourceFileId} AND sf.file_version_id = ${reference.fileVersionId}`;
    if (!version) throw new Error("Objeto da fonte sintética não encontrado.");
    const stream = await verifiedStoredObjectNodeStream(version.object_key, descriptor.sizeBytes, descriptor.sha256);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength !== descriptor.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) {
      throw new Error("Integridade da fonte sintética inválida.");
    }
    return { descriptor, bytes };
  }
}
