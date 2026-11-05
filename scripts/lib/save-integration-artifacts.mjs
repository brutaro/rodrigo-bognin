#!/usr/bin/env node
// Only explicit synthetic diagnostics are copied. Never copy temp/secrets,
// compose overrides, environment dumps, browser profiles, or fixture inputs.
import { lstat, mkdir, readdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
const [checkout, temporary, base, run] = process.argv.slice(2);
if (!checkout || !temporary || !base || !/^[a-z0-9_-]+$/.test(run ?? "")) throw new Error("Invalid artifact destination");
const root = await realpath(checkout);
async function canonicalDestination(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  for (;;) {
    try { return path.join(await realpath(current), ...missing); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
const destinationBase = await canonicalDestination(base);
const relative = path.relative(root, destinationBase);
if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Artifacts must remain outside the checkout");
await mkdir(destinationBase, { recursive: true, mode: 0o700 });
const realBase = await realpath(destinationBase);
const realRelative = path.relative(root, realBase);
if (!realRelative || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== ".." && !path.isAbsolute(realRelative))) throw new Error("Artifact symlink resolves into the checkout");
function assertContained(basePath, candidate) {
  const relative = path.relative(basePath, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Artifact destination escaped its base");
  const checkoutRelative = path.relative(root, candidate);
  if (!checkoutRelative || (!checkoutRelative.startsWith(`..${path.sep}`) && checkoutRelative !== ".." && !path.isAbsolute(checkoutRelative))) throw new Error("Artifacts must remain outside the checkout");
}
async function ensureDirectory(candidate) {
  assertContained(realBase, candidate);
  const components = path.relative(realBase, candidate).split(path.sep).filter(Boolean);
  for (let current = realBase, index = -1; index < components.length; index++) {
    if (index >= 0) current = path.join(current, components[index]);
    let details = await lstat(current).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!details) {
      await mkdir(current, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
      details = await lstat(current);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("Artifact destination directory is not regular");
    const resolved = await realpath(current);
    assertContained(realBase, resolved);
    if (resolved !== current) throw new Error("Artifact destination contains a symlink");
  }
}
const destination = path.join(realBase, run);
for (const directory of [destination, path.join(destination, "browser"), path.join(destination, "containers")]) await ensureDirectory(directory);
async function copyRegularFile(from, to) {
  await ensureDirectory(path.dirname(to));
  const existing = await lstat(to).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error("Artifact destination file is not regular");
  const source = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let target;
  try {
    if (!(await source.stat()).isFile()) throw new Error("Artifact source is not regular");
    // O_NOFOLLOW refuses a leaf replaced after lstat; do not truncate anything
    // until final containment and identity checks have passed.
    target = await open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const details = await target.stat(), current = await lstat(to);
    assertContained(realBase, await realpath(to));
    if (!details.isFile() || current.isSymbolicLink() || details.dev !== current.dev || details.ino !== current.ino) throw new Error("Artifact destination changed before copy");
    await target.truncate(0);
    await target.writeFile(await source.readFile());
  } finally { await target?.close(); await source.close(); }
}
async function copyDirectory(source, target, allowed) {
  let entries;
  try { entries = await readdir(source, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !allowed(entry.name)) continue;
    const from = path.join(source, entry.name);
    if (!(await lstat(from)).isFile()) throw new Error("Artifact changed during collection");
    await copyRegularFile(from, path.join(target, entry.name));
  }
}
await copyDirectory(temporary, destination, (name) => ["suite.log", "tools-build.log", "runner-build.log", "integration-result.json"].includes(name));
await copyDirectory(path.join(temporary, "evidence"), path.join(destination, "browser"), (name) => /\.(png|json|txt)$/.test(name));
await copyDirectory(path.join(temporary, "diagnostics"), path.join(destination, "containers"), (name) => /^[a-zA-Z0-9_-]+\.log$/.test(name));
console.error(`Diagnóstico sintético preservado: ${destination}`);
