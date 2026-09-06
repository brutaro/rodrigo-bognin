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

import { currentPublishedFiles } from "./file-repository";
it("mantém a versão do comprovante mesmo quando há upload mais recente", () => {
  const version = {id:"v1",documentId:"document",version:1,objectKey:"object",originalName:"comprovante.pdf",mediaType:"application/pdf",sizeBytes:10,sha256:"a".repeat(64),status:"active" as const,createdAt:"2026-09-05"};
  const document = {id:"document",projectId:"project",title:"Comprovante",status:"active" as const,includeInPublication:false,createdAt:"2026-09-05",updatedAt:"2026-09-05",versions:[{...version,id:"v2",version:2},version]};
  expect(currentPublishedFiles([document],["v1"]).map(file=>file.versionId)).toEqual(["v1"]);
  expect(currentPublishedFiles([{...document,includeInPublication:true}],["v1"]).map(file=>file.versionId)).toEqual(["v2","v1"]);
});
