#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
const password = (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim();
const sql = postgres({ host: process.env.PGHOST ?? "db", database: process.env.PGDATABASE ?? "tria", username: process.env.PGUSER ?? "tria_migrator", password, max: 1 });
const values = ["aa", "bbb"].map((value) => createHash("sha256").update(value).digest("hex"));
try { await sql.begin(async (tx) => {
  const batch = "11111111-1111-4111-8111-111111111111"; const evidenceBatch = "33333333-3333-4333-8333-333333333333";
  await tx`INSERT INTO import_batch (id, source_type, relative_path, sha256, row_count, status) VALUES
    (${batch}, 'activities', 'redacted', ${"0".repeat(64)}, 2, 'completed'),
    (${evidenceBatch}, 'project_evidence', 'redacted', ${"1".repeat(64)}, 2, 'completed')`;
  await tx`INSERT INTO project (id, source_project_id, title, evidence_status, import_batch_id) VALUES
    ('synthetic-p1', 'synthetic-p1', 'Synthetic P1', 'available', ${batch}), ('synthetic-p2', 'synthetic-p2', 'Synthetic P2', 'available', ${batch})`;
  await tx`INSERT INTO evidence_asset (id, sha256, file_type, private_path, batch_id) VALUES
    (${values[0]}, ${values[0]}, 'documento PDF', 'redacted', ${evidenceBatch}), (${values[1]}, ${values[1]}, 'vídeo MP4', 'redacted', ${evidenceBatch})`;
  await tx`INSERT INTO project_evidence (project_id, evidence_asset_id, strength, rule_used, caveat, status, batch_id) VALUES
    ('synthetic-p1', ${values[0]}, 'forte', 'synthetic', null, 'linked', ${evidenceBatch}), ('synthetic-p2', ${values[0]}, 'forte', 'synthetic', null, 'linked', ${evidenceBatch}),
    ('synthetic-p1', ${values[1]}, 'média', 'synthetic', null, 'linked', ${evidenceBatch})`;
}); } finally { await sql.end(); }
console.log(JSON.stringify({ hashes: values }));
