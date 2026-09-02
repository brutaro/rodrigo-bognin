import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathViolation, scanFile, scanReadable } from "../../scripts/scan-release.mjs";

describe("scanner fail-closed da release", () => {
  it("aceita somente os assets binários nominais", () => {
    expect(pathViolation("src/app/favicon.ico")).toBeNull();
    expect(pathViolation("public/file.svg")).toBeNull();
    for (const name of [".secrets/password", "fonte.csv", "docs/anexo.pdf", "arquivo.docx", "arquivo.xlsx", "arquivo.pptx", "arquivo.pbix", "public/outro.png", "public/outro.ico"]) {
      expect(pathViolation(name)).toBeTruthy();
    }
  });
  it("permite apenas o código nominal da rota de fontes", () => {
    expect(pathViolation("src/app/api/sources/consolidated/route.ts")).toBeNull();
    expect(pathViolation("src/app/api/sources/consolidated/route.test.ts")).toBeNull();
    expect(pathViolation("src/app/api/sources/consolidated/fixture.csv")).toBeTruthy();
    expect(pathViolation("src/app/api/sources/outra-rota.ts")).toBeTruthy();
  });
  it("encontra secret depois de 2 MiB", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tria-release-scan-")); const file = path.join(root, "large.bin");
    await writeFile(file, Buffer.concat([Buffer.alloc(2 * 1024 * 1024 + 17, 65), Buffer.from("TRIA_DB_ADMIN_" + "PASSWORD=real-secret-value-12345")]));
    await expect(scanFile(file)).resolves.toBe(true);
  });
  it("encontra secret dividido na borda entre chunks", async () => {
    async function* chunks() { yield Buffer.from("texto TRIA_DB_MIGRATOR_"); yield Buffer.from("PASSWORD=real-secret-value-67890 fim"); }
    await expect(scanReadable(chunks())).resolves.toBe(true);
  });
});
