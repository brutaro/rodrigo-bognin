#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED_BASELINE_COMMIT = "f04b52093c8163a60023f2ae9fed62c117b64c18";
const EXPECTED_PROTECTED = Object.freeze([
  {
    "path": ".github/workflows/ci-deploy.yml",
    "sha256": "6975ac7aef4fa4ffa33c3fcab5cfd36e456c9bc8e75b830657f95b4b07f01820",
    "bytes": 3223,
    "basis": "baseline-commit-exact"
  },
  {
    "path": "db/migrations/029_source_import_preparation.sql",
    "sha256": "b78cad705fcb0b339df46cd694f43ce2195214ef933e6272b10562a405c5755f",
    "bytes": 26156,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "package-lock.json",
    "sha256": "4d848ea8bdc896596eee6795b7ec2bd1a91b50a56abfe7442880f47e8918fad1",
    "bytes": 322249,
    "basis": "captured-tracked-patch-and-reattested"
  },
  {
    "path": "scripts/ci-isolated-integration.sh",
    "sha256": "817eb407122bbb5bbf45b0033b92f8ebb2dad48249e802869345637c0a8503c5",
    "bytes": 7237,
    "basis": "baseline-commit-exact"
  },
  {
    "path": "scripts/configure-synthetic-import-bridge.mjs",
    "sha256": "133536ac5bf6f94f601c11afab9eedad88c8e8b24717f4feee9e303c5c5565d1",
    "bytes": 616,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "scripts/seed-synthetic-import-attestation.mjs",
    "sha256": "1bee59d222d986931f276458df1b67b556ee29a0b4512e6bbb28935b180d2e32",
    "bytes": 2787,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "scripts/seed-synthetic-import-source.mjs",
    "sha256": "cf6b02cc0e2d7d2e5f4259a202dbd82f54a54eb4a4223d3535899e2af1916c80",
    "bytes": 5641,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "scripts/story-3-2-browser.mjs",
    "sha256": "a4e20b0711052fa3a88ca17b3652959c2dacf50015ef223a8ce9a921089fe74d",
    "bytes": 13277,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "scripts/story-3-2-isolated-integration.sh",
    "sha256": "bce9a46c5da4c8342232f718d0cf1128d5e6fd8235d6aae905826368ec31e289",
    "bytes": 9182,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "src/app/api/health/route.ts",
    "sha256": "ad963756058fa356737bdfc9feb1879661f5d506021a87c3215dcc685fe19b8f",
    "bytes": 4738,
    "basis": "baseline-commit-exact"
  },
  {
    "path": "src/app/fontes/base-consolidada/page.tsx",
    "sha256": "2fe5d27cdd83f5d5bbad4e432b0718f169d2c9194bddde344689dd0c6dc37b37",
    "bytes": 1090,
    "basis": "captured-tracked-patch-and-reattested"
  },
  {
    "path": "src/components/consolidated-source-flow.tsx",
    "sha256": "e344219d9bed4538d1740929eef56188b8723b6f47ab24fbdeb069c3dec868b2",
    "bytes": 653,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "src/components/consolidated-source-upload.tsx",
    "sha256": "693ba83f03f584ab42bf349098a418cba010255c3d84622d4dae4027fdb57112",
    "bytes": 7970,
    "basis": "captured-tracked-patch-and-reattested"
  },
  {
    "path": "src/lib/consolidated-source-repository.ts",
    "sha256": "b8c548be2a7654bd6d0e27490b4b2753e611452a0ed4689d6b00a6156edd21dc",
    "bytes": 5433,
    "basis": "captured-tracked-patch-and-reattested"
  },
  {
    "path": "vitest.config.ts",
    "sha256": "0ff1be36f0aa312cbcf60d780dd219fd68bf101982fb97623cbb13669a5353c0",
    "bytes": 396,
    "basis": "captured-untracked-and-reattested"
  },
  {
    "path": "vitest.story-3-2.config.ts",
    "sha256": "f99509bd2393b78a857ce08583c654b4e14ea20a517648533bad1d08d12e1c5e",
    "bytes": 527,
    "basis": "captured-untracked-and-reattested"
  }
].map((entry) => Object.freeze(entry)));
const EXPECTED_INTEGRATION = Object.freeze([
  {
    "path": ".dockerignore",
    "baselineSha256": "c15946a97df86aaf5ecdec07deeb0905f73cda21d8e1c0e3aadb48173226ae3d",
    "baselineBytes": 191,
    "approvedSha256": "2f8d49aa9c3931726019125fbbcf5e2204b6bbb7c32b5c6d6c3d9c6522856a29",
    "approvedBytes": 273,
    "approval": "whole-final-file"
  },
  {
    "path": ".gitignore",
    "baselineSha256": "c158d6f1e76f72c14c46bafec21d8d55baad3ebc6465ba78c70275e83c0eac7c",
    "baselineBytes": 592,
    "approvedSha256": "3af140d35631c16de8a2279d15750b9acf4cffa641aedf716abde7629aca446b",
    "approvedBytes": 676,
    "approval": "whole-final-file"
  },
  {
    "path": "package.json",
    "baselineSha256": "e09bdb3edce4952d47a3545a3c47bc66dc8149bf9db06993fb2cf7e4695b9126",
    "baselineBytes": 1682,
    "approvedSha256": "66c823000bd911bdb8317f0c076186b2af1bebc8110a7958c023f0821c0e776f",
    "approvedBytes": 1767,
    "approval": "whole-final-file"
  },
  {
    "path": "scripts/test-integration.mjs",
    "baselineSha256": "ee21448ba04c4e74db762660d2f36ef4596d0615460c70d8354212e127d59464",
    "baselineBytes": 658,
    "approvedSha256": "cd59af1ba3041d82a400df758f5ad79eb7c160b44191474d1506de6c529256aa",
    "approvedBytes": 1403,
    "approval": "whole-final-file"
  },
  {
    "path": "scripts/validate-database.mjs",
    "baselineSha256": "15d5d66815972eca9089b7835d887b2f6891a529bebd365f8f1621e639777c0e",
    "baselineBytes": 14774,
    "approvedSha256": "b0f4a49ba9863c271b89bf70a72f20f3257e3e43612d319e5e5986a94613619b",
    "approvedBytes": 16474,
    "approval": "whole-final-file"
  },
  {
    "path": "src/app/fontes/base-consolidada/actions.ts",
    "baselineSha256": "76a9461937ff7e2fcc814eb88c5ddabc2922aac3425b36d55ed28ab9e67d08ff",
    "baselineBytes": 6184,
    "approvedSha256": "f8ae2726e6ac7ab2df161421cb1370fbca747f5b01133be6bf6da7b0300b2e5b",
    "approvedBytes": 16044,
    "approval": "whole-final-file"
  },
  {
    "path": "src/components/consolidated-source-preparation.tsx",
    "baselineSha256": "20eb373f9787a09f367b886edf59a4792832c963f7b491fb94746f51f76d39ad",
    "baselineBytes": 15373,
    "approvedSha256": "2b455bfe5d749d5f7b489753633832bd9968d363cb394809c41d9505c1050d8b",
    "approvedBytes": 16946,
    "approval": "whole-final-file"
  }
].map((entry) => Object.freeze(entry)));
const EXPECTED_COMMIT_BLOBS = Object.freeze([
  {
    "path": ".dockerignore",
    "sha256": "c15946a97df86aaf5ecdec07deeb0905f73cda21d8e1c0e3aadb48173226ae3d",
    "bytes": 191
  },
  {
    "path": ".github/workflows/ci-deploy.yml",
    "sha256": "6975ac7aef4fa4ffa33c3fcab5cfd36e456c9bc8e75b830657f95b4b07f01820",
    "bytes": 3223
  },
  {
    "path": ".gitignore",
    "sha256": "c158d6f1e76f72c14c46bafec21d8d55baad3ebc6465ba78c70275e83c0eac7c",
    "bytes": 592
  },
  {
    "path": "package-lock.json",
    "sha256": "07ab1da1b1e2db12bd25b989cead70fa9e91c50de4942f7291fcb71cb53cfd9a",
    "bytes": 320709
  },
  {
    "path": "package.json",
    "sha256": "cd7521deece7b22c5033abe7864893b669c020bcb3fa41ac078954591dabad16",
    "bytes": 1635
  },
  {
    "path": "scripts/ci-isolated-integration.sh",
    "sha256": "817eb407122bbb5bbf45b0033b92f8ebb2dad48249e802869345637c0a8503c5",
    "bytes": 7237
  },
  {
    "path": "scripts/validate-database.mjs",
    "sha256": "381a4ce5a0e4a9fd3e80b48b1c36d95fb41fe9dfd3788fa21b3e8247004e5307",
    "bytes": 14042
  },
  {
    "path": "src/app/api/health/route.ts",
    "sha256": "ad963756058fa356737bdfc9feb1879661f5d506021a87c3215dcc685fe19b8f",
    "bytes": 4738
  },
  {
    "path": "src/app/fontes/base-consolidada/page.tsx",
    "sha256": "c6543be9ffb09ca0dd47ae750de930133ad66236d1b9a725ad234eba8a1ed872",
    "bytes": 1092
  },
  {
    "path": "src/components/consolidated-source-upload.tsx",
    "sha256": "1650085f23f0b085289e2f1b5f4d68e329c8c119cb442208f2ffed4012beb9fa",
    "bytes": 7185
  },
  {
    "path": "src/lib/consolidated-source-repository.ts",
    "sha256": "32c74747b8abf1d21b6e12a0a998f7031a298d53812fa80e0fb81e9e9cd91c8a",
    "bytes": 5243
  }
].map((entry) => Object.freeze(entry)));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultContract = path.resolve(projectRoot, "tests", "contracts", "story-3-3-baseline.json");
const hashPattern = /^[0-9a-f]{64}$/;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`argumento sem valor: ${name}`);
  return process.argv[index + 1];
}
function sha256Buffer(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256(file) { return sha256Buffer(readFileSync(file)); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameFields(actual, expected, fields) { return fields.every((field) => actual?.[field] === expected[field]); }
function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validatePath(root, candidate, label, failures) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\\") || path.posix.isAbsolute(candidate) || path.posix.normalize(candidate) !== candidate || candidate === ".." || candidate.startsWith("../")) {
    failures.push(`${label} contém caminho inseguro: ${String(candidate)}`); return null;
  }
  const file = path.resolve(root, candidate);
  const relative = path.relative(root, file);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { failures.push(`${label} escapa da raiz: ${candidate}`); return null; }
  try {
    const details = lstatSync(file);
    if (details.isSymbolicLink() || !details.isFile()) { failures.push(`${label} não é arquivo regular: ${candidate}`); return null; }
    const realRelative = path.relative(realpathSync(root), realpathSync(file));
    if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) { failures.push(`${label} resolve fora da raiz: ${candidate}`); return null; }
    return { file, bytes: details.size };
  } catch { failures.push(`${label} ausente: ${candidate}`); return null; }
}

