import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
it("salva somente diagnóstico sintético permitido fora do checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "tria-artifacts-test-"));
  try {
    const project = join(dir, "project"), temporary = join(dir, "temporary"), artifacts = join(dir, "artifacts");
    mkdirSync(project); mkdirSync(join(temporary, "secrets"), { recursive: true }); mkdirSync(join(temporary, "evidence")); mkdirSync(join(temporary, "diagnostics"));
    writeFileSync(join(temporary, "suite.log"), "synthetic suite failure");
    writeFileSync(join(temporary, "secrets", "private"), "must never be collected");
    writeFileSync(join(temporary, "compose.yaml"), "must never be collected");
    writeFileSync(join(temporary, "child.stdout"), "self-test output must stay suppressed");
    writeFileSync(join(temporary, "evidence", "failure.png"), "synthetic image");
    writeFileSync(join(temporary, "evidence", "http-failures.json"), "[]");
    writeFileSync(join(temporary, "evidence", "input.csv"), "must never be collected");
    writeFileSync(join(temporary, "diagnostics", "synthetic-container.log"), "synthetic container failure");
    execFileSync(process.execPath, ["scripts/lib/save-integration-artifacts.mjs", project, temporary, artifacts, "synthetic-run"], { stdio: "pipe" });
    const output = join(artifacts, "synthetic-run");
    expect(readFileSync(join(output, "suite.log"), "utf8")).toBe("synthetic suite failure");
    for (const file of ["browser/failure.png", "browser/http-failures.json", "containers/synthetic-container.log"]) expect(existsSync(join(output, file))).toBe(true);
    for (const file of ["secrets", "compose.yaml", "child.stdout", "browser/input.csv"]) expect(existsSync(join(output, file))).toBe(false);
    const refused = spawnSync(process.execPath, ["scripts/lib/save-integration-artifacts.mjs", project, temporary, join(project, "artifacts"), "synthetic-run"]);
    expect(refused.status).toBe(1); expect(existsSync(join(project, "artifacts"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.each(["run", "browser", "containers", "leaf"])("recusa symlink de destino %s e preserva o alvo", (kind) => {
  const dir = mkdtempSync(join(tmpdir(), "tria-artifact-symlink-"));
  try {
    const project = join(dir, "project"), temporary = join(dir, "temporary"), artifacts = join(dir, "artifacts"), run = join(artifacts, "synthetic-run");
    mkdirSync(project); mkdirSync(join(temporary, "evidence"), { recursive: true }); mkdirSync(join(temporary, "diagnostics")); mkdirSync(artifacts);
    writeFileSync(join(project, "retained.txt"), "retained checkout contents");
    writeFileSync(join(temporary, "suite.log"), "synthetic suite failure");
    writeFileSync(join(temporary, "evidence", "failure.png"), "synthetic image");
    writeFileSync(join(temporary, "diagnostics", "synthetic-container.log"), "synthetic log");
    if (kind === "run") symlinkSync(project, run);
    else {
      mkdirSync(run);
      if (kind === "leaf") symlinkSync(join(project, "retained.txt"), join(run, "suite.log"));
      else symlinkSync(project, join(run, kind));
    }
    const result = spawnSync(process.execPath, ["scripts/lib/save-integration-artifacts.mjs", project, temporary, artifacts, "synthetic-run"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(readFileSync(join(project, "retained.txt"), "utf8")).toBe("retained checkout contents");
    for (const file of ["suite.log", "failure.png", "synthetic-container.log"]) expect(existsSync(join(project, file))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
