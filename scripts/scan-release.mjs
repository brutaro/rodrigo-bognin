#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenDirectory = /(^|\/)(\.secrets|uploads?|evidence-import|bootstrap-data|backups?|dumps?|sources?|dados?|evidencias?)(\/|$)/i;
const forbiddenExtension = /\.(csv|pdf|docx?|xlsx?|xlsb|xlsm|pptx?|pbix|png|jpe?g|gif|webp|tiff?|bmp|zip|7z|tar|gz|sql|dump)$/i;
const allowedBinaryAssets = new Set([
  "src/app/favicon.ico", "public/file.svg", "public/vercel.svg", "public/next.svg", "public/globe.svg", "public/window.svg",
  "public/report-fonts/noto-sans-latin-400-normal.woff", "public/report-fonts/noto-sans-latin-700-normal.woff",
]);
const allowedSourceCode = new Set([
  "src/app/api/sources/consolidated/route.ts",
  "src/app/api/sources/consolidated/route.test.ts",
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@<>{}]+@/i,
  /(?:TRIA_DB_(?:ADMIN|APP|MIGRATOR|IMPORTER)_PASSWORD|TRIA_SESSION_KEY|TRIA_LOGIN_CODE)\s*=\s*(?!<|preserve\(|\$\{\{|disabled\b)["']?[A-Za-z0-9_+\/=.-]{12,}/,
  /(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|RAILWAY_TOKEN)\s*=\s*["']?[A-Za-z0-9_+\/=.-]{16,}/,
];
export function pathViolation(relative) {
  const clean = relative.replaceAll("\\", "/").replace(/^\.\//, "");
  if (clean.startsWith(".git/") || clean.startsWith("node_modules/") || clean.startsWith(".next/")) return "ignored";
  if (allowedSourceCode.has(clean)) return null;
  if (forbiddenDirectory.test(clean) && !clean.startsWith("src/app/api/backups/")) return "diretório de dado/secret proibido";
  if (clean.startsWith("db/migrations/") && clean.endsWith(".sql")) return null;
  if ((forbiddenExtension.test(clean) || /\.(ico|woff2?)$/i.test(clean)) && !allowedBinaryAssets.has(clean)) return "tipo binário/dado fora da allowlist";
  return null;
}
export async function scanReadable(readable) {
  let overlap = "";
  for await (const chunk of readable) {
    const text = overlap + Buffer.from(chunk).toString("latin1");
    if (secretPatterns.some((pattern) => pattern.test(text))) return true;
    overlap = text.slice(-8192);
  }
  return false;
}
export async function scanFile(file) { return scanReadable(createReadStream(file, { highWaterMark: 64 * 1024 })); }
async function walk(root) {
  const files = []; const pending = [{ absolute: root, relative: "" }];
  while (pending.length) {
    const current = pending.pop(); const directory = await opendir(current.absolute);
    for await (const entry of directory) {
      const relative = path.posix.join(current.relative, entry.name);
      if (relative === ".secrets" && entry.isDirectory()) continue;
      const violation = pathViolation(relative);
      if (violation === "ignored") continue;
      const absolute = path.join(current.absolute, entry.name); const details = await lstat(absolute);
      if (details.isSymbolicLink()) { files.push({ relative, absolute, symlink: true }); continue; }
      if (details.isDirectory()) pending.push({ absolute, relative }); else if (details.isFile()) files.push({ relative, absolute, violation });
    }
  }
  return files;
}
function blobStream(sha) {
  const child = spawn("git", ["cat-file", "blob", sha], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume(); return { readable: child.stdout, done: new Promise((resolve, reject) => child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`git cat-file ${sha} falhou`)))) };
}
async function main() {
  const failures = [];
  for (const file of await walk(project)) {
    if (file.symlink) { failures.push(`${file.relative}: link simbólico`); continue; }
    if (file.violation) { failures.push(`${file.relative}: ${file.violation}`); continue; }
    if (await scanFile(file.absolute)) failures.push(`${file.relative}: possível secret`);
  }
  const revisions = spawnSync("git", ["rev-list", "--objects", "--all"], { cwd: project, encoding: "utf8" });
  if (revisions.status !== 0) throw new Error("Não foi possível enumerar o histórico Git.");
  const seen = new Set();
  for (const line of revisions.stdout.split("\n")) {
    const match = /^([0-9a-f]{40}) (.+)$/.exec(line); if (!match) continue;
    const [, sha, relative] = match;
    if (seen.has(sha)) continue; seen.add(sha);
    const type = spawnSync("git", ["cat-file", "-t", sha], { cwd: project, encoding: "utf8" }); if (type.stdout.trim() !== "blob") continue;
    const violation = pathViolation(relative);
    if (violation && violation !== "ignored") failures.push(`histórico:${relative}: ${violation}`);
    const stream = blobStream(sha); if (await scanReadable(stream.readable)) failures.push(`histórico:${relative}: possível secret`); await stream.done;
  }
  if (failures.length) { console.error(`Release recusada (${failures.length} achado(s)):\n${[...new Set(failures)].slice(0, 30).join("\n")}`); process.exit(1); }
  console.log("release scan: árvore e todo o histórico sem fontes, evidências, dumps, uploads ou secrets detectáveis");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