function compareExactSet(actual, expected, fields, label, failures) {
  if (!Array.isArray(actual)) { failures.push(`${label} deve ser array`); return; }
  if (actual.length !== expected.length) failures.push(`${label} deve conter exatamente ${expected.length} entradas; encontrou ${actual.length}`);
  const seen = new Set();
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  for (const entry of actual) {
    if (!isRecord(entry) || typeof entry.path !== "string") { failures.push(`entrada inválida em ${label}`); continue; }
    if (!hasExactKeys(entry, fields)) failures.push(`campos extras/ausentes em ${label}: ${entry.path}`);
    if (seen.has(entry.path)) { failures.push(`caminho duplicado em ${label}: ${entry.path}`); continue; }
    seen.add(entry.path);
    const expectedEntry = expectedByPath.get(entry.path);
    if (!expectedEntry) { failures.push(`caminho extra em ${label}: ${entry.path}`); continue; }
    if (!sameFields(entry, expectedEntry, fields)) failures.push(`baseline/approval divergente em ${label}: ${entry.path}`);
  }
  for (const entry of expected) if (!seen.has(entry.path)) failures.push(`caminho obrigatório ausente em ${label}: ${entry.path}`);
}

function validateGitEvidence(root, failures) {
  const topLevel = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (topLevel.status !== 0 || !topLevel.stdout.trim()) return false;
  let gitRoot;
  try { gitRoot = realpathSync(topLevel.stdout.trim()); } catch { return false; }
  if (gitRoot !== realpathSync(root)) return false;
  const commit = spawnSync("git", ["cat-file", "-e", `${EXPECTED_BASELINE_COMMIT}^{commit}`], { cwd: root });
  if (commit.status !== 0) { failures.push(`Git disponível, mas baselineCommit não existe: ${EXPECTED_BASELINE_COMMIT}`); return true; }
  for (const expected of EXPECTED_COMMIT_BLOBS) {
    const blob = spawnSync("git", ["show", `${EXPECTED_BASELINE_COMMIT}:${expected.path}`], { cwd: root, encoding: null, maxBuffer: 4 * 1024 * 1024 });
    if (blob.status !== 0) { failures.push(`git show falhou para ${expected.path}`); continue; }
    if (blob.stdout.length !== expected.bytes || sha256Buffer(blob.stdout) !== expected.sha256) failures.push(`evidência do baseline commit diverge: ${expected.path}`);
  }
  return true;
}

