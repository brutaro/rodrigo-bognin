#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { inspectEvidencePackage, presentationForCatalogType } from "./evidence-package.mjs";

const testRequested = Object.keys(process.env).some((name) => name.startsWith("TRIA_EVIDENCE_") && name !== "TRIA_EVIDENCE_TEST_MODE") || process.env.TRIA_EVIDENCE_TEST_MODE !== undefined;
const testMode = process.env.TRIA_EVIDENCE_TEST_MODE === "confirmed" && process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
  /^tria-evidence-[a-z0-9_-]+$/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
if (testRequested && !testMode) throw new Error("Modo sintético de evidência recusado fora de namespace isolado.");
function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Configuração de teste inválida: ${name}.`);
  return value;
}
const EXPECTED_COUNT = testMode ? positiveInteger("TRIA_EVIDENCE_EXPECTED_COUNT", 2) : 53;
const EXPECTED_LINKS = testMode ? positiveInteger("TRIA_EVIDENCE_EXPECTED_LINKS", 3) : 72;
const EXPECTED_TOTAL_BYTES = testMode ? positiveInteger("TRIA_EVIDENCE_EXPECTED_TOTAL_BYTES", 5) : 1_126_834_973;
const CRASH_AFTER_RENAMES = testMode ? Number(process.env.TRIA_EVIDENCE_CRASH_AFTER_RENAMES ?? 0) : 0;
const SAFETY_MARGIN_BYTES = 16 * 1024 * 1024;
const JOURNAL_NAME = ".tria-evidence-import-v1.json";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage() { console.error("Uso: node scripts/import-evidence-files.mjs --source-dir <diretório>"); process.exit(2); }
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--source-dir") usage();
const sourceDirectory = path.resolve(args[1]);
async function password() { return process.env.PGPASSWORD_FILE ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim() : process.env.PGPASSWORD ?? ""; }
function databaseOptions() { return { host: process.env.PGHOST ?? "db", port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? "tria", username: process.env.PGUSER ?? "tria_migrator" }; }
function stableUuid(namespace, hash) {
  const hex = createHash("sha256").update(`${namespace}:${hash}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join(""); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
