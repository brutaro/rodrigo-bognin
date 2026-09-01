#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
const password = (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim();
const sql = postgres({ host: process.env.PGHOST ?? "db", database: process.env.PGDATABASE ?? "tria", username: "tria_migrator", password, max: 1 });
const base = process.env.APP_BASE_URL ?? "http://app:3000";
function assert(value, message) { if (!value) throw new Error(message); }
async function health(expected) { const response = await fetch(`${base}/api/health`); assert(response.status === expected, `health ${response.status}, esperado ${expected}`); }
async function authenticatedCookie() {
  const key = await readFile(process.env.TRIA_SESSION_KEY_FILE); const now = Date.now(); const jti = randomUUID();
  const payload = Buffer.from(JSON.stringify({ sub: "Rodrigo", iss: "tria-plano-b", aud: "tria-owner", ver: 1, iat: now, exp: now + 3_600_000, jti })).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  const idHash = createHmac("sha256", key).update(`session:${jti}`).digest("hex");
  await sql`INSERT INTO owner_session (id_hash, created_at, expires_at) VALUES (${idHash}, to_timestamp(${now} / 1000.0), to_timestamp(${now + 3_600_000} / 1000.0))`;
  return `tria_session=${payload}.${signature}`;
}
try {
  await health(200);
  const [version] = await sql`SELECT v.id::text id, v.object_key::text, v.evidence_asset_id asset FROM file_version v
    WHERE (SELECT count(*) FROM project_evidence pe WHERE pe.evidence_asset_id = v.evidence_asset_id) = 2 LIMIT 1`;
  const object = path.join(process.env.TRIA_FILE_STORE_PATH, "objects", version.object_key); const moved = `${object}.health-test`;
  await rename(object, moved); try { await health(503); } finally { await rename(moved, object); } await health(200);
  await sql`UPDATE file_document SET status = 'purging' WHERE id = (SELECT document_id FROM file_version WHERE id = ${version.id})`; try { await health(503); } finally { await sql`UPDATE file_document SET status = 'active' WHERE id = (SELECT document_id FROM file_version WHERE id = ${version.id})`; } await health(200);
  const [link] = await sql`DELETE FROM project_evidence WHERE project_id = 'synthetic-p1' AND evidence_asset_id = ${version.asset} RETURNING *`;
  try { await health(503); } finally { await sql`INSERT INTO project_evidence (project_id, evidence_asset_id, strength, rule_used, caveat, status, batch_id) VALUES (${link.project_id}, ${link.evidence_asset_id}, ${link.strength}, ${link.rule_used}, ${link.caveat}, ${link.status}, ${link.batch_id})`; } await health(200);
  const cookie = await authenticatedCookie(); const headers = { Cookie: cookie }; const downloads = [];
  for (const projectId of ["synthetic-p1", "synthetic-p2"]) {
    const response = await fetch(`${base}/api/projects/${projectId}/evidence/${version.asset}/download`, { headers });
    assert(response.status === 200 && response.headers.get("x-tria-file-sha256") === version.asset, `download vinculado inválido: ${projectId} status=${response.status} sha=${response.headers.get("x-tria-file-sha256")}`); downloads.push(Buffer.from(await response.arrayBuffer()));
  }
  assert(downloads[0].equals(downloads[1]) && createHash("sha256").update(downloads[0]).digest("hex") === version.asset, "bytes compartilhados divergentes");
  const unrelated = await fetch(`${base}/api/projects/synthetic-p2/evidence/${createHash("sha256").update("bbb").digest("hex")}/download`, { headers }); assert(unrelated.status === 404, "projeto sem vínculo deve receber 404");
  const generic = await fetch(`${base}/api/files/${version.id}/download`, { headers }); assert(generic.status === 404, "endpoint genérico não pode contornar vínculo");
  const audit = await sql`SELECT project_id FROM file_operation_event WHERE operation = 'download' ORDER BY project_id`;
  assert(audit.length === 2 && audit[0].project_id === "synthetic-p1" && audit[1].project_id === "synthetic-p2", "auditoria não preservou projetos");
  console.log("integração sintética: crash/resume, health e downloads validados");
} finally { await sql.end(); }
