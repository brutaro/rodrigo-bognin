import "server-only";

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { acquireFileOperation, activeObjectRecords, assertBackupCatalogReady, assertBoundFileStore, canonicalFileCatalog, reconcileFileStore, recordFileOperation } from "./file-repository";
import { verifiedStoredObjectNodeStream } from "./file-store";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}

export function canonicalJson(value: unknown) {
  return `${JSON.stringify(canonicalValue(value))}
`;
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

export async function createVerifiedFileBackup() {
  await reconcileFileStore();
  const release = await acquireFileOperation();
  let output: Readable | undefined;
  let active: Readable | undefined;
  try {
    const store = await assertBoundFileStore();
    await assertBackupCatalogReady();
    const objects = await activeObjectRecords();
    const catalogText = canonicalJson(await canonicalFileCatalog());
    const manifestText = canonicalJson({
      format: "tria-file-backup-v1",
      volumeUuid: store.uuid,
      createdAt: new Date().toISOString(),
      catalog: { path: "catalog.json", sizeBytes: Buffer.byteLength(catalogText), sha256: sha256(catalogText) },
      objects: objects.map((object) => ({ path: `objects/${object.objectKey}`, sizeBytes: object.sizeBytes, sha256: object.sha256 })),
    });
    await recordFileOperation({ operation: "backup_prepared", byteCount: objects.reduce((sum, object) => sum + object.sizeBytes, 0), versionCount: objects.length });
    const zip = new ZipFile();
    output = zip.outputStream as Readable;
    let done = false;
    const finish = () => { if (!done) { done = true; release(); } };
    output.once("end", finish);
    output.once("close", () => { active?.destroy(); finish(); });
    output.once("error", (error) => { active?.destroy(error); finish(); });
    zip.on("error", (error) => output?.destroy(error));
    const timestamp = new Date();
    zip.addBuffer(Buffer.from(manifestText), "manifest.json", { mtime: timestamp, mode: 0o600, compress: false });
    zip.addBuffer(Buffer.from(catalogText), "catalog.json", { mtime: timestamp, mode: 0o600, compress: false });
    for (const object of objects) {
      zip.addReadStreamLazy(`objects/${object.objectKey}`, {
        size: object.sizeBytes, mtime: timestamp, mode: 0o600, compress: false, forceZip64Format: object.sizeBytes >= 0xffffffff,
      }, (callback) => {
        void verifiedStoredObjectNodeStream(object.objectKey, object.sizeBytes, object.sha256).then((verified) => {
          active = verified;
          const clear = () => { if (active === verified) active = undefined; };
          verified.once("end", clear); verified.once("close", clear);
          verified.once("error", (error) => output?.destroy(error));
          callback(null, verified);
        }, (error) => callback(error, Readable.from([])));
      });
    }
    zip.end({ forceZip64Format: true, comment: "" });
    return { body: Readable.toWeb(output!) as ReadableStream<Uint8Array>, manifest: JSON.parse(manifestText) as { createdAt: string } };
  } catch (error) {
    active?.destroy(); output?.destroy(); release();
    throw error;
  }
}
