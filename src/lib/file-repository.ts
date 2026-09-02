import "server-only";

import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getSql } from "./database";
import {
  assertFileStore,
  createVerifiedStagingSnapshot,
  listStoredKeys,
  openStagingNodeStream,
  removeStagingObject,
  removeStoredObject,
  removeVerifiedStagingSnapshot,
  verifyStoredObject,
  writeUploadObject,
} from "./file-store";

export const fileQuotaBytes = 4_000_000_000;

declare global { var triaFileOperation: Promise<void> | undefined; }

export async function acquireFileOperation() {
  const previous = globalThis.triaFileOperation ?? Promise.resolve();
  let releaseLocal!: () => void;
  globalThis.triaFileOperation = new Promise<void>((resolve) => { releaseLocal = resolve; });
  await previous;
  let connection: Awaited<ReturnType<ReturnType<typeof getSql>["reserve"]>> | undefined;
  try {
    connection = await getSql().reserve();
    await connection`SELECT pg_advisory_lock(810245731)`;
  } catch (error) {
    connection?.release();
    releaseLocal();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    void connection`SELECT pg_advisory_unlock(810245731)`.catch(() => undefined).finally(() => {
      connection.release();
      releaseLocal();
    });
  };
}

export async function withFileOperation<TResult>(operation: () => Promise<TResult>) {
  const release = await acquireFileOperation();
  try { return await operation(); } finally { release(); }
}

export async function assertBoundFileStore() {
  const store = await assertFileStore();
  const sql = getSql();
  const [counter] = await sql<{ volume_uuid: string | null }[]>`SELECT volume_uuid::text FROM file_store_counter WHERE singleton`;
  if (!counter?.volume_uuid || counter.volume_uuid !== store.uuid) {
    throw new FileRepositoryError("Volume não corresponde ao banco.", "unavailable");
  }
  return store;
}

export class FileRepositoryError extends Error {
  constructor(message: string, readonly code: "quota" | "not-found" | "invalid" | "unavailable" = "invalid") {
    super(message);
    this.name = "FileRepositoryError";
  }
}

export type FileVersionRecord = {
  id: string; documentId: string; projectId?: string; evidenceAssetId?: string; version: number; objectKey: string; originalName: string;
  mediaType: string; sizeBytes: number; sha256: string; status: "active" | "purging"; createdAt: string;
};

export type FileDocumentRecord = {
  id: string; projectId: string; title: string; status: "active" | "purging"; includeInPublication: boolean;
  createdAt: string; updatedAt: string; versions: FileVersionRecord[];
};

function normalizeName(value: string) {
  const normalized = value.normalize("NFC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  return (normalized || "arquivo").slice(0, 255);
}

function normalizeTitle(value: string, fallback: string) {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (normalized || fallback).slice(0, 200);
}

function normalizeMediaType(value: string | null) {
  return value && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value) ? value.slice(0, 200) : "application/octet-stream";
}

async function reserveBytes(expectedSize: number, allocateObjectKey = true) {
  const id = randomUUID();
  const objectKey = allocateObjectKey ? randomUUID() : null;
  const sql = getSql();
  await sql.begin(async (tx) => {
    const [counter] = await tx<{ used_bytes: string; reserved_bytes: string; quota_bytes: string }[]>`
      SELECT used_bytes::text, reserved_bytes::text, quota_bytes::text FROM file_store_counter WHERE singleton FOR UPDATE`;
    if (!counter) throw new FileRepositoryError("Contador do cofre ausente.", "unavailable");
    if (BigInt(counter.used_bytes) + BigInt(counter.reserved_bytes) + BigInt(expectedSize) > BigInt(counter.quota_bytes)) {
      throw new FileRepositoryError("Quota de arquivos esgotada.", "quota");
    }
    await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes + ${expectedSize} WHERE singleton`;
    await tx`INSERT INTO file_reservation (id, reserved_bytes, object_key, status, created_at, expires_at)
      VALUES (${id}, ${expectedSize}, ${objectKey}, 'reserved', now(), now() + interval '1 hour')`;
  });
  return { id, objectKey };
}

async function releaseReservation(id: string) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    const [reservation] = await tx<{ reserved_bytes: string; status: string }[]>`
      SELECT reserved_bytes::text, status FROM file_reservation WHERE id = ${id} FOR UPDATE`;
    if (!reservation || reservation.status !== "reserved") return;
    await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes - ${reservation.reserved_bytes} WHERE singleton`;
    await tx`UPDATE file_reservation SET status = 'released' WHERE id = ${id}`;
  });
}

