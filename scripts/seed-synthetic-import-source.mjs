#!/usr/bin/env node
import {assertSyntheticTarget} from "./assert-synthetic-target.mjs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const namespace = process.env.TRIA_INTEGRATION_NAMESPACE ?? "";
if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" ||
    process.env.TRIA_RUNTIME === "railway" ||
    !/^tria-adjustments-[a-z0-9_-]+$/.test(namespace)) {
  throw new Error("A fixture da Story 3.2 exige namespace tria-adjustments isolado e não pode rodar em Railway.");
}

const fixtureName = process.argv[2];
const fixtures = {
  primary: {
    sourceFileId: "42000000-0000-4000-8000-000000000001",
    documentId: "42000000-0000-4000-8000-000000001101",
    fileVersionId: "42000000-0000-4000-8000-000000002101",
    objectKey: "42000000-0000-4000-8000-000000003101",
    reservationId: "42000000-0000-4000-8000-000000004101",
  },
  copy: {
    sourceFileId: "42000000-0000-4000-8000-000000000002",
    documentId: "42000000-0000-4000-8000-000000001102",
    fileVersionId: "42000000-0000-4000-8000-000000002102",
    objectKey: "42000000-0000-4000-8000-000000003102",
    reservationId: "42000000-0000-4000-8000-000000004102",
  },
  unattested: {
    sourceFileId: "42000000-0000-4000-8000-000000000003",
    documentId: "42000000-0000-4000-8000-000000001103",
    fileVersionId: "42000000-0000-4000-8000-000000002103",
    objectKey: "42000000-0000-4000-8000-000000003103",
    reservationId: "42000000-0000-4000-8000-000000004103",
  },
  rejected: {
    sourceFileId: "42000000-0000-4000-8000-000000000004",
    documentId: "42000000-0000-4000-8000-000000001104",
    fileVersionId: "42000000-0000-4000-8000-000000002104",
    objectKey: "42000000-0000-4000-8000-000000003104",
    reservationId: "42000000-0000-4000-8000-000000004104",
  },
};
if (!fixtureName || !Object.hasOwn(fixtures, fixtureName)) throw new Error("Use primary, copy, unattested ou rejected.");
const fixture = fixtures[fixtureName];

const fileStorePath = process.env.TRIA_FILE_STORE_PATH;
const fileStoreUuidFile = process.env.TRIA_FILE_STORE_UUID_FILE;
if (!fileStorePath || !path.isAbsolute(fileStorePath) || !fileStoreUuidFile) throw new Error("Storage local da fixture não foi configurado.");
const expectedUuid = (await readFile(fileStoreUuidFile, "utf8")).trim();
const sentinelPath = path.join(fileStorePath, ".tria-volume");
const sentinel = (await readFile(sentinelPath, "utf8")).trim();
const sentinelDetails = await lstat(sentinelPath);
if (sentinel !== expectedUuid || !sentinelDetails.isFile() || sentinelDetails.isSymbolicLink() || (sentinelDetails.mode & 0o077) !== 0) {
  throw new Error("Storage local da fixture não corresponde ao UUID descartável.");
}
await assertSyntheticTarget();
await mkdir(path.join(fileStorePath, "objects"), { recursive: true, mode: 0o700 });

const bytes = Buffer.from([
  "codigo,curso,trilha,data,valor",
  "S-001,não usar,não usar,2026-01-01,10.50",
  "S-002,não usar,não usar,2026-02-30,abc",
  "S-003,não usar,não usar,,20",
  "",
].join("\n"), "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const objectPath = path.join(fileStorePath, "objects", fixture.objectKey);
const password = process.env.PGPASSWORD_FILE ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim() : process.env.PGPASSWORD ?? "";
const sql = postgres({
  host: process.env.PGHOST ?? "db",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "tria",
  username: process.env.PGUSER ?? "tria_app",
  password,
  max: 1,
  prepare: false,
});
const now = new Date().toISOString();
let objectCreated = false;
try {
  await writeFile(objectPath, bytes, { flag: "wx", mode: 0o600 });
  objectCreated = true;
  await chmod(objectPath, 0o600);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO file_document
      (id, project_id, title, status, created_at, updated_at, include_in_publication, document_kind)
      VALUES (${fixture.documentId}::uuid, NULL, 'Base consolidada de aplicação de recursos', 'active', ${now}, ${now}, false, 'source')`;
    await tx`INSERT INTO file_version
      (id, document_id, version, object_key, original_name, media_type, size_bytes, sha256, status, created_at)
      VALUES (${fixture.fileVersionId}::uuid, ${fixture.documentId}::uuid, 1, ${fixture.objectKey}::uuid,
        ${`story-3-2-${fixtureName}.csv`}, 'text/csv', ${bytes.byteLength}, ${sha256}, 'active', ${now})`;
    await tx`INSERT INTO source_file
      (id, document_id, file_version_id, source_format, received_by, received_at)
      VALUES (${fixture.sourceFileId}::uuid, ${fixture.documentId}::uuid, ${fixture.fileVersionId}::uuid, 'csv', 'Rodrigo', ${now})`;
    await tx`INSERT INTO source_file_event
      (id, source_file_id, operation, byte_count, actor, occurred_at)
      VALUES (${randomUUID()}::uuid, ${fixture.sourceFileId}::uuid, 'source.file.received.v1', ${bytes.byteLength}, 'Rodrigo', ${now})`;
    await tx`INSERT INTO file_reservation
      (id, reserved_bytes, object_key, status, created_at, expires_at)
      VALUES (${fixture.reservationId}::uuid, ${bytes.byteLength}, ${fixture.objectKey}::uuid, 'committed', ${now}, ${now}::timestamptz + interval '1 hour')`;
    await tx`UPDATE file_store_counter SET used_bytes = used_bytes + ${bytes.byteLength} WHERE singleton`;
  });
  console.log(JSON.stringify({ status: "seeded", fixture: fixtureName, sourceFileId: fixture.sourceFileId, fileVersionId: fixture.fileVersionId, sha256, sizeBytes: bytes.byteLength }));
} catch (error) {
  if (objectCreated) await unlink(objectPath);
  throw error;
} finally {
  await sql.end();
}
