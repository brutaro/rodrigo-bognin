import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, link, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const ROOT_NAMES = Object.freeze(["_bmad", "_bmad-output", ".agents"]);
export const HISTORICAL_SHA256 = "b9b2979be4e5174dc1b1a49f55377db0e32e9e4d320c7b94c6bee98648f35bfa";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function treeDigest(files) {
  return sha256(JSON.stringify(files.map(({ path: name, size, sha256: hash }) => [name, size, hash])));
}
export function validateManifest(manifest) {
  if (!keys(manifest, ["version", "captured_at", "historical_manifest_sha256", "scope", "roots"]) || manifest.version !== 1 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.captured_at) ||
      manifest.historical_manifest_sha256 !== HISTORICAL_SHA256 || manifest.scope !== "preservation-since-current-capture" ||
      !keys(manifest.roots, ROOT_NAMES)) throw new Error("Esquema do manifesto atual inválido.");
  for (const root of ROOT_NAMES) {
    const model = manifest.roots[root];
    if (!keys(model, ["tree_sha256", "file_count", "files"]) || !Array.isArray(model.files) ||
        !Number.isSafeInteger(model.file_count) || model.file_count < 0 || model.file_count !== model.files.length) throw new Error(`Contagem inválida: ${root}`);
    let previous;
    for (const entry of model.files) {
      if (!keys(entry, ["path", "size", "sha256"]) || typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") ||
          entry.path.includes("\0") || entry.path.endsWith("/") || /[\r\n]/.test(entry.path) || path.posix.isAbsolute(entry.path) || entry.path === "." ||
          entry.path === ".." || entry.path.startsWith("../") || path.posix.normalize(entry.path) !== entry.path ||
          (previous !== undefined && compare(previous, entry.path) >= 0) || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
          !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Arquivo/caminho inválido: ${root}`);
      previous = entry.path;
    }
    if (model.tree_sha256 !== treeDigest(model.files)) throw new Error(`Digest canônico inválido: ${root}`);
  }
  return manifest;
}
// Check every path component before enumeration/open, including the supplied parent.
// O_NOFOLLOW also refuses a leaf swapped for a symlink between lstat and open.
export async function assertDirectory(absolute) {
  const resolved = path.resolve(absolute);
  for (let current = path.parse(resolved).root, rest = resolved.slice(current.length).split(path.sep); rest.length;) {
    current = path.join(current, rest.shift());
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Diretório não regular: ${current}`);
  }
  return resolved;
}
const identity = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
export async function regularFileBytes(file) {
  await assertDirectory(path.dirname(file));
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Arquivo não regular: ${file}`);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error(`Arquivo mudou durante leitura: ${file}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || bytes.length !== before.size) throw new Error(`Arquivo mudou durante leitura: ${file}`);
    await assertDirectory(path.dirname(file));
    const current = await lstat(file);
    if (!current.isFile() || current.isSymbolicLink() || identity(current) !== identity(before)) throw new Error(`Arquivo mudou durante leitura: ${file}`);
    return bytes;
  } finally { await handle.close(); }
}
export async function captureTree(root, observed = []) {
  await assertDirectory(root);
  const files = [];
  async function visit(absolute, relative = "") {
    await assertDirectory(absolute);
    observed.push({ absolute, stat: await lstat(absolute), directory: true });
    const directory = await opendir(absolute);
    for await (const entry of directory) {
      const name = path.posix.join(relative, entry.name), file = path.join(absolute, entry.name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error(`Link simbólico recusado: ${name}`);
      if (stat.isDirectory()) await visit(file, name);
      else if (stat.isFile()) { const bytes = await regularFileBytes(file); observed.push({ absolute: file, stat, directory: false }); files.push({ path: name, size: bytes.length, sha256: sha256(bytes) }); }
      else throw new Error(`Entrada não regular recusada: ${name}`);
    }
  }
  await visit(root);
  // Revalidate everything at the end: additions/removals change directory stats;
  // replacement or later writes change file identity/stat. This detects ordinary
  // instability, not an atomic snapshot against a hostile local writer.
  for (const item of observed) {
    await assertDirectory(item.directory ? item.absolute : path.dirname(item.absolute));
    const current = await lstat(item.absolute);
    if (current.isSymbolicLink() || (item.directory ? !current.isDirectory() : !current.isFile()) || identity(current) !== identity(item.stat)) throw new Error(`Árvore mudou durante varredura: ${item.absolute}`);
  }
  files.sort((a, b) => compare(a.path, b.path));
  return { tree_sha256: treeDigest(files), file_count: files.length, files };
}
export function discoverOriginParent(project, explicit) {
  if (explicit !== undefined) {
    if (!path.isAbsolute(explicit)) throw new Error("--origin-parent exige caminho absoluto.");
    return path.resolve(explicit);
  }
  // A linked worktree's checkout parent is unrelated to the protected trees.
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!path.isAbsolute(common) || path.basename(common) !== ".git") throw new Error("Origem Git comum não reconhecida; forneça --origin-parent explicitamente.");
  return path.dirname(path.dirname(common));
}
export async function verifyTrees(manifest, originParent) {
  validateManifest(manifest);
  await assertDirectory(originParent);
  const observed = [];
  for (const root of ROOT_NAMES) {
    const actual = await captureTree(path.join(originParent, root), observed);
    if (actual.file_count !== manifest.roots[root].file_count || actual.tree_sha256 !== manifest.roots[root].tree_sha256) throw new Error(`Origem protegida divergiu: ${root}`);
  }
}

// Publish both prepared regular files without replacing preexisting paths.
// link() is exclusive at the destination; a caught second-publication failure
// rolls back only the exact inode this call created at the first destination.
export async function publishCapturePair(firstTemporary, firstTarget, secondTemporary, secondTarget) {
  const first = await lstat(firstTemporary);
  let published = false;
  try {
    await link(firstTemporary, firstTarget);
    published = true;
    await link(secondTemporary, secondTarget);
  } catch (error) {
    if (published) {
      const current = await lstat(firstTarget).catch(() => undefined);
      if (current && current.dev === first.dev && current.ino === first.ino) await unlink(firstTarget);
    }
    throw error;
  }
}
