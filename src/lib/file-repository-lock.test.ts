import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reserve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./database", () => ({ getSql: () => ({ reserve: mocks.reserve }) }));
import { acquireFileOperation } from "./file-repository";

afterEach(() => { mocks.reserve.mockReset(); globalThis.triaFileOperation = undefined; });

describe("mutex do cofre", () => {
  it("libera a fila se o checkout PostgreSQL falhar", async () => {
    const releaseConnection = vi.fn();
    const connection = Object.assign(vi.fn(async () => [{ locked: true }]), { release: releaseConnection });
    mocks.reserve.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(connection);
    await expect(acquireFileOperation()).rejects.toThrow("db down");
    const release = await Promise.race([
      acquireFileOperation(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fila bloqueada")), 100)),
    ]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseConnection).toHaveBeenCalledOnce();
  });
});
