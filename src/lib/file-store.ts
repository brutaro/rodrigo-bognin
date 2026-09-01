import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream, readFileSync } from "node:fs";
import { access, chmod, lstat, open, readdir, rename, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FileStoreError extends Error {
  constructor(message: string, readonly code: "unavailable" | "corrupt" | "size" = "unavailable") {
    super(message);
    this.name = "FileStoreError";
  }
}

function configuration() {
  const root = process.env.TRIA_FILE_STORE_PATH;
  const uuidFile = process.env.TRIA_FILE_STORE_UUID_FILE;
  if (!root || !path.isAbsolute(root) || !uuidFile) throw new FileStoreError("Cofre de arquivos não configurado.");
  const expectedUuid = readFileSync(uuidFile, "utf8").trim();
  if (!uuidPattern.test(expectedUuid)) throw new FileStoreError("Identificador do cofre inválido.");
  return { root, expectedUuid };
}

function storePath(kind: "objects" | "staging", key: string) {
  if (!uuidPattern.test(key)) throw new FileStoreError("Identificador de objeto inválido.");
  return path.join(/* turbopackIgnore: true */ configuration().root, kind, key);
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function inspectFileStore({ probe = true } = {}) {
  try {
    const { root, expectedUuid } = configuration();
    const details = await lstat(root);
    if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("mount");
    const sentinelPath = path.join(/* turbopackIgnore: true */ root, ".tria-volume");
    const sentinelDetails = await lstat(sentinelPath);
    if (!sentinelDetails.isFile() || sentinelDetails.isSymbolicLink() || (sentinelDetails.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && sentinelDetails.uid !== process.getuid())) throw new Error("sentinel");
    const sentinelHandle = await open(sentinelPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let sentinel: string;
    try { sentinel = (await sentinelHandle.readFile("utf8")).trim(); } finally { await sentinelHandle.close(); }
    if (sentinel !== expectedUuid) throw new Error("sentinel");
    let objectKeys: string[] = [];
    for (const name of ["objects", "staging"]) {
      const directory = await lstat(path.join(/* turbopackIgnore: true */ root, name));
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("subdiretório");
      await access(path.join(/* turbopackIgnore: true */ root, name), constants.R_OK | constants.W_OK);
      const entries = await readdir(path.join(/* turbopackIgnore: true */ root, name));
      if (entries.some((entry) => !uuidPattern.test(entry))) throw new Error("entrada não catalogável");
      if (name === "objects") objectKeys = entries.sort();
    }
    const filesystem = await statfs(root, { bigint: true });
    if (filesystem.bavail <= BigInt(0) || filesystem.ffree <= BigInt(0)) throw new Error("volume cheio");
    const availableBytes = filesystem.bavail * filesystem.bsize;
    if (probe) {
      const probePath = storePath("staging", randomUUID());
      const handle = await open(probePath, "wx", 0o600);
      await handle.sync();
      await handle.close();
      await unlink(probePath);
      await syncDirectory(path.join(/* turbopackIgnore: true */ root, "staging"));
    }
    return { ok: true as const, uuid: expectedUuid, availableBytes, objectKeys };
  } catch {
    return { ok: false as const, reason: "volume ausente, incorreto ou somente leitura" };
  }
}

export async function assertFileStore() {
  const state = await inspectFileStore();
  if (!state.ok) throw new FileStoreError("Cofre indisponível.");
  return state;
}

export async function writeUploadObject(
  body: ReadableStream<Uint8Array> | null,
  reservationId: string,
  objectKey: string,
  expectedSize: number,
) {
  if (!body) throw new FileStoreError("Corpo do arquivo ausente.", "size");
  await assertFileStore();
  const staging = storePath("staging", reservationId);
  const destination = storePath("objects", objectKey);
  const handle = await open(staging, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  let renamed = false;
  try {
    for await (const raw of Readable.fromWeb(body as never)) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      size += chunk.length;
      if (size > expectedSize) throw new FileStoreError("Tamanho do arquivo divergente.", "size");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new FileStoreError("Falha ao gravar o arquivo.");
        offset += bytesWritten;
      }
    }
    if (size !== expectedSize || size === 0) throw new FileStoreError("Tamanho do arquivo divergente.", "size");
    await handle.sync();
    await handle.close();
    await rename(staging, destination);
    renamed = true;
    await syncDirectory(path.dirname(staging));
    await syncDirectory(path.dirname(destination));
    return { size, sha256: hash.digest("hex") };
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (!renamed) await unlink(staging).catch(() => undefined);
    throw error;
  }
}

export async function inspectStoredObjectMetadata(objects: Array<{ objectKey: string; sizeBytes: number }>) {
  try {
    for (const object of objects) {
      const details = await lstat(storePath("objects", object.objectKey));
      if (!details.isFile() || details.isSymbolicLink() || details.size !== object.sizeBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function verifyStoredObject(objectKey: string, expectedSize: number, expectedSha256: string) {
  const hash = createHash("sha256");
  let size = 0;
  try {
    const object = storePath("objects", objectKey);
    const details = await lstat(object);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("objeto não regular");
    const handle = await open(object, constants.O_RDONLY | constants.O_NOFOLLOW);
    for await (const chunk of handle.createReadStream({ autoClose: true })) {
      size += chunk.length;
      hash.update(chunk);
    }
  } catch {
    throw new FileStoreError("Objeto ausente ou ilegível.", "corrupt");
  }
  if (size !== expectedSize || hash.digest("hex") !== expectedSha256) {
    throw new FileStoreError("Integridade do objeto inválida.", "corrupt");
  }
}

export async function createVerifiedStagingSnapshot(objectKey: string, stagingKey: string, expectedSize: number, expectedSha256: string) {
  const source = storePath("objects", objectKey);
  const target = storePath("staging", stagingKey);
  const details = await lstat(source);
  if (!details.isFile() || details.isSymbolicLink()) throw new FileStoreError("Objeto inválido.", "corrupt");
  const hash = createHash("sha256"); let size = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); },
    flush(callback) {
      const digest = hash.digest("hex");
      callback(size === expectedSize && digest === expectedSha256 ? undefined : new FileStoreError("Objeto corrompido.", "corrupt"));
    },
  });
  try {
    const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    await pipeline(
      sourceHandle.createReadStream({ autoClose: true }),
      verifier,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    const handle = await open(target, "r"); try { await handle.sync(); } finally { await handle.close(); }
    await chmod(target, 0o400);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    await unlink(target).catch(() => undefined);
    await syncDirectory(path.dirname(target)).catch(() => undefined);
    throw error;
  }
}

export async function openStagingNodeStream(stagingKey: string) {
  const handle = await open(storePath("staging", stagingKey), constants.O_RDONLY | constants.O_NOFOLLOW);
  return handle.createReadStream({ autoClose: true });
}

export async function removeVerifiedStagingSnapshot(stagingKey: string) {
  await unlink(storePath("staging", stagingKey)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  await syncDirectory(path.dirname(storePath("staging", stagingKey)));
}

export function verifiedNodeStream(sourceFactory: () => Promise<Readable> | Readable, expectedSize: number, expectedSha256: string) {
  return Readable.from((async function* () {
    const hash = createHash("sha256"); let size = 0;
    const source = await sourceFactory();
    try {
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
        size += chunk.length; hash.update(chunk); yield chunk;
      }
    } finally { source.destroy(); }
    if (size !== expectedSize || hash.digest("hex") !== expectedSha256) {
      throw new FileStoreError("Objeto corrompido.", "corrupt");
    }
  })());
}

export async function verifiedStoredObjectNodeStream(objectKey: string, expectedSize: number, expectedSha256: string) {
  const objectPath = storePath("objects", objectKey);
  return verifiedNodeStream(async () => {
    const details = await lstat(objectPath);
    if (!details.isFile() || details.isSymbolicLink()) throw new FileStoreError("Objeto inválido.", "corrupt");
    const handle = await open(objectPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    return handle.createReadStream({ autoClose: true });
  }, expectedSize, expectedSha256);
}

export async function removeStoredObject(objectKey: string) {
  const object = storePath("objects", objectKey);
  try { await unlink(object); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await syncDirectory(path.dirname(object));
}

export async function listStoredKeys(kind: "objects" | "staging") {
  const directory = path.join(/* turbopackIgnore: true */ configuration().root, kind);
  const entries = await readdir(directory);
  if (entries.some((entry) => !uuidPattern.test(entry))) throw new FileStoreError("Entrada inválida no cofre.", "corrupt");
  return entries;
}

export async function removeStagingObject(key: string) {
  const staging = storePath("staging", key);
  try { await unlink(staging); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await syncDirectory(path.dirname(staging));
}
