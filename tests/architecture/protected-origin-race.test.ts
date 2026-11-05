import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ swap: "", mutateDirectory: "", earlierFile: "" }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === hooks.swap) { hooks.swap = ""; rmSync(args[0]); execFileSync("mkfifo", [String(args[0])]); }
      return fs.open(...args);
    },
    opendir: async (...args: Parameters<typeof fs.opendir>) => {
      if (String(args[0]) === hooks.mutateDirectory) { hooks.mutateDirectory = ""; writeFileSync(hooks.earlierFile, "changed after the earlier file was read"); }
      return fs.opendir(...args);
    },
  };
});
import { captureTree, publishCapturePair, regularFileBytes } from "../../scripts/lib/protected-origin.mjs";
const temporary: string[] = [];
function directory() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "tria-origin-race-"))); temporary.push(dir); return dir; }
afterEach(() => { hooks.swap = ""; hooks.mutateDirectory = ""; hooks.earlierFile = ""; for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("instabilidade ordinária e publicação da captura", () => {
  it("recusa troca regular→FIFO entre lstat e open sem bloquear", async () => {
    const dir = directory(), file = join(dir, "synthetic.txt"); writeFileSync(file, "synthetic"); hooks.swap = file;
    const started = Date.now();
    await expect(regularFileBytes(file)).rejects.toThrow("Arquivo mudou");
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("revalida arquivo já lido quando outro diretório é percorrido", async () => {
    const dir = directory(), file = join(dir, "earlier.txt"), later = join(dir, "later");
    writeFileSync(file, "synthetic first contents"); mkdirSync(later); writeFileSync(join(later, "last.txt"), "synthetic last contents");
    hooks.earlierFile = file; hooks.mutateDirectory = later;
    await expect(captureTree(dir)).rejects.toThrow("Árvore mudou");
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
