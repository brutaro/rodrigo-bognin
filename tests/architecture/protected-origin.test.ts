import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HISTORICAL_SHA256, ROOT_NAMES, captureTree, discoverOriginParent, treeDigest, validateManifest, verifyTrees } from "../../scripts/lib/protected-origin.mjs";

const temporary: string[] = [];
function directory() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "tria-origin-synthetic-"))); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = directory();
  const roots: Record<string, Awaited<ReturnType<typeof captureTree>>> = {};
  for (const name of ROOT_NAMES) {
    mkdirSync(join(dir, name, "nested"), { recursive: true });
    writeFileSync(join(dir, name, "nested", "synthetic.txt"), `synthetic fixture: ${name}\n`);
    roots[name] = await captureTree(join(dir, name));
  }
  return { dir, manifest: { version: 1, captured_at: "2026-11-05T00:00:00.000Z", historical_manifest_sha256: HISTORICAL_SHA256, scope: "preservation-since-current-capture", roots } };
}
describe("preservação da origem atual", () => {
  it("preserva os bytes históricos e ancora a captura atual fora do JSON", () => {
    const historical = readFileSync("docs/protected-origin-manifest.json");
    expect(createHash("sha256").update(historical).digest("hex")).toBe(HISTORICAL_SHA256);
    const source = readFileSync("scripts/verify-protected-origin.mjs", "utf8");
    for (const file of ["protected-origin-current.json", "protected-origin-reconciliation.json"]) {
      expect(source).toContain(createHash("sha256").update(readFileSync(`docs/${file}`)).digest("hex"));
    }
  });
  it("verifica sem escrita e recusa conteúdo alterado, remoção e adição", async () => {
    for (const mutation of ["content", "missing", "extra"]) {
      const { dir, manifest } = await fixture();
      await expect(verifyTrees(manifest, dir)).resolves.toBeUndefined();
      const before = JSON.stringify(manifest);
      const file = join(dir, ROOT_NAMES[0], "nested", "synthetic.txt");
      if (mutation === "content") writeFileSync(file, "tampered synthetic fixture\n");
      if (mutation === "missing") rmSync(file);
      if (mutation === "extra") writeFileSync(join(dir, ROOT_NAMES[0], "extra.txt"), "extra synthetic fixture");
      await expect(verifyTrees(manifest, dir)).rejects.toThrow("divergiu");
      expect(JSON.stringify(manifest)).toBe(before);
      if (mutation === "content") expect(readFileSync(file, "utf8")).toBe("tampered synthetic fixture\n");
    }
  });
  it("recusa symlinks de arquivo, diretório, root e pai mesmo com bytes iguais", async () => {
    for (const kind of ["file", "directory", "root", "parent"]) {
      const { dir, manifest } = await fixture();
      const outside = directory();
      if (kind === "parent") {
        const link = join(outside, "origin-link"); symlinkSync(dir, link);
        await expect(verifyTrees(manifest, link)).rejects.toThrow("Diretório não regular");
        continue;
      }
      const target = kind === "file" ? join(dir, ROOT_NAMES[0], "nested", "synthetic.txt") : kind === "directory" ? join(dir, ROOT_NAMES[0], "nested") : join(dir, ROOT_NAMES[0]);
      if (kind === "file") writeFileSync(join(outside, "copy"), readFileSync(target));
      else mkdirSync(join(outside, "copy"));
      rmSync(target, { recursive: true }); symlinkSync(join(outside, "copy"), target);
      await expect(verifyTrees(manifest, dir)).rejects.toThrow(/simbólico|não regular/);
    }
  });
  it("recusa entradas especiais sem tentar lê-las", async () => {
    const { dir, manifest } = await fixture();
    execFileSync("mkfifo", [join(dir, ROOT_NAMES[0], "fifo")]);
    await expect(verifyTrees(manifest, dir)).rejects.toThrow("Entrada não regular");
  });
  it("valida esquema, conjunto de roots, contagens, ordem, digest e caminhos", async () => {
    const { manifest } = await fixture();
    expect(validateManifest(manifest)).toBe(manifest);
    const mutate = (change: (candidate: typeof manifest) => void) => { const candidate = structuredClone(manifest); change(candidate); expect(() => validateManifest(candidate)).toThrow(); };
    mutate((m) => { m.version = 2; });
    mutate((m) => { delete m.roots[ROOT_NAMES[0]]; });
    mutate((m) => { m.roots.extra = m.roots[ROOT_NAMES[0]]; });
    mutate((m) => { m.roots[ROOT_NAMES[0]].file_count++; });
    mutate((m) => { m.roots[ROOT_NAMES[0]].tree_sha256 = "0".repeat(64); });
    for (const unsafe of ["../escape", "/absolute", "./relative", "a/../b", "a\\b", "", ".", "..", "a\0b", "a\nb"]) {
      mutate((m) => { const root = m.roots[ROOT_NAMES[0]]; root.files[0].path = unsafe; root.tree_sha256 = treeDigest(root.files); });
    }
    mutate((m) => { const root = m.roots[ROOT_NAMES[0]]; root.files.push({ ...root.files[0] }); root.file_count++; root.tree_sha256 = treeDigest(root.files); });
    mutate((m) => { m.roots[ROOT_NAMES[0]].files[0].size = -1; });
    mutate((m) => { m.roots[ROOT_NAMES[0]].files[0].sha256 = "invalid"; });
  });
  it("o CLI recusa adulteração e hash arbitrário sem recapturar", () => {
    const dir = directory(); mkdirSync(join(dir, "scripts", "lib"), { recursive: true }); mkdirSync(join(dir, "docs"));
    for (const relative of ["scripts/verify-protected-origin.mjs", "scripts/lib/protected-origin.mjs", "docs/protected-origin-manifest.json", "docs/protected-origin-current.json", "docs/protected-origin-reconciliation.json"]) copyFileSync(relative, join(dir, relative));
    const verifier = join(dir, "scripts/verify-protected-origin.mjs");
    for (const file of ["protected-origin-manifest.json", "protected-origin-current.json", "protected-origin-reconciliation.json"]) {
      const target = join(dir, "docs", file), original = readFileSync(target); writeFileSync(target, Buffer.concat([original, Buffer.from(" ")]));
      const result = spawnSync(process.execPath, [verifier, "--origin-parent", directory()], { encoding: "utf8" });
      expect(result.status).toBe(1); expect(result.stderr).toContain("âncora no código"); expect(readFileSync(target).length).toBe(original.length + 1); writeFileSync(target, original);
    }
    const rejected = spawnSync(process.execPath, [verifier, "--manifest-sha256", "0".repeat(64)], { encoding: "utf8" });
    expect(rejected.status).toBe(1); expect(rejected.stderr).toContain("Nenhuma opção de captura/hash");
    const missing = spawnSync(process.execPath, [verifier, "--origin-parent", join(dir, "missing")], { encoding: "utf8" });
    expect(missing.status).toBe(1);
  });
  it("descobre o Git comum de um worktree fora do pai e não inventa fallback", () => {
    const dir = directory(), parent = join(dir, "synthetic-owner"), repo = join(parent, "PLANO_B_TRIA"), checkout = join(dir, "unrelated", "checkout");
    mkdirSync(repo, { recursive: true }); mkdirSync(join(dir, "unrelated"));
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "commit", "--allow-empty", "-qm", "synthetic fixture"], { cwd: repo });
    execFileSync("git", ["worktree", "add", "--detach", "-q", checkout], { cwd: repo });
    expect(discoverOriginParent(checkout)).toBe(parent);
    expect(discoverOriginParent(checkout, parent)).toBe(parent);
    expect(() => discoverOriginParent(dir)).toThrow();
    expect(() => discoverOriginParent(resolve("."), "relative")).toThrow("absoluto");
  });
});