const failures = [];
let gitEvidenceValidated = false;
try {
  const root = path.resolve(argument("--root", projectRoot));
  const contractPath = path.resolve(argument("--contract", defaultContract));
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  if (!isRecord(contract) || contract.version !== 2 || contract.story !== "3.3") failures.push("contrato interno deve ser version 2 da Story 3.3");
  if (!hasExactKeys(contract, ["version", "story", "baselineCommit", "attestation", "protectedFiles", "integrationFiles", "expectedCounts"])) failures.push("contrato raiz contém campos extras/ausentes");
  if (contract.baselineCommit !== EXPECTED_BASELINE_COMMIT) failures.push(`baselineCommit deve ser ${EXPECTED_BASELINE_COMMIT}`);
  if (!hasExactKeys(contract?.attestation, ["status", "originalSnapshotComplete", "scope", "limitations"])) failures.push("attestation contém campos extras/ausentes");
  if (contract?.attestation?.status !== "reattested-known-files" || contract?.attestation?.originalSnapshotComplete !== false) failures.push("contrato deve declarar reattested-known-files e originalSnapshotComplete=false");
  if (!Array.isArray(contract?.attestation?.limitations) || contract.attestation.limitations.length === 0 || contract.attestation.limitations.some((item) => typeof item !== "string")) failures.push("contrato deve registrar limitações textuais da reatestação");
  if (!hasExactKeys(contract?.expectedCounts, ["protectedFiles", "integrationFiles"])) failures.push("expectedCounts contém campos extras/ausentes");
  if (contract?.expectedCounts?.protectedFiles !== EXPECTED_PROTECTED.length || contract?.expectedCounts?.integrationFiles !== EXPECTED_INTEGRATION.length) failures.push("expectedCounts diverge das constantes imutáveis");

  compareExactSet(contract?.protectedFiles, EXPECTED_PROTECTED, ["path", "sha256", "bytes", "basis"], "protectedFiles", failures);
  compareExactSet(contract?.integrationFiles, EXPECTED_INTEGRATION, ["path", "baselineSha256", "baselineBytes", "approvedSha256", "approvedBytes", "approval"], "integrationFiles", failures);

  for (const entry of EXPECTED_PROTECTED) {
    if (!hashPattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes)) failures.push(`constante protegida inválida: ${entry.path}`);
    const resolved = validatePath(root, entry.path, `arquivo protegido ${entry.path}`, failures);
    if (resolved && (resolved.bytes !== entry.bytes || sha256(resolved.file) !== entry.sha256)) failures.push(`arquivo protegido divergente: ${entry.path}`);
  }
  for (const entry of EXPECTED_INTEGRATION) {
    if (!hashPattern.test(entry.baselineSha256) || !Number.isSafeInteger(entry.baselineBytes)) failures.push(`baseline de integração inválida: ${entry.path}`);
    const resolved = validatePath(root, entry.path, `ponto de integração ${entry.path}`, failures);
    if (resolved && (resolved.bytes !== entry.approvedBytes || sha256(resolved.file) !== entry.approvedSha256)) failures.push(`ponto de integração fora do arquivo final aprovado: ${entry.path}`);
  }
  gitEvidenceValidated = validateGitEvidence(root, failures);
} catch (error) { failures.push(`não foi possível validar o contrato interno: ${error instanceof Error ? error.message : String(error)}`); }

if (failures.length > 0) {
  console.error("G33-01 FAIL: baseline protegida conhecida");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (gitEvidenceValidated) {
  console.log("G33-01 PASS: working tree reatestada; evidência do baseline commit validada por Git");
} else {
  console.log("G33-01 PASS: preflight do pacote planejado autossuficiente; execução Docker integral do pacote não foi alegada");
}
