#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORICAL_SHA256, regularFileBytes, sha256, discoverOriginParent, validateManifest, verifyTrees } from "./lib/protected-origin.mjs";

const CURRENT_MANIFEST_SHA256 = "870a305f86f252ced3024feb162a5327154d2f7e44c7fcc56170173992871427";
const RECONCILIATION_SHA256 = "022263baa5b2d849e5540db63a099ece5667a45a18b6713de9836077dcf51c1f";
const TREE_ANCHORS = Object.freeze({
  _bmad: [46, "44657016112897f3602b0f5305019c38d04fe7f3c83a51b825619bc553ca0d6c"],
  "_bmad-output": [105, "5250807bd7da577a164189e082a7bd2b5daf1725d1b5ec7411859e67915245f1"],
  ".agents": [243, "040ec4f294ff046df212e6193b6b6ba4eb9cd10f9321a617dd986ca971f1ea6e"],
});
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--origin-parent")) throw new Error("Uso: npm run origin:verify -- [--origin-parent /origem/RODRIGO-BOGNIN]. Nenhuma opção de captura/hash é aceita.");
  for (const [file, expected] of [
    ["protected-origin-manifest.json", HISTORICAL_SHA256],
    ["protected-origin-current.json", CURRENT_MANIFEST_SHA256],
    ["protected-origin-reconciliation.json", RECONCILIATION_SHA256],
  ]) {
    const bytes = await regularFileBytes(path.join(project, "docs", file));
    if (sha256(bytes) !== expected) throw new Error(`Manifesto/relatório divergiu da âncora no código: ${file}`);
  }
  const manifest = validateManifest(JSON.parse(await regularFileBytes(path.join(project, "docs/protected-origin-current.json"))));
  for (const [root, [count, digest]] of Object.entries(TREE_ANCHORS)) {
    if (manifest.roots[root].file_count !== count || manifest.roots[root].tree_sha256 !== digest) throw new Error(`Âncora da árvore divergiu: ${root}`);
  }
  const origin = discoverOriginParent(project, args[1]);
  await verifyTrees(manifest, origin);
  console.log(`origem protegida: captura atual, árvores e arquivos preservados; histórico intacto (origem: ${origin})`);
} catch (error) {
  console.error(`Origem protegida recusada: ${error.message}`);
  process.exitCode = 1;
}
