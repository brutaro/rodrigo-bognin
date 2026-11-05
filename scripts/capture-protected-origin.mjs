#!/usr/bin/env node
// Explicit, one-shot capture. Verification never imports or invokes this command.
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT_NAMES, HISTORICAL_SHA256, captureTree, discoverOriginParent, sha256, validateManifest, publishCapturePair } from "./lib/protected-origin.mjs";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 4 || process.argv[2] !== "--origin-parent") throw new Error("Uso: node scripts/capture-protected-origin.mjs --origin-parent /origem/RODRIGO-BOGNIN (captura única, revisão obrigatória)");
const origin = discoverOriginParent(project, process.argv[3]);
const historicalBytes = await readFile(path.join(project, "docs/protected-origin-manifest.json"));
if (sha256(historicalBytes) !== HISTORICAL_SHA256) throw new Error("Manifesto histórico adulterado.");
const historical = JSON.parse(historicalBytes);
const roots = {}, observed = [];
for (const root of ROOT_NAMES) roots[root] = await captureTree(path.join(origin, root), observed);
const manifest = validateManifest({ version: 1, captured_at: new Date().toISOString(), historical_manifest_sha256: HISTORICAL_SHA256, scope: "preservation-since-current-capture", roots });
const reconciliation = { captured_at: manifest.captured_at, historical_manifest_sha256: HISTORICAL_SHA256, scope: "Diferenças anteriores à captura atual; não atribuídas ao PR. Não prova identidade contínua desde agosto.", roots: {} };
for (const root of ROOT_NAMES) {
  const previous = new Map(historical.roots[`RODRIGO-BOGNIN/${root}`].files.map((item) => [item.path, item]));
  const added = [], changed = [];
  for (const item of roots[root].files) {
    const before = previous.get(item.path);
    if (!before) added.push(item);
    else if (before.sha256 !== item.sha256 || before.size !== item.size) changed.push({ path: item.path, before, after: item });
    previous.delete(item.path);
  }
  reconciliation.roots[root] = { added, changed, removed: [...previous.values()] };
}
const staged = await mkdtemp(path.join(project, "docs/.protected-origin-capture-"));
try {
  const first = path.join(staged, "manifest.json"), second = path.join(staged, "reconciliation.json");
  await writeFile(first, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(second, `${JSON.stringify(reconciliation, null, 2)}\n`, { flag: "wx" });
  await publishCapturePair(first, path.join(project, "docs/protected-origin-current.json"), second, path.join(project, "docs/protected-origin-reconciliation.json"));
} finally { await rm(staged, { recursive: true, force: true }); }
console.log("Captura explícita gravada. Ancore o SHA-256 e os digests no código após revisão; verify não recaptura.");
