#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, opendir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_SHA256 = "b9b2979be4e5174dc1b1a49f55377db0e32e9e4d320c7b94c6bee98648f35bfa";
const TREE_ANCHORS = new Map([
  ["RODRIGO-BOGNIN/_bmad", "c3ffd46aa4dcd780ba6c6155caaeaa61e7212ade7fc7da21a7989ce059621547"],
  ["RODRIGO-BOGNIN/_bmad-output", "690f23a86a0027b581fe06a0d2f58e3b06394691df6dbc684cb59920aef9c307"],
  ["RODRIGO-BOGNIN/.agents", "bf0a1cdf26222e6c5b44a4862092ff0d0823a14231704d6a0e4c80228cba425f"],
]);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(project, "docs/protected-origin-manifest.json");
const bytes = await readFile(manifestPath);
if (createHash("sha256").update(bytes).digest("hex") !== MANIFEST_SHA256) throw new Error("Manifesto protegido divergiu da âncora externa ao documento.");
const manifest = JSON.parse(bytes.toString("utf8")); const projectsRoot = path.dirname(path.dirname(project)); const failures = [];
async function regularFiles(root) {
  const result = []; const pending = [{ absolute: root, relative: "" }];
  while (pending.length) {
    const current = pending.pop(); const directory = await opendir(current.absolute);
    for await (const entry of directory) {
      const absolute = path.join(current.absolute, entry.name); const relative = path.posix.join(current.relative, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) throw new Error(`Link simbólico recusado: ${relative}`);
      if (details.isDirectory()) pending.push({ absolute, relative });
      else if (details.isFile()) result.push({ absolute, relative, size: details.size });
      else throw new Error(`Entrada não regular recusada: ${relative}`);
    }
  }
  return result.sort((a, b) => a.relative.localeCompare(b.relative));
}
for (const [rootName, model] of Object.entries(manifest.roots ?? {})) {
  const trustedTree = TREE_ANCHORS.get(rootName);
  if (!trustedTree || model.tree_sha256 !== trustedTree || model.file_count !== model.files?.length) { failures.push(`${rootName}:metadados`); continue; }
  const absoluteRoot = path.resolve(projectsRoot, rootName);
  if (absoluteRoot !== path.join(projectsRoot, rootName) || !absoluteRoot.startsWith(`${projectsRoot}${path.sep}`)) { failures.push(`${rootName}:contenção`); continue; }
  let actual;
  try { const rootDetails = await lstat(absoluteRoot); if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error("root não regular"); actual = await regularFiles(absoluteRoot); } catch (error) { failures.push(`${rootName}:${error.message}`); continue; }
  const expected = new Map(model.files.map((entry) => [entry.path, entry]));
  if (actual.length !== model.file_count || new Set(model.files.map((entry) => entry.path)).size !== model.file_count) failures.push(`${rootName}:conjunto`);
  for (const item of actual) {
    const entry = expected.get(item.relative); if (!entry) { failures.push(`${rootName}/${item.relative}:extra`); continue; }
    const handle = await open(item.absolute, "r"); const hash = createHash("sha256");
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); } finally { await handle.close(); }
    if (item.size !== entry.size || hash.digest("hex") !== entry.sha256) failures.push(`${rootName}/${item.relative}:conteúdo`);
    expected.delete(item.relative);
  }
  for (const missing of expected.keys()) failures.push(`${rootName}/${missing}:ausente`);
}
if (manifest.roots && Object.keys(manifest.roots).length !== TREE_ANCHORS.size) failures.push("roots:conjunto");
if (failures.length) { console.error(`Origem protegida divergiu em ${failures.length} item(ns): ${failures.slice(0, 5).join(", ")}`); process.exit(1); }
console.log("origem protegida: âncora, roots, árvore e arquivos permanecem byte a byte inalterados");