async function syncDirectory(directory) { const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function transaction(connection, operation) {
  await connection`BEGIN`;
  try { const result = await operation(connection); await connection`COMMIT`; return result; }
  catch (error) { await connection`ROLLBACK`.catch(() => undefined); throw error; }
}
async function existsRegular(file) {
  try { const details = await lstat(file); if (!details.isFile() || details.isSymbolicLink()) throw new Error("Entrada interna do cofre inválida."); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function removeIfPresent(file) { try { await unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; } }
async function verifyVolume(root, expectedUuid) {
  if (!root || !path.isAbsolute(root) || !uuidPattern.test(expectedUuid)) throw new Error("Configuração do cofre inválida.");
  const details = await lstat(root); if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Volume do cofre inválido.");
  const sentinel = path.join(root, ".tria-volume"); const sentinelDetails = await lstat(sentinel);
  if (!sentinelDetails.isFile() || sentinelDetails.isSymbolicLink() || (await readFile(sentinel, "utf8")).trim() !== expectedUuid) throw new Error("Volume não corresponde ao secret configurado.");
  return { root, objects: path.join(root, "objects"), staging: path.join(root, "staging"), journal: path.join(root, JOURNAL_NAME) };
}
async function copyVerified(source, destination, expectedSize, expectedHash) {
  const sourceDetails = await lstat(source); if (!sourceDetails.isFile() || sourceDetails.isSymbolicLink()) throw new Error("Evidência deixou de ser um arquivo regular.");
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW); let output;
  const hash = createHash("sha256"); let size = 0;
  try {
    output = await open(destination, "wx", 0o600);
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      size += chunk.length; hash.update(chunk); let offset = 0;
      while (offset < chunk.length) { const result = await output.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw new Error("Falha ao gravar evidência."); offset += result.bytesWritten; }
    }
    await output.sync();
    if (size !== expectedSize || hash.digest("hex") !== expectedHash) throw new Error("Evidência mudou depois da pré-validação.");
  } catch (error) { if (output) await output.close().catch(() => undefined); await removeIfPresent(destination).catch(() => undefined); throw error; }
  finally { await input.close(); if (output) await output.close().catch(() => undefined); }
}
async function verifyStored(file, expectedSize, expectedHash) {
  const details = await lstat(file); if (!details.isFile() || details.isSymbolicLink() || details.size !== expectedSize) return false;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); const hash = createHash("sha256"); let size = 0;
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; hash.update(chunk); } } finally { await handle.close(); }
  return size === expectedSize && hash.digest("hex") === expectedHash;
}
async function writeJournal(directories, model) {
  const temporary = path.join(directories.root, `${JOURNAL_NAME}.tmp`);
  await removeIfPresent(temporary);
  await writeFile(temporary, `${JSON.stringify(model, null, 2)}\n`, { mode: 0o600, flag: "wx", flush: true });
  await rename(temporary, directories.journal); await syncDirectory(directories.root);
}
async function readJournal(directories) {
  try {
    const details = await lstat(directories.journal); if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o077) !== 0) throw new Error("Journal de evidências inseguro.");
    const handle = await open(directories.journal, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function expectedJournal(inspected, volumeUuid) {
  return {
    format: "tria-evidence-import-v1", volumeUuid, expectedCount: EXPECTED_COUNT, expectedLinks: EXPECTED_LINKS,
    totalBytes: EXPECTED_TOTAL_BYTES, completedObjectKeys: [],
    entries: inspected.entries.map((entry) => ({ sha256: entry.sha256, sizeBytes: entry.sizeBytes, originalName: entry.originalName,
      mediaType: entry.mediaType, reservationId: stableUuid("reservation", entry.sha256), objectKey: stableUuid("object", entry.sha256),
      documentId: stableUuid("document", entry.sha256), versionId: stableUuid("version", entry.sha256) })),
  };
}
function journalMatches(actual, expected) {
  if (!actual || actual.format !== expected.format || actual.volumeUuid !== expected.volumeUuid || actual.expectedCount !== expected.expectedCount ||
      actual.expectedLinks !== expected.expectedLinks || actual.totalBytes !== expected.totalBytes || !Array.isArray(actual.entries) || !Array.isArray(actual.completedObjectKeys)) return false;
  return JSON.stringify(actual.entries) === JSON.stringify(expected.entries) && actual.completedObjectKeys.every((key) => expected.entries.some((entry) => entry.objectKey === key));
}

const sql = postgres({ ...databaseOptions(), password: await password(), max: 1, prepare: false });
let connection; let locked = false;
try {
  connection = await sql.reserve(); await connection`SELECT pg_advisory_lock(810245731)`; locked = true;
  const [catalog] = await connection`SELECT (SELECT count(*)::int FROM evidence_asset) assets, (SELECT count(*)::int FROM project_evidence) links`;
  const assets = await connection`SELECT id, sha256, file_type FROM evidence_asset ORDER BY id`;
  if (catalog.assets !== EXPECTED_COUNT || catalog.links !== EXPECTED_LINKS || assets.some((item) => item.id !== item.sha256)) throw new Error("Catálogo PostgreSQL de evidências diverge do pacote aprovado.");
  const inspected = await inspectEvidencePackage(sourceDirectory, assets.map((item) => item.sha256), { expectedCount: EXPECTED_COUNT, expectedTotalBytes: EXPECTED_TOTAL_BYTES });
  inspected.entries = inspected.entries.map((entry, index) => ({ ...entry,
    ...presentationForCatalogType(assets.find((asset) => asset.sha256 === entry.sha256)?.file_type, index),
  }));
  const root = process.env.TRIA_FILE_STORE_PATH; const uuidFile = process.env.TRIA_FILE_STORE_UUID_FILE;
  if (!uuidFile) throw new Error("Secret UUID do cofre ausente.");
  const expectedUuid = (await readFile(uuidFile, "utf8")).trim(); const directories = await verifyVolume(root, expectedUuid);
  if ([directories.objects, directories.staging].some((inside) => sourceDirectory === inside || sourceDirectory.startsWith(`${inside}${path.sep}`))) throw new Error("O pacote temporário não pode usar os diretórios internos do cofre.");

  const loaded = await connection`SELECT d.id::text document_id, v.id::text, v.object_key::text, v.sha256, v.size_bytes::text, v.original_name, v.media_type
    FROM file_version v JOIN file_document d ON d.id = v.document_id
    WHERE v.evidence_asset_id IS NOT NULL AND d.document_kind = 'evidence' AND v.status = 'active' AND d.status = 'active' ORDER BY v.sha256`;
  const planned = expectedJournal(inspected, expectedUuid);
  let journal = await readJournal(directories);
  if (loaded.length) {
    if (loaded.length !== EXPECTED_COUNT || loaded.reduce((sum, item) => sum + Number(item.size_bytes), 0) !== EXPECTED_TOTAL_BYTES ||
        loaded.some((item) => !planned.entries.some((entry) => entry.sha256 === item.sha256 && entry.objectKey === item.object_key && entry.documentId === item.document_id &&
          entry.versionId === item.id && entry.originalName === item.original_name && entry.mediaType === item.media_type))) throw new Error("Carga parcial ou divergente de evidências; nenhuma alteração foi feita.");
    for (const item of loaded) if (!await verifyStored(path.join(directories.objects, item.object_key), Number(item.size_bytes), item.sha256)) throw new Error("Carga existente contém objeto ausente ou corrompido.");
    if (journal) { await removeIfPresent(directories.journal); await syncDirectory(directories.root); }
    console.log(JSON.stringify({ status: "already_imported", evidence_objects: EXPECTED_COUNT, evidence_bytes: EXPECTED_TOTAL_BYTES, evidence_links: EXPECTED_LINKS }));
  } else {
    if (journal && !journalMatches(journal, planned)) throw new Error("Journal de evidências diverge do pacote ou volume atual.");
    if (!journal) { journal = planned; await writeJournal(directories, journal); }
    let missingBytes = 0;
    for (const entry of journal.entries) if (!await existsRegular(path.join(directories.objects, entry.objectKey))) missingBytes += entry.sizeBytes;
    const filesystem = await statfs(root, { bigint: true });
    if (filesystem.bavail * filesystem.bsize < BigInt(missingBytes + SAFETY_MARGIN_BYTES)) throw new Error("Espaço físico insuficiente para a carga.");

    await transaction(connection, async (tx) => {
      const [counter] = await tx`SELECT quota_bytes::text, used_bytes::text, reserved_bytes::text, volume_uuid::text FROM file_store_counter WHERE singleton FOR UPDATE`;
      if (!counter || counter.volume_uuid !== expectedUuid) throw new Error("Vínculo do cofre impede a carga.");
      let added = 0;
      for (const entry of journal.entries) {
        const [reservation] = await tx`SELECT reserved_bytes::text, object_key::text, status FROM file_reservation WHERE id = ${entry.reservationId} FOR UPDATE`;
        if (!reservation) {
          await tx`INSERT INTO file_reservation (id, reserved_bytes, object_key, status, created_at, expires_at)
            VALUES (${entry.reservationId}, ${entry.sizeBytes}, ${entry.objectKey}, 'reserved', now(), 'infinity'::timestamptz)`; added += entry.sizeBytes;
        } else if (reservation.object_key !== entry.objectKey || Number(reservation.reserved_bytes) !== entry.sizeBytes || reservation.status === 'committed') {
          throw new Error("Reserva persistente de evidência diverge do journal.");
        } else if (reservation.status === 'released') {
          await tx`UPDATE file_reservation SET status = 'reserved', expires_at = 'infinity'::timestamptz WHERE id = ${entry.reservationId}`; added += entry.sizeBytes;
        }
      }
      if (BigInt(counter.used_bytes) + BigInt(counter.reserved_bytes) + BigInt(added) > BigInt(counter.quota_bytes)) throw new Error("Quota do cofre impede a carga.");
      if (added) await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes + ${added} WHERE singleton`;
    });

    let renamed = journal.completedObjectKeys.length;
    for (const entry of journal.entries) {
      const source = inspected.entries.find((item) => item.sha256 === entry.sha256).absolute;
      const staging = path.join(directories.staging, entry.reservationId); const object = path.join(directories.objects, entry.objectKey);
      if (await existsRegular(object)) {
        if (!await verifyStored(object, entry.sizeBytes, entry.sha256)) throw new Error("Objeto retomável diverge do journal.");
      } else {
        if (await existsRegular(staging)) {
          if (!await verifyStored(staging, entry.sizeBytes, entry.sha256)) { await removeIfPresent(staging); await syncDirectory(directories.staging); await copyVerified(source, staging, entry.sizeBytes, entry.sha256); }
        } else await copyVerified(source, staging, entry.sizeBytes, entry.sha256);
        await rename(staging, object); await syncDirectory(directories.staging); await syncDirectory(directories.objects);
      }
      if (!journal.completedObjectKeys.includes(entry.objectKey)) {
        renamed += 1;
        if (CRASH_AFTER_RENAMES > 0 && renamed >= CRASH_AFTER_RENAMES) process.exit(86);
        journal.completedObjectKeys.push(entry.objectKey); await writeJournal(directories, journal);
      }
    }

    await transaction(connection, async (tx) => {
      const reservations = await tx`SELECT id::text, reserved_bytes::text, object_key::text, status FROM file_reservation WHERE id IN ${tx(journal.entries.map((entry) => entry.reservationId))} FOR UPDATE`;
      if (reservations.length !== EXPECTED_COUNT || reservations.some((row) => row.status !== 'reserved')) throw new Error("Reservas da carga não estão completas.");
      const now = new Date().toISOString();
      await tx`INSERT INTO file_document ${tx(journal.entries.map((entry) => ({ id: entry.documentId, project_id: null, title: entry.originalName,
        status: "active", created_at: now, updated_at: now, include_in_publication: false, document_kind: "evidence" })),
        "id", "project_id", "title", "status", "created_at", "updated_at", "include_in_publication", "document_kind")}`;
      await tx`INSERT INTO file_version ${tx(journal.entries.map((entry) => ({ id: entry.versionId, document_id: entry.documentId, version: 1,
        object_key: entry.objectKey, original_name: entry.originalName, media_type: entry.mediaType, size_bytes: entry.sizeBytes, sha256: entry.sha256,
        status: "active", created_at: now, evidence_asset_id: entry.sha256 })),
        "id", "document_id", "version", "object_key", "original_name", "media_type", "size_bytes", "sha256", "status", "created_at", "evidence_asset_id")}`;
      await tx`UPDATE file_reservation SET status = 'committed' WHERE id IN ${tx(journal.entries.map((entry) => entry.reservationId))}`;
      await tx`UPDATE file_store_counter SET reserved_bytes = reserved_bytes - ${EXPECTED_TOTAL_BYTES}, used_bytes = used_bytes + ${EXPECTED_TOTAL_BYTES} WHERE singleton`;
    });
    await removeIfPresent(directories.journal); await syncDirectory(directories.root);
    console.log(JSON.stringify({ status: "imported", evidence_objects: EXPECTED_COUNT, evidence_bytes: EXPECTED_TOTAL_BYTES, evidence_links: EXPECTED_LINKS }));
  }
} catch (error) {
  console.error(`${error instanceof Error ? error.message : "Falha desconhecida na carga."} Nenhum accounting foi liberado; execute novamente para retomar pelo journal.`);
  process.exitCode = 1;
} finally {
  if (connection) { if (locked) await connection`SELECT pg_advisory_unlock(810245731)`.catch(() => undefined); connection.release(); }
  await sql.end();
}
