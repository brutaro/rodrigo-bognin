import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";

const maximumDepth = 8;
const maximumEntries = 1_000;
const catalogPresentations = new Map([
  ["apresentação PowerPoint", ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
  ["documento PDF", ["pdf", "application/pdf"]],
  ["documento Word", ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  ["modelo/relatório Power BI", ["pbix", "application/octet-stream"]],
  ["planilha Excel OOXML", ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  ["planilha Excel binária", ["xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"]],
  ["planilha Excel com macro", ["xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"]],
  ["vídeo MP4", ["mp4", "video/mp4"]],
]);

async function filesBelow(root) {
  const result = [];
  const pending = [{ directory: root, depth: 0 }];
  let observedEntries = 0;
  while (pending.length) {
    const current = pending.shift();
    const handle = await opendir(current.directory);
    for await (const entry of handle) {
      observedEntries += 1;
      if (observedEntries > maximumEntries) throw new Error("O pacote excede o limite de entradas.");
      const absolute = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("O pacote contém link simbólico.");
      if (entry.isDirectory()) {
        if (current.depth >= maximumDepth) throw new Error("O pacote excede a profundidade permitida.");
        pending.push({ directory: absolute, depth: current.depth + 1 });
      } else if (entry.isFile()) result.push({ absolute, relative: path.relative(root, absolute) });
      else throw new Error("O pacote contém entrada não regular.");
    }
  }
  return result;
}

export function presentationForCatalogType(fileType, index) {
  const presentation = catalogPresentations.get(fileType);
  if (!presentation) throw new Error("Tipo catalogado de evidência não suportado.");
  return { originalName: `EV-${String(index + 1).padStart(3, "0")}.${presentation[0]}`, mediaType: presentation[1] };
}

export async function hashRegularFile(absolute) {
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("A evidência não é um arquivo regular.");
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) { sizeBytes += chunk.length; hash.update(chunk); }
  } finally { await handle.close(); }
  const after = await lstat(absolute);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("Uma evidência mudou durante a validação.");
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function inspectEvidencePackage(sourceDirectory, expectedHashes, options = {}) {
  const root = path.resolve(sourceDirectory);
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("O pacote de evidências deve ser um diretório regular.");
  const files = (await filesBelow(root)).sort((a, b) => a.relative.localeCompare(b.relative));
  const expectedCount = options.expectedCount ?? 53;
  const expectedTotalBytes = options.expectedTotalBytes ?? 1_126_834_973;
  if (files.length !== expectedCount) throw new Error(`O pacote deve conter exatamente ${expectedCount} evidência(s).`);
  const expected = new Set(expectedHashes);
  if (expected.size !== expectedCount || [...expected].some((value) => !/^[0-9a-f]{64}$/.test(value))) throw new Error("O catálogo esperado de evidências é inválido.");
  const observed = new Set(); const entries = []; let totalBytes = 0;
  for (const file of files) {
    const integrity = await hashRegularFile(file.absolute);
    if (observed.has(integrity.sha256)) throw new Error("O pacote contém conteúdo duplicado.");
    observed.add(integrity.sha256); totalBytes += integrity.sizeBytes; entries.push({ ...file, ...integrity });
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes !== expectedTotalBytes) throw new Error("O tamanho total do pacote diverge do catálogo aprovado.");
  if (observed.size !== expected.size || [...observed].some((hash) => !expected.has(hash))) throw new Error("O conjunto de hashes do pacote diverge do catálogo aprovado.");
  entries.sort((a, b) => a.sha256.localeCompare(b.sha256));
  return { root, entries, totalBytes };
}
