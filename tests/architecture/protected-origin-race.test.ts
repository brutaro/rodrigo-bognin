import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  swap: "", mutationTrigger: "", earlierFile: "", orderedRoot: "",
  rootOrder: [] as string[], enumerated: [] as string[], completedReads: [] as string[], mutationApplied: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = String(args[0]);
      if (file === hooks.swap) { hooks.swap = ""; rmSync(args[0]); execFileSync("mkfifo", [file]); }
      if (file === hooks.mutationTrigger) {
        if (!hooks.completedReads.includes(hooks.earlierFile)) throw new Error("Fixture tentou mutar antes da leitura concluída");
        hooks.mutationTrigger = "";
        writeFileSync(hooks.earlierFile, "changed after the earlier file was read");
        hooks.mutationApplied = true;
      }
      const handle = await fs.open(...args);
      if (file === hooks.earlierFile) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); hooks.completedReads.push(file); };
      }
      return handle;
    },
    opendir: async (...args: Parameters<typeof fs.opendir>) => {
      const directory = await fs.opendir(...args);
      if (String(args[0]) === hooks.orderedRoot) {
        const entries: Dirent[] = [];
        for await (const entry of directory) entries.push(entry);
        entries.sort((left, right) => hooks.rootOrder.indexOf(left.name) - hooks.rootOrder.indexOf(right.name));
        Object.defineProperty(directory, Symbol.asyncIterator, { value: async function* () {
          for (const entry of entries) { hooks.enumerated.push(entry.name); yield entry; }
        } });
      }
      return directory;
    },
  };
});
import { captureTree, publishCapturePair, regularFileBytes } from "../../scripts/lib/protected-origin.mjs";
const temporary: string[] = [];
function directory() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "tria-origin-race-"))); temporary.push(dir); return dir; }
afterEach(() => { hooks.swap = ""; hooks.mutationTrigger = ""; hooks.earlierFile = ""; hooks.orderedRoot = ""; hooks.rootOrder = []; hooks.enumerated = []; hooks.completedReads = []; hooks.mutationApplied = false; for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("instabilidade ordinária e publicação da captura", () => {
  it("recusa troca regular→FIFO entre lstat e open sem bloquear", async () => {
    const dir = directory(), file = join(dir, "synthetic.txt"); writeFileSync(file, "synthetic"); hooks.swap = file;
    const started = Date.now();
    await expect(regularFileBytes(file)).rejects.toThrow("Arquivo mudou");
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it.each(["file-first", "directory-first"])("revalida arquivo já lido com ordem explícita %s", async (order) => {
    const dir = directory(), file = join(dir, "earlier.txt"), later = join(dir, "later"), nested = join(later, "last.txt");
    writeFileSync(file, "synthetic first contents"); mkdirSync(later); writeFileSync(nested, "synthetic last contents");
    const target = order === "file-first" ? file : nested;
    const before = lstatSync(target), originalContents = readFileSync(target, "utf8");
    hooks.orderedRoot = dir;
    hooks.rootOrder = order === "file-first" ? ["earlier.txt", "later"] : ["later", "earlier.txt"];
    hooks.earlierFile = target;
    hooks.mutationTrigger = order === "file-first" ? nested : file;
    await expect(captureTree(dir)).rejects.toThrow(`Árvore mudou durante varredura: ${target}`);
    expect(hooks.enumerated).toEqual(hooks.rootOrder);
    expect(hooks.completedReads).toContain(target);
    expect(hooks.mutationApplied).toBe(true);
    const after = lstatSync(target);
    expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
    expect(after.size).not.toBe(before.size);
    expect(readFileSync(target, "utf8")).toBe("changed after the earlier file was read");
    expect(readFileSync(target, "utf8")).not.toBe(originalContents);
  });
  it("rollback da segunda publicação preserva documento preexistente", async () => {
    const dir = directory(), first = join(dir, "stage-first"), second = join(dir, "stage-second"), target = join(dir, "manifest"), report = join(dir, "report");
    writeFileSync(first, "new synthetic manifest"); writeFileSync(second, "new synthetic report"); writeFileSync(report, "existing report");
    await expect(publishCapturePair(first, target, second, report)).rejects.toThrow();
    expect(existsSync(target)).toBe(false); expect(readFileSync(report, "utf8")).toBe("existing report");
    writeFileSync(target, "existing manifest");
    await expect(publishCapturePair(first, target, second, report)).rejects.toThrow();
    expect(readFileSync(target, "utf8")).toBe("existing manifest"); expect(readFileSync(report, "utf8")).toBe("existing report");
  });
  it("publica o par inteiro sem substituir arquivos", async () => {
    const dir = directory(), first = join(dir, "stage-first"), second = join(dir, "stage-second"), target = join(dir, "manifest"), report = join(dir, "report");
    writeFileSync(first, "synthetic manifest"); writeFileSync(second, "synthetic report");
    await publishCapturePair(first, target, second, report);
    expect(readFileSync(target, "utf8")).toBe("synthetic manifest"); expect(readFileSync(report, "utf8")).toBe("synthetic report");
  });
});
