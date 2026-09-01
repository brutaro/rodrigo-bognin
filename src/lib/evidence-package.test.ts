import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectEvidencePackage } from "../../scripts/evidence-package.mjs";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function directory(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "tria-evidence-")); temporary.push(root);
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, name), body);
  return root;
}

describe("pré-validação do pacote de evidências", () => {
  it("aceita somente o conjunto, a contagem e o total exatos", async () => {
    const root = await directory({ "a.bin": "aa", "b.bin": "bbb" });
    const result = await inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 5 });
    expect(result.entries.map((item) => item.sha256).sort()).toEqual([digest("aa"), digest("bbb")].sort());
    expect(result.totalBytes).toBe(5);
  });
  it("recusa arquivo ausente", async () => {
    const root = await directory({ "a.bin": "aa" });
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 5 })).rejects.toThrow("exatamente 2");
  });
  it("recusa arquivo em excesso", async () => {
    const root = await directory({ "a.bin": "aa", "b.bin": "bbb", "c.bin": "c" });
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 5 })).rejects.toThrow("exatamente 2");
  });
  it("recusa hash divergente antes de qualquer gravação", async () => {
    const root = await directory({ "a.bin": "aa", "b.bin": "alterado" });
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 10 })).rejects.toThrow("hashes");
  });
  it("recusa conteúdo duplicado", async () => {
    const root = await directory({ "a.bin": "aa", "b.bin": "aa" });
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 4 })).rejects.toThrow("duplicado");
  });
  it("recusa total divergente", async () => {
    const root = await directory({ "a.bin": "aa", "b.bin": "bbb" });
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 6 })).rejects.toThrow("tamanho total");
  });
  it("recusa links simbólicos", async () => {
    const root = await directory({ "a.bin": "aa" });
    await symlink(path.join(root, "a.bin"), path.join(root, "b.bin"));
    await expect(inspectEvidencePackage(root, [digest("aa"), digest("bbb")], { expectedCount: 2, expectedTotalBytes: 5 })).rejects.toThrow("link simbólico");
  });
});
