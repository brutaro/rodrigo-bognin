import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  release: vi.fn(), source: undefined as Readable | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("./file-repository", () => ({
  reconcileFileStore: vi.fn(), acquireFileOperation: vi.fn(async () => mocks.release),
  assertBoundFileStore: vi.fn(async () => ({ uuid: "11111111-1111-4111-8111-111111111111" })),
  assertBackupCatalogReady: vi.fn(), activeObjectRecords: vi.fn(async () => [{ objectKey: "22222222-2222-4222-8222-222222222222", sizeBytes: 10_000_000, sha256: "a".repeat(64) }]),
  canonicalFileCatalog: vi.fn(async () => ({ format: "test" })), recordFileOperation: vi.fn(),
}));
vi.mock("./file-store", () => ({ verifiedStoredObjectNodeStream: vi.fn(async () => mocks.source!) }));
import { createVerifiedFileBackup } from "./file-backup";

async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); }
afterEach(() => { mocks.release.mockReset(); mocks.source = undefined; });

describe("ciclo de vida do backup", () => {
  it("libera lock e destrói a fonte se o cliente cancelar", async () => {
    let sourceClosed = false;
    mocks.source = Readable.from((async function* () {
      try { while (true) { yield Buffer.alloc(64 * 1024); await settle(); } }
      finally { sourceClosed = true; }
    })());
    const backup = await createVerifiedFileBackup();
    const reader = backup.body.getReader(); await reader.read(); await reader.cancel(); await settle(); await settle();
    expect(mocks.release).toHaveBeenCalledOnce(); expect(sourceClosed || mocks.source.destroyed).toBe(true);
  });

  it("transforma erro da fonte em cancelamento e libera o lock", async () => {
    mocks.source = new Readable({ read() { this.destroy(new Error("EIO simulado")); } });
    const backup = await createVerifiedFileBackup(); const reader = backup.body.getReader();
    await expect((async () => { while (!(await reader.read()).done) { /* consumir */ } })()).rejects.toThrow("EIO simulado");
    await settle(); expect(mocks.release).toHaveBeenCalledOnce();
  });
});
