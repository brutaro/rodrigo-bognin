import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createVerifiedStagingSnapshot, inspectFileStore, inspectStoredObjectMetadata, verifiedNodeStream, verifyStoredObject, writeUploadObject } from "./file-store";

const originalPath = process.env.TRIA_FILE_STORE_PATH;
const originalUuidFile = process.env.TRIA_FILE_STORE_UUID_FILE;
const temporary: string[] = [];
afterEach(async () => {
  process.env.TRIA_FILE_STORE_PATH = originalPath;
  process.env.TRIA_FILE_STORE_UUID_FILE = originalUuidFile;
  await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function validStore() {
  const base = await mkdtemp(path.join(os.tmpdir(), "tria-store-test-")); temporary.push(base);
  const root = path.join(base, "volume"); const uuidFile = path.join(base, "uuid"); const id = randomUUID();
  await mkdir(path.join(root, "objects"), { recursive: true }); await mkdir(path.join(root, "staging"));
  await writeFile(path.join(root, ".tria-volume"), `${id}
`, { mode: 0o600 }); await writeFile(uuidFile, `${id}
`);
  process.env.TRIA_FILE_STORE_PATH = root; process.env.TRIA_FILE_STORE_UUID_FILE = uuidFile;
  return { root, id };
}

describe("sentinel do volume", () => {
  it("aceita somente o volume íntegro e gravável", async () => {
    const { root } = await validStore();
    expect((await inspectFileStore()).ok).toBe(true);
    await writeFile(path.join(root, ".tria-volume"), `${randomUUID()}
`, { mode: 0o600 });
    expect((await inspectFileStore()).ok).toBe(false);
    await rm(root, { recursive: true, force: true });
    expect((await inspectFileStore()).ok).toBe(false);
  });

  it("grava por staging, verifica hash/tamanho e detecta corrupção", async () => {
    const { root } = await validStore();
    const reservation = randomUUID(); const object = randomUUID(); const payload = Buffer.from("arquivo persistente");
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(payload); controller.close(); } });
    const written = await writeUploadObject(body, reservation, object, payload.length);
    expect(written.size).toBe(payload.length);
    expect(await inspectStoredObjectMetadata([{ objectKey: object, sizeBytes: payload.length }])).toBe(true);
    await expect(verifyStoredObject(object, payload.length, written.sha256)).resolves.toBeUndefined();
    await writeFile(path.join(root, "objects", object), "corrompido");
    await expect(verifyStoredObject(object, payload.length, written.sha256)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("recusa tamanho divergente e remove o staging incompleto", async () => {
    const { root } = await validStore();
    const reservation = randomUUID(); const object = randomUUID(); const payload = Buffer.from("curto");
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(payload); controller.close(); } });
    await expect(writeUploadObject(body, reservation, object, payload.length + 1)).rejects.toMatchObject({ code: "size" });
    expect(await readdir(path.join(root, "staging"))).toEqual([]);
    expect(await readdir(path.join(root, "objects"))).toEqual([]);
  });

  it("recusa sentinel simbólico mesmo quando aponta para o UUID correto", async () => {
    const { root } = await validStore();
    const uuidFile = process.env.TRIA_FILE_STORE_UUID_FILE!;
    await rm(path.join(root, ".tria-volume"));
    await symlink(uuidFile, path.join(root, ".tria-volume"));
    expect((await inspectFileStore()).ok).toBe(false);
  });

  it("serve uma cópia verificada independente do objeto ativo", async () => {
    const { root } = await validStore();
    const object = randomUUID(); const staging = randomUUID(); const payload = Buffer.from("snapshot íntegro");
    await writeFile(path.join(root, "objects", object), payload, { mode: 0o600 });
    const hash = (await import("node:crypto")).createHash("sha256").update(payload).digest("hex");
    await createVerifiedStagingSnapshot(object, staging, payload.length, hash);
    await writeFile(path.join(root, "objects", object), "mudou");
    expect(await readFile(path.join(root, "staging", staging))).toEqual(payload);
  });

  it("propaga erro do stream fonte sem deixá-lo sem tratamento", async () => {
    const source = new Readable({ read() { this.destroy(new Error("EIO simulado")); } });
    const expectedHash = createHash("sha256").update("x").digest("hex");
    const verified = verifiedNodeStream(() => source, 1, expectedHash);
    const consume = async () => { for await (const chunk of verified) { void chunk; } };
    await expect(consume()).rejects.toThrow("EIO simulado");
    expect(source.destroyed).toBe(true);
  });
});