export type OpaqueUploadArtifact = {
  reservationId: string;
  objectKey: string;
  size: number;
  sha256: string;
  createdAt: string;
};

export async function persistOpaqueUpload<TResult>(input: {
  expectedSize: number;
  body: ReadableStream<Uint8Array> | null;
  beforeStore?: () => Promise<void>;
  catalog: (tx: TransactionSql, artifact: OpaqueUploadArtifact) => Promise<TResult>;
}) {
  if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize <= 0 || input.expectedSize > fileQuotaBytes) {
    throw new FileRepositoryError("Tamanho de arquivo inválido.", "invalid");
  }
  return withFileOperation(async () => {
    const store = await reconcileFileStoreInternal();
    await input.beforeStore?.();
    const safetyMargin = BigInt(16 * 1024 * 1024);
    if (store.availableBytes < BigInt(input.expectedSize) + safetyMargin) {
      throw new FileRepositoryError("Espaço físico insuficiente no volume.", "quota");
    }
    const reservation = await reserveBytes(input.expectedSize);
    if (!reservation.objectKey) throw new FileRepositoryError("Reserva de objeto inválida.", "unavailable");
    const objectKey = reservation.objectKey;
    let stored = false;
    try {
      const integrity = await writeUploadObject(input.body, reservation.id, objectKey, input.expectedSize);
      stored = true;
      const sql = getSql();
      return await sql.begin(async (tx) => {
        const [held] = await tx<{ reserved_bytes: string; status: string }[]>`
          SELECT reserved_bytes::text, status FROM file_reservation WHERE id = ${reservation.id} FOR UPDATE`;
        if (!held || held.status !== "reserved" || Number(held.reserved_bytes) !== integrity.size) {
          throw new FileRepositoryError("Reserva de upload inválida.", "unavailable");
        }
        const result = await input.catalog(tx, {
          reservationId: reservation.id,
          objectKey,
          size: integrity.size,
          sha256: integrity.sha256,
          createdAt: new Date().toISOString(),
        });
        await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes - ${integrity.size}, used_bytes = used_bytes + ${integrity.size} WHERE singleton`;
        await tx`UPDATE file_reservation SET status = 'committed' WHERE id = ${reservation.id}`;
        return result;
      });
    } catch (error) {
      if (!stored) {
        await removeStagingObject(reservation.id);
        await releaseReservation(reservation.id);
      } else {
        let referenced: boolean | undefined;
        try {
          const rows = await getSql()`SELECT id FROM file_version WHERE object_key = ${objectKey}`;
          referenced = rows.length > 0;
        } catch { referenced = undefined; }
        if (referenced === false) {
          await removeStoredObject(objectKey);
          await releaseReservation(reservation.id);
        }
      }
      throw error;
    }
  });
}

async function validateUploadTarget(projectId: string, documentId?: string | null) {
  const sql = getSql();
  const rows = documentId
    ? await sql`SELECT d.id FROM file_document d WHERE d.id = ${documentId} AND d.document_kind = 'project' AND d.project_id = ${projectId} AND d.status = 'active'`
    : await sql`SELECT id FROM project WHERE id = ${projectId}`;
  if (!rows.length) throw new FileRepositoryError(documentId ? "Arquivo não encontrado." : "Projeto não encontrado.", "not-found");
}

export async function uploadProjectFile(input: {
  projectId: string; documentId?: string | null; title: string; originalName: string;
  mediaType: string | null; expectedSize: number; body: ReadableStream<Uint8Array> | null;
}) {
  return persistOpaqueUpload({
    expectedSize: input.expectedSize,
    body: input.body,
    beforeStore: () => validateUploadTarget(input.projectId, input.documentId),
    catalog: async (tx, artifact) => {
      let documentId = input.documentId ?? null;
      let version = 1;
      const originalName = normalizeName(input.originalName);
      if (documentId) {
        const [document] = await tx<{ id: string }[]>`
          SELECT id::text FROM file_document WHERE id = ${documentId} AND document_kind = 'project' AND project_id = ${input.projectId} AND status = 'active' FOR UPDATE`;
        if (!document) throw new FileRepositoryError("Arquivo não encontrado.", "not-found");
        const [latest] = await tx<{ version: number }[]>`SELECT version FROM file_version WHERE document_id = ${documentId} ORDER BY version DESC LIMIT 1`;
        version = (latest?.version ?? 0) + 1;
        await tx`UPDATE file_document SET title = ${normalizeTitle(input.title, originalName)}, updated_at = ${artifact.createdAt} WHERE id = ${documentId}`;
      } else {
        documentId = randomUUID();
        await tx`INSERT INTO file_document (id, project_id, title, status, created_at, updated_at)
          VALUES (${documentId}, ${input.projectId}, ${normalizeTitle(input.title, originalName)}, 'active', ${artifact.createdAt}, ${artifact.createdAt})`;
      }
      const versionId = randomUUID();
      await tx`INSERT INTO file_version
        (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
        VALUES (${versionId}, ${documentId}, ${version}, ${artifact.objectKey}, ${originalName},
          ${normalizeMediaType(input.mediaType)}, ${artifact.size}, ${artifact.sha256}, 'active', ${artifact.createdAt})`;
      await tx`UPDATE project_draft SET revision = revision + 1, updated_at = ${artifact.createdAt} WHERE project_id = ${input.projectId}`;
      await tx`INSERT INTO file_operation_event
        (id, project_id, operation, byte_count, version_count, publication_count, actor, occurred_at)
        VALUES (${randomUUID()}, ${input.projectId}, 'upload_version', ${artifact.size}, 1, 0, 'Rodrigo', ${artifact.createdAt})`;
      return { documentId, versionId, version, size: artifact.size, sha256: artifact.sha256 };
    },
  });
}

export async function listProjectFiles(projectId: string) {
  const sql = getSql();
  const rows = await sql<{
    document_id: string; project_id: string; title: string; document_status: "active" | "purging"; include_in_publication: boolean;
    document_created_at: string; document_updated_at: string; version_id: string; version: number;
    object_key: string; original_name: string; media_type: string; size_bytes: string; sha256: string;
    version_status: "active" | "purging"; version_created_at: string;
  }[]>`SELECT d.id::text document_id, d.project_id, d.title, d.status document_status, d.include_in_publication,
      d.created_at::text document_created_at, d.updated_at::text document_updated_at,
      v.id::text version_id, v.version, v.object_key::text, v.original_name, v.media_type,
      v.size_bytes::text, v.sha256, v.status version_status, v.created_at::text version_created_at
    FROM file_document d JOIN file_version v ON v.document_id = d.id
    WHERE d.document_kind = 'project' AND d.project_id = ${projectId} ORDER BY d.created_at, d.id, v.version DESC`;
  const documents = new Map<string, FileDocumentRecord>();
  for (const row of rows) {
    let document = documents.get(row.document_id);
    if (!document) {
      document = { id: row.document_id, projectId: row.project_id, title: row.title, status: row.document_status,
        includeInPublication: row.include_in_publication, createdAt: row.document_created_at, updatedAt: row.document_updated_at, versions: [] };
      documents.set(row.document_id, document);
    }
    document.versions.push({ id: row.version_id, documentId: row.document_id, version: row.version,
      objectKey: row.object_key, originalName: row.original_name, mediaType: row.media_type,
      sizeBytes: Number(row.size_bytes), sha256: row.sha256, status: row.version_status, createdAt: row.version_created_at });
  }
  return [...documents.values()];
}

export function currentPublishedFiles(documents: FileDocumentRecord[]) {
  return documents.filter((document) => document.status === "active" && document.includeInPublication).flatMap((document) => {
    const version = document.versions.find((item) => item.status === "active");
    return version ? [{ documentId: document.id, versionId: version.id, title: document.title,
      version: version.version, originalName: version.originalName, mediaType: version.mediaType,
      sizeBytes: version.sizeBytes, sha256: version.sha256 }] : [];
  });
}

export async function setFilePublicationInclusion(documentId: string, include: boolean) {
  return withFileOperation(async () => {
    const sql = getSql();
    return sql.begin(async (tx) => {
      const [updated] = await tx<{ project_id: string }[]>`
        UPDATE file_document SET include_in_publication = ${include}, updated_at = now()
        WHERE id = ${documentId} AND document_kind = 'project' AND project_id IS NOT NULL AND status = 'active' AND include_in_publication IS DISTINCT FROM ${include}
        RETURNING project_id`;
      if (!updated) {
        const [existing] = await tx<{ project_id: string }[]>`SELECT project_id FROM file_document WHERE id = ${documentId} AND document_kind = 'project' AND project_id IS NOT NULL AND status = 'active'`;
        if (!existing) throw new FileRepositoryError("Arquivo não encontrado.", "not-found");
        return { changed: false, include };
      }
      await tx`UPDATE project_draft SET revision = revision + 1, updated_at = now() WHERE project_id = ${updated.project_id}`;
      await tx`INSERT INTO file_operation_event
        (id, project_id, operation, byte_count, version_count, publication_count, actor, occurred_at)
        VALUES (${randomUUID()}, ${updated.project_id}, ${include ? "publication_include" : "publication_exclude"}, 0, 0, 0, 'Rodrigo', now())`;
      return { changed: true, include };
    });
  });
}

export async function readFileVersion(versionId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId)) return undefined;
  const sql = getSql();
  const [row] = await sql<{
    id: string; document_id: string; project_id: string | null; version: number; object_key: string; original_name: string;
    media_type: string; size_bytes: string; sha256: string; evidence_asset_id: string | null;
    status: "active" | "purging"; created_at: string;
  }[]>`SELECT v.id::text, v.document_id::text, d.project_id, v.evidence_asset_id,
      v.version, v.object_key::text, v.original_name, v.media_type, v.size_bytes::text, v.sha256, v.status, v.created_at::text
    FROM file_version v JOIN file_document d ON d.id = v.document_id
    WHERE v.id = ${versionId} AND v.status = 'active' AND d.status = 'active' AND d.document_kind <> 'source'`;
  return row ? { id: row.id, documentId: row.document_id, projectId: row.project_id ?? undefined,
    evidenceAssetId: row.evidence_asset_id ?? undefined, version: row.version, objectKey: row.object_key,
    originalName: row.original_name, mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes), sha256: row.sha256, status: row.status, createdAt: row.created_at } satisfies FileVersionRecord : undefined;
}

export type FileOperation = "upload_version" | "publication_include" | "publication_exclude" | "download" | "backup_prepared" | "purge";

export async function recordFileOperation(input: {
  projectId?: string | null; operation: FileOperation; byteCount?: number; versionCount?: number; publicationCount?: number;
}) {
  const sql = getSql();
  await sql`INSERT INTO file_operation_event
    (id, project_id, operation, byte_count, version_count, publication_count, actor, occurred_at)
    VALUES (${randomUUID()}, ${input.projectId ?? null}, ${input.operation}, ${input.byteCount ?? 0},
      ${input.versionCount ?? 0}, ${input.publicationCount ?? 0}, 'Rodrigo', now())`;
}

export async function prepareFileDownload(versionId: string, auditProjectId?: string) {
  const releaseOperation = await acquireFileOperation();
  let reservation: { id: string; objectKey: string | null } | undefined;
  try {
    const store = await reconcileFileStoreInternal();
    const version = await readFileVersion(versionId);
    if (!version) { releaseOperation(); return undefined; }
    if (version.evidenceAssetId) {
      if (!auditProjectId) { releaseOperation(); return undefined; }
      const links = await getSql()`SELECT 1 FROM project_evidence WHERE project_id = ${auditProjectId} AND evidence_asset_id = ${version.evidenceAssetId}`;
      if (!links.length) { releaseOperation(); return undefined; }
    } else if (auditProjectId && version.projectId !== auditProjectId) { releaseOperation(); return undefined; }
    const safetyMargin = BigInt(16 * 1024 * 1024);
    if (store.availableBytes < BigInt(version.sizeBytes) + safetyMargin) {
      throw new FileRepositoryError("Espaço insuficiente para verificar o download.", "unavailable");
    }
    reservation = await reserveBytes(version.sizeBytes, false);
    await createVerifiedStagingSnapshot(version.objectKey, reservation.id, version.sizeBytes, version.sha256);
    await recordFileOperation({ projectId: auditProjectId ?? version.projectId, operation: "download", byteCount: version.sizeBytes, versionCount: 1 });
    const source = await openStagingNodeStream(reservation.id);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      void (async () => {
        try { await removeVerifiedStagingSnapshot(reservation!.id); await releaseReservation(reservation!.id); }
        finally { releaseOperation(); }
      })().catch(() => undefined);
    };
    return { version, source, finish };
  } catch (error) {
    if (reservation) {
      await removeVerifiedStagingSnapshot(reservation.id);
      await releaseReservation(reservation.id);
    }
    releaseOperation();
    throw error;
  }
}

export async function prepareEvidenceDownload(projectId: string, evidenceAssetId: string) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(projectId) || !/^[0-9a-f]{64}$/.test(evidenceAssetId)) return undefined;
  const [row] = await getSql()<Array<{ version_id: string }>>`SELECT v.id::text version_id
    FROM project_evidence pe JOIN file_version v ON v.evidence_asset_id = pe.evidence_asset_id
    JOIN file_document d ON d.id = v.document_id
    WHERE pe.project_id = ${projectId} AND pe.evidence_asset_id = ${evidenceAssetId}
      AND v.status = 'active' AND d.status = 'active' AND d.document_kind = 'evidence'`;
  return row ? prepareFileDownload(row.version_id, projectId) : undefined;
}

export async function purgeFileDocument(documentId: string) {
  return withFileOperation(async () => {
    await reconcileFileStoreInternal();
    const sql = getSql();
    const state = await sql.begin(async (tx) => {
      const [document] = await tx<{ id: string; project_id: string }[]>`
        SELECT id::text, project_id FROM file_document WHERE id = ${documentId} AND document_kind = 'project' AND project_id IS NOT NULL FOR UPDATE`;
      if (!document) throw new FileRepositoryError("Arquivo não encontrado.", "not-found");
      await tx`UPDATE file_document SET status = 'purging', updated_at = now() WHERE id = ${documentId}`;
      await tx`UPDATE file_version SET status = 'purging' WHERE document_id = ${documentId}`;
      await tx`UPDATE project_draft SET revision = revision + 1, updated_at = now() WHERE project_id = ${document.project_id}`;
      const versions = await tx<{ object_key: string; size_bytes: string }[]>`
        SELECT object_key::text, size_bytes::text FROM file_version WHERE document_id = ${documentId} ORDER BY version`;
      return { projectId: document.project_id, versions };
    });
    for (const version of state.versions) await removeStoredObject(version.object_key);
    const [completed] = await sql<{ removed_versions: number; removed_publications: number }[]>`
      SELECT removed_versions, removed_publications FROM complete_file_purge(${documentId})`;
    if (!completed) throw new FileRepositoryError("Expurgo não pôde ser concluído.", "unavailable");
    return { removedVersions: completed.removed_versions, removedPublications: completed.removed_publications };
  });
}

async function reconcileFileStoreInternal() {
  const store = await assertBoundFileStore();
  const sql = getSql();
  const expired = await sql<{ id: string; reserved_bytes: string; object_key: string | null }[]>`
    SELECT id::text, reserved_bytes::text, object_key::text FROM file_reservation
    WHERE status = 'reserved' AND expires_at <= now() ORDER BY created_at`;
  for (const reservation of expired) {
    await removeStagingObject(reservation.id);
    if (reservation.object_key) {
      const referenced = await sql`SELECT 1 FROM file_version WHERE object_key = ${reservation.object_key}`;
      if (!referenced.length) await removeStoredObject(reservation.object_key);
    }
  }
  if (expired.length) await sql.begin(async (tx) => {
    const stillExpired = await tx<{ id: string; reserved_bytes: string }[]>`
      SELECT id::text, reserved_bytes::text FROM file_reservation
      WHERE status = 'reserved' AND expires_at <= now() AND id IN ${tx(expired.map((item) => item.id))} FOR UPDATE`;
    const total = stillExpired.reduce((sum, item) => sum + BigInt(item.reserved_bytes), BigInt(0));
    if (total) await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes - ${total.toString()} WHERE singleton`;
    if (stillExpired.length) await tx`UPDATE file_reservation SET status = 'released' WHERE id IN ${tx(stillExpired.map((item) => item.id))}`;
  });
  const [versions, reservations] = await Promise.all([
    sql<{ object_key: string }[]>`SELECT object_key::text FROM file_version`,
    sql<{ id: string; object_key: string }[]>`SELECT id::text, object_key::text FROM file_reservation WHERE status = 'reserved' AND expires_at > now() AND object_key IS NOT NULL`,
  ]);
  const allowedObjects = new Set([...versions.map((row) => row.object_key), ...reservations.map((row) => row.object_key)]);
  const allowedStaging = new Set(reservations.map((row) => row.id));
  for (const key of await listStoredKeys("objects")) if (!allowedObjects.has(key)) await removeStoredObject(key);
  for (const key of await listStoredKeys("staging")) if (!allowedStaging.has(key)) await removeStagingObject(key);
  return store;
}

export async function reconcileFileStore() {
  return withFileOperation(reconcileFileStoreInternal);
}

export async function tryReconcileFileStore() {
  const connection = await getSql().reserve();
  let locked = false;
  try {
    const [result] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(810245731) locked`;
    locked = result?.locked === true;
    if (!locked) return false;
    await reconcileFileStoreInternal();
    return true;
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(810245731)`.catch(() => undefined);
    connection.release();
  }
}

async function liveFileAccessControl() {
  const sql = getSql();
  const vaultTables = ["file_document", "file_version", "file_reservation", "file_store_counter", "publication_file", "file_operation_event", "publication", "source_file", "source_file_event"];
  const owners = await sql<{ tablename: string; tableowner: string }[]>`
    SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename IN ${sql(vaultTables)} ORDER BY tablename`;
  const tableAcl = await sql<{ object_name: string; grantee: string; privilege: string; grantable: boolean }[]>`
    SELECT c.relname object_name, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type privilege, a.is_grantable grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE n.nspname = 'public' AND c.relname IN ${sql(vaultTables)} AND a.grantee <> c.relowner
    ORDER BY 1,2,3`;
  const columnAcl = await sql<{ object_name: string; column_name: string; grantee: string; privilege: string; grantable: boolean }[]>`
    SELECT c.relname object_name, att.attname column_name,
      CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type privilege, a.is_grantable grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE n.nspname = 'public' AND c.relname IN ${sql(vaultTables)} AND att.attacl IS NOT NULL
    ORDER BY 1,2,3,4`;
  const functionAcl = await sql<{ object_name: string; owner: string; security_definer: boolean; configuration: string; grantee: string; privilege: string; grantable: boolean }[]>`
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' object_name,
      pg_get_userbyid(p.proowner) owner, p.prosecdef security_definer, array_to_string(p.proconfig, ',') configuration,
      CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type privilege, a.is_grantable grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public' AND p.proname = 'complete_file_purge' AND a.grantee <> p.proowner
    ORDER BY 1,4,5`;
  const schemaAcl = await sql<{ object_name: string; owner: string; grantee: string; privilege: string; grantable: boolean }[]>`
    SELECT n.nspname object_name, pg_get_userbyid(n.nspowner) owner, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type privilege, a.is_grantable grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee <> n.nspowner ORDER BY 1,2,3`;
  const databaseAcl = await sql<{ object_name: string; owner: string; grantee: string; privilege: string; grantable: boolean }[]>`
    SELECT d.datname object_name, pg_get_userbyid(d.datdba) owner, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type privilege, a.is_grantable grantable
    FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee <> d.datdba ORDER BY 1,2,3`;
  return { owner: "Rodrigo", policy: "owner-only", runtimeRole: "tria_app", directPublicationDelete: false,
    purgeFunction: "complete_file_purge(p_document_id uuid)", observed: { tableOwners: owners, tableAcl, columnAcl, functionAcl, schemaAcl, databaseAcl } };
}

function exactAcl(actual: Array<Record<string, unknown>>, keys: string[], expected: string[]) {
  const encoded = actual.map((row) => keys.map((key) => String(row[key])).join("|")).sort();
  return encoded.length === expected.length && encoded.every((value, index) => value === [...expected].sort()[index]);
}

function accessControlIsCanonical(access: Awaited<ReturnType<typeof liveFileAccessControl>>) {
  const observed = access.observed;
  const tableExpected = [
    "file_document|tria_app|SELECT|false",
    "file_operation_event|tria_app|INSERT|false", "file_operation_event|tria_app|SELECT|false",
    "file_reservation|tria_app|DELETE|false", "file_reservation|tria_app|INSERT|false", "file_reservation|tria_app|SELECT|false",
    "file_store_counter|tria_app|SELECT|false", "file_version|tria_app|SELECT|false",
    "publication|tria_app|INSERT|false", "publication|tria_app|SELECT|false",
    "publication_file|tria_app|INSERT|false", "publication_file|tria_app|SELECT|false",
    "source_file|tria_app|INSERT|false", "source_file|tria_app|SELECT|false",
    "source_file_event|tria_app|INSERT|false", "source_file_event|tria_app|SELECT|false",
  ];
  const columnExpected = [
    "file_document|created_at|tria_app|INSERT|false", "file_document|id|tria_app|INSERT|false",
    "file_document|document_kind|tria_app|INSERT|false",
    "file_document|include_in_publication|tria_app|INSERT|false", "file_document|project_id|tria_app|INSERT|false",
    "file_document|status|tria_app|INSERT|false", "file_document|title|tria_app|INSERT|false",
    "file_document|updated_at|tria_app|INSERT|false",
    "file_version|created_at|tria_app|INSERT|false", "file_version|document_id|tria_app|INSERT|false",
    "file_version|id|tria_app|INSERT|false", "file_version|media_type|tria_app|INSERT|false",
    "file_version|object_key|tria_app|INSERT|false", "file_version|original_name|tria_app|INSERT|false",
    "file_version|sha256|tria_app|INSERT|false", "file_version|size_bytes|tria_app|INSERT|false",
    "file_version|status|tria_app|INSERT|false", "file_version|version|tria_app|INSERT|false",
    "file_document|include_in_publication|tria_app|UPDATE|false", "file_document|status|tria_app|UPDATE|false",
    "file_document|title|tria_app|UPDATE|false", "file_document|updated_at|tria_app|UPDATE|false",
    "file_reservation|status|tria_app|UPDATE|false", "file_store_counter|reserved_bytes|tria_app|UPDATE|false",
    "file_store_counter|used_bytes|tria_app|UPDATE|false", "file_store_counter|volume_uuid|tria_app|UPDATE|false",
    "file_version|status|tria_app|UPDATE|false",
  ];
  return observed.tableOwners.length === 9 && observed.tableOwners.every((row) => row.tableowner === "tria_migrator") &&
    exactAcl(observed.tableAcl, ["object_name", "grantee", "privilege", "grantable"], tableExpected) && exactAcl(observed.columnAcl, ["object_name", "column_name", "grantee", "privilege", "grantable"], columnExpected) &&
    exactAcl(observed.functionAcl, ["object_name", "owner", "security_definer", "configuration", "grantee", "privilege", "grantable"], ["complete_file_purge(p_document_id uuid)|tria_migrator|true|search_path=pg_catalog, public|tria_app|EXECUTE|false"]) &&
    exactAcl(observed.schemaAcl, ["object_name", "owner", "grantee", "privilege", "grantable"], ["public|pg_database_owner|PUBLIC|USAGE|false", "public|pg_database_owner|tria_migrator|CREATE|false", "public|pg_database_owner|tria_migrator|USAGE|false"]) &&
    typeof observed.databaseAcl[0]?.object_name === "string" &&
    exactAcl(observed.databaseAcl, ["object_name", "owner", "grantee", "privilege", "grantable"], [`${observed.databaseAcl[0].object_name}|tria_admin|tria_app|CONNECT|false`,
      `${observed.databaseAcl[0].object_name}|tria_admin|tria_importer|CONNECT|false`, `${observed.databaseAcl[0].object_name}|tria_admin|tria_migrator|CONNECT|false`]);
}

export async function assertBackupCatalogReady() {
  const accessControl = await liveFileAccessControl();
  if (!accessControlIsCanonical(accessControl)) throw new FileRepositoryError("ACL do cofre divergiu.", "unavailable");
  const sql = getSql();
  const [state] = await sql<{ transitional: number; bad_links: number; used_bytes: string; catalog_bytes: string; reserved_bytes: string }[]>`
    SELECT
      (SELECT count(*)::int FROM file_document WHERE status <> 'active') + (SELECT count(*)::int FROM file_version WHERE status <> 'active') transitional,
      (SELECT count(*)::int FROM publication_file pf JOIN file_version v ON v.id = pf.file_version_id JOIN file_document d ON d.id = v.document_id
        WHERE v.status <> 'active' OR d.status <> 'active') bad_links,
      (SELECT used_bytes::text FROM file_store_counter WHERE singleton) used_bytes,
      (SELECT coalesce(sum(size_bytes), 0)::text FROM file_version) catalog_bytes,
      (SELECT reserved_bytes::text FROM file_store_counter WHERE singleton) reserved_bytes`;
  if (!state || state.transitional || state.bad_links || state.used_bytes !== state.catalog_bytes || state.reserved_bytes !== "0") {
    throw new FileRepositoryError("Catálogo em transição; backup recusado.", "unavailable");
  }
}

export async function canonicalFileCatalog() {
  const sql = getSql();
  const [counter] = await sql<{ quota_bytes: string; used_bytes: string; reserved_bytes: string }[]>`
    SELECT quota_bytes::text, used_bytes::text, reserved_bytes::text FROM file_store_counter WHERE singleton`;
  const documents = await sql`SELECT id::text id, project_id, document_kind, title, status, include_in_publication, created_at::text, updated_at::text
    FROM file_document WHERE status = 'active' ORDER BY id`;
  const versions = await sql`SELECT id::text id, document_id::text, version, object_key::text, original_name,
    media_type, size_bytes::text, sha256, evidence_asset_id, status, created_at::text FROM file_version WHERE status = 'active' ORDER BY id`;
  const publications = await sql`SELECT id::text id, project_id, version, content_hash FROM publication ORDER BY id`;
  const links = await sql`SELECT pf.publication_id::text, pf.file_version_id::text FROM publication_file pf
    JOIN publication p ON p.id = pf.publication_id JOIN file_version v ON v.id = pf.file_version_id
    JOIN file_document d ON d.id = v.document_id WHERE d.status = 'active' AND v.status = 'active'
    ORDER BY pf.publication_id, pf.file_version_id`;
  const sourceFiles = await sql`SELECT id::text id, document_id::text, file_version_id::text, source_format, received_by, received_at::text
    FROM source_file ORDER BY id`;
  const sourceEvents = await sql`SELECT id::text id, source_file_id::text, operation, byte_count::text, actor, occurred_at::text
    FROM source_file_event ORDER BY id`;
  const accessControl = await liveFileAccessControl();
  if (!accessControlIsCanonical(accessControl)) throw new FileRepositoryError("ACL do cofre divergiu.", "unavailable");
  return { format: "tria-file-catalog-v1", accessControl,
    quota: counter, documents, versions, publications, publicationLinks: links, sourceFiles, sourceEvents };
}

export async function activeObjectRecords() {
  const sql = getSql();
  const versions = await sql<{ object_key: string; size_bytes: string; sha256: string }[]>`
    SELECT object_key::text, size_bytes::text, sha256 FROM file_version WHERE status = 'active' ORDER BY object_key`;
  return versions.map((version) => ({ objectKey: version.object_key, sizeBytes: Number(version.size_bytes), sha256: version.sha256 }));
}

export async function verifyAllActiveObjects() {
  const sql = getSql();
  const versions = await sql<{ object_key: string; size_bytes: string; sha256: string }[]>`
    SELECT object_key::text, size_bytes::text, sha256 FROM file_version WHERE status = 'active' ORDER BY object_key`;
  for (const version of versions) await verifyStoredObject(version.object_key, Number(version.size_bytes), version.sha256);
  return versions.map((version) => ({ objectKey: version.object_key, sizeBytes: Number(version.size_bytes), sha256: version.sha256 }));
}
