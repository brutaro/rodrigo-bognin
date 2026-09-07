#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import postgres from "postgres";
const execute = promisify(execFile);
const password = (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim();
const sql = postgres({ host: process.env.PGHOST ?? "db", database: process.env.PGDATABASE ?? "tria", username: "tria_migrator", password, max: 1 });
const base = process.env.APP_BASE_URL ?? "http://app:3000";
function assert(value, message) { if (!value) throw new Error(message); }
async function mustReject(operation, message) {
  let rejected = false;
  try { await operation(); } catch { rejected = true; }
  assert(rejected, message);
}
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
  const cookie = await authenticatedCookie(); const headers = { Cookie: cookie }; const downloads = [];
  const [version] = await sql`SELECT v.id::text id, v.object_key::text, v.evidence_asset_id asset FROM file_version v
    WHERE (SELECT count(*) FROM project_evidence pe WHERE pe.evidence_asset_id = v.evidence_asset_id) = 2 LIMIT 1`;
  const object = path.join(process.env.TRIA_FILE_STORE_PATH, "objects", version.object_key); const moved = `${object}.health-test`;
  await rename(object, moved); try { await health(503); } finally { await rename(moved, object); } await health(200);
  await sql`UPDATE file_document SET status = 'purging' WHERE id = (SELECT document_id FROM file_version WHERE id = ${version.id})`; try {
    await health(200);
    const denied = await fetch(`${base}/api/projects/synthetic-p1/evidence/${version.asset}/download`, { headers });
    assert(denied.status === 404, "documento em expurgo continua acessível");
  } finally { await sql`UPDATE file_document SET status = 'active' WHERE id = (SELECT document_id FROM file_version WHERE id = ${version.id})`; } await health(200);
  const [link] = await sql`DELETE FROM project_evidence WHERE project_id = 'synthetic-p1' AND evidence_asset_id = ${version.asset} RETURNING *`;
  try {
    await health(200);
    const denied = await fetch(`${base}/api/projects/synthetic-p1/evidence/${version.asset}/download`, { headers });
    assert(denied.status === 404, "vínculo removido continua autorizando download");
  } finally { await sql`INSERT INTO project_evidence (project_id, evidence_asset_id, strength, rule_used, caveat, status, batch_id) VALUES (${link.project_id}, ${link.evidence_asset_id}, ${link.strength}, ${link.rule_used}, ${link.caveat}, ${link.status}, ${link.batch_id})`; } await health(200);
  for (const projectId of ["synthetic-p1", "synthetic-p2"]) {
    const response = await fetch(`${base}/api/projects/${projectId}/evidence/${version.asset}/download`, { headers });
    assert(response.status === 200 && response.headers.get("x-tria-file-sha256") === version.asset, `download vinculado inválido: ${projectId} status=${response.status} sha=${response.headers.get("x-tria-file-sha256")}`); downloads.push(Buffer.from(await response.arrayBuffer()));
  }
  assert(downloads[0].equals(downloads[1]) && createHash("sha256").update(downloads[0]).digest("hex") === version.asset, "bytes compartilhados divergentes");
  const unrelated = await fetch(`${base}/api/projects/synthetic-p2/evidence/${createHash("sha256").update("bbb").digest("hex")}/download`, { headers }); assert(unrelated.status === 404, "projeto sem vínculo deve receber 404");
  const generic = await fetch(`${base}/api/files/${version.id}/download`, { headers }); assert(generic.status === 404, "endpoint genérico não pode contornar vínculo");
  const audit = await sql`SELECT project_id FROM file_operation_event WHERE operation = 'download' ORDER BY project_id`;
  assert(audit.length === 2 && audit[0].project_id === "synthetic-p1" && audit[1].project_id === "synthetic-p2", "auditoria não preservou projetos");

  const sourceEndpoint = `${base}/api/sources/consolidated`;
  const sourceHeaders = { Cookie: cookie, Origin: "http://app:3000", "Content-Type": "application/x-unexpected" };
  const sourcePage = await fetch(`${base}/fontes/base-consolidada`, { headers });
  assert(sourcePage.status === 200 && (await sourcePage.text()).includes("Base consolidada de aplicação de recursos"), "página da fonte consolidada indisponível");
  const sourceRoot = process.env.TRIA_FILE_STORE_PATH;
  const [beforeSource] = await sql`SELECT
    (SELECT count(*)::int FROM source_file) sources,
    (SELECT count(*)::int FROM file_document WHERE document_kind = 'source') documents,
    (SELECT count(*)::int FROM file_reservation WHERE status = 'reserved') reservations,
    (SELECT used_bytes::text FROM file_store_counter WHERE singleton) used`;
  const objectsBeforeSource = (await readdir(path.join(sourceRoot, "objects"))).length;
  for (const invalidName of ["base.xlsm", "base.xlsb", "base.zip", "base.exe", "base.xlsx.csv", "base.csv.exe", "base%00.csv"]) {
    const rejected = await fetch(sourceEndpoint, { method: "POST", body: Buffer.from("x"),
      headers: { ...sourceHeaders, "X-TRIA-File-Name": invalidName, "X-TRIA-File-Size": "1" } });
    assert(rejected.status === 400, `fonte inválida aceita: ${invalidName}`);
  }
  const divergent = await fetch(sourceEndpoint, { method: "POST", body: Buffer.from("x"),
    headers: { ...sourceHeaders, "X-TRIA-File-Name": "fixture.csv", "X-TRIA-File-Size": "2" } });
  const oversized = await fetch(sourceEndpoint, { method: "POST", body: Buffer.from("x"),
    headers: { ...sourceHeaders, "X-TRIA-File-Name": "fixture.csv", "X-TRIA-File-Size": String(50 * 1024 * 1024 + 1) } });
  assert(divergent.status === 400 && oversized.status === 413, "limite ou divergência da fonte não falhou fechado");
  const [afterRejectedSource] = await sql`SELECT
    (SELECT count(*)::int FROM source_file) sources,
    (SELECT count(*)::int FROM file_document WHERE document_kind = 'source') documents,
    (SELECT count(*)::int FROM file_reservation WHERE status = 'reserved') reservations,
    (SELECT used_bytes::text FROM file_store_counter WHERE singleton) used`;
  assert(JSON.stringify(afterRejectedSource) === JSON.stringify(beforeSource) &&
    (await readdir(path.join(sourceRoot, "objects"))).length === objectsBeforeSource,
    "fonte recusada deixou catálogo, reserva, quota ou objeto órfão");

  const sourcePayload = Buffer.from(`fixture-consolidada-opaca-${randomUUID()}\n`);
  const acceptedSource = await fetch(sourceEndpoint, { method: "POST", body: sourcePayload,
    headers: { ...sourceHeaders, "X-TRIA-File-Name": "FIXTURE.XLSX", "X-TRIA-File-Size": String(sourcePayload.length) } });
  const receipt = await acceptedSource.json();
  assert(acceptedSource.status === 201 && acceptedSource.headers.get("cache-control")?.includes("no-store") &&
    JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(["format", "receiptId", "receivedAt", "sizeBytes", "status"].sort()) &&
    receipt.format === "XLSX" && receipt.sizeBytes === sourcePayload.length && receipt.status === "protected", "recibo da fonte não foi sanitizado");
  const [storedSource] = await sql`SELECT sf.id::text source_id, sf.source_format, sf.received_by,
      d.id::text document_id, d.document_kind, d.project_id, d.include_in_publication, d.title,
      v.id::text version_id, v.object_key::text object_key, v.original_name, v.media_type, v.size_bytes::text, v.sha256,
      (SELECT count(*)::int FROM source_file_event e WHERE e.source_file_id = sf.id AND e.operation = 'source.file.received.v1') events
    FROM source_file sf JOIN file_document d ON d.id = sf.document_id JOIN file_version v ON v.id = sf.file_version_id
    WHERE sf.id = ${receipt.receiptId}::uuid`;
  const sourceBytes = await readFile(path.join(sourceRoot, "objects", storedSource.object_key));
  assert(storedSource.source_format === "xlsx" && storedSource.received_by === "Rodrigo" && storedSource.document_kind === "source" &&
    storedSource.project_id === null && storedSource.include_in_publication === false && storedSource.title === "Base consolidada de aplicação de recursos" &&
    storedSource.original_name === "FIXTURE.XLSX" && storedSource.media_type === "application/x-unexpected" &&
    Number(storedSource.size_bytes) === sourcePayload.length && sourceBytes.equals(sourcePayload) &&
    createHash("sha256").update(sourceBytes).digest("hex") === storedSource.sha256 && storedSource.events === 1,
    "persistência opaca, hash, evento ou isolamento da fonte divergiram");
  const sourceDownload = await fetch(`${base}/api/files/${storedSource.version_id}/download`, { headers });
  const sourcePublication = await fetch(`${base}/api/files/${storedSource.document_id}/publication`, { method: "POST",
    headers: { ...headers, Origin: "http://app:3000", "Content-Type": "application/json" }, body: JSON.stringify({ include: true }) });
  assert(sourceDownload.status === 404 && sourcePublication.status === 404 &&
    !(await (await fetch(`${base}/projetos/synthetic-p1`, { headers })).text()).includes("FIXTURE.XLSX"),
    "fonte escapou para download, publicação ou projeto");
  const sourceAcl = await sql`SELECT grantee, privilege_type privilege FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('source_file', 'source_file_event') AND grantee <> 'tria_migrator'
    ORDER BY table_name, grantee, privilege_type`;
  assert(sourceAcl.length === 4 && sourceAcl.every((row) => row.grantee === "tria_app" && ["INSERT", "SELECT"].includes(row.privilege)), "ACL mínima da fonte divergiu");
  await mustReject(() => sql`UPDATE source_file SET received_at = received_at WHERE id = ${receipt.receiptId}::uuid`, "source_file não é append-only");
  await mustReject(() => sql`DELETE FROM source_file_event WHERE source_file_id = ${receipt.receiptId}::uuid`, "source_file_event não é append-only");
  await mustReject(() => sql`UPDATE file_document SET updated_at = updated_at WHERE id = ${storedSource.document_id}::uuid`, "documento-pai da fonte é mutável");
  await mustReject(() => sql`UPDATE file_version SET status = status WHERE id = ${storedSource.version_id}::uuid`, "versão-pai da fonte é mutável");
  const sourceBackup = await fetch(`${base}/api/backups/files`, { headers });
  assert(sourceBackup.status === 200 && sourceBackup.headers.get("content-type") === "application/zip" && sourceBackup.body,
    "backup com a fonte consolidada falhou");
  const sourceBundle = `/tmp/tria-source-backup-${randomUUID()}.zip`;
  try {
    await pipeline(Readable.fromWeb(sourceBackup.body), createWriteStream(sourceBundle, { mode: 0o600 }));
    await execute(process.execPath, ["scripts/restore-file-backup.mjs", "--verify-only", sourceBundle], { cwd: process.cwd() });
  } finally { await rm(sourceBundle, { force: true }); }

  const sentinel = path.join(sourceRoot, ".tria-volume"); const sentinelValue = await readFile(sentinel, "utf8");
  await writeFile(sentinel, `${randomUUID()}\n`);
  try {
    const unavailable = await fetch(sourceEndpoint, { method: "POST", body: Buffer.from("x"),
      headers: { ...sourceHeaders, "X-TRIA-File-Name": "fixture.csv", "X-TRIA-File-Size": "1" } });
    assert(unavailable.status === 503, "fonte não falhou fechado com storage indisponível");
  } finally { await writeFile(sentinel, sentinelValue); }
  await health(200);
  await sql`UPDATE file_store_counter SET reserved_bytes = quota_bytes - used_bytes WHERE singleton`;
  try {
    const noQuota = await fetch(sourceEndpoint, { method: "POST", body: Buffer.from("x"),
      headers: { ...sourceHeaders, "X-TRIA-File-Name": "fixture.csv", "X-TRIA-File-Size": "1" } });
    assert(noQuota.status === 413, "fonte não falhou fechado sem quota");
  } finally { await sql`UPDATE file_store_counter SET reserved_bytes = 0 WHERE singleton`; }
  await health(200);
  const contractUrl = `${base}/api/projects/synthetic-p1/contract`;
  const contract = { revision: "0", totalCents: "100000", reference: "Contrato sintético CI", reason: "Cadastro inicial CI",
    receipts: [{ id: randomUUID(), amountCents: "30000", receivedOn: "2026-01-01", reference: "Parcela sintética", voided: false }] };
  const saveContract = (value, origin = base, session = headers) => fetch(contractUrl, { method: "PUT",
    headers: { ...session, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert((await saveContract(contract, base, {})).status === 401, "contrato sem sessão foi aceito");
  assert((await saveContract(contract, "https://untrusted.invalid")).status === 403, "contrato sem mesma origem foi aceito");
  const saved = await saveContract(contract);
  assert(saved.status === 200 && (await saved.json()).revision === "1", "contrato inicial não persistiu");
  assert((await saveContract(contract)).status === 409, "revisão antiga sobrescreveu contrato");
  const voided = { ...contract, revision: "1", reason: "Anulação sintética", receipts: contract.receipts.map(r => ({ ...r, voided: true })) };
  assert((await saveContract(voided)).status === 200, "anulação não persistiu");
  const revisions = await sql`SELECT revision::text, receipts FROM project_contract_revision WHERE project_id='synthetic-p1' ORDER BY revision`;
  assert(revisions.length === 2 && revisions[0].receipts[0].voided === false && revisions[1].receipts[0].voided === true, "histórico contratual foi sobrescrito");
  const [contractAcl] = await sql`SELECT has_table_privilege('tria_app', 'project_contract_revision', 'UPDATE') can_update, has_table_privilege('tria_app', 'project_contract_revision', 'DELETE') can_delete`;
  assert(!contractAcl.can_update && !contractAcl.can_delete, "aplicação pode sobrescrever histórico contratual");
  const projectPage = await fetch(`${base}/projetos/synthetic-p1`, { headers });
  const projectHtml = await projectPage.text();
  assert(projectPage.status === 200 && projectHtml.includes("Saldo contratual a receber") && projectHtml.includes("Contrato sintético CI"), "contrato ausente na UI");
  const report = await fetch(`${base}/api/reports/projects/synthetic-p1`, { headers });
  assert(report.status === 200 && Buffer.from(await report.arrayBuffer()).subarray(0, 5).toString() === "%PDF-", "relatório PDF do projeto falhou");
  await health(200);
  console.log("integração sintética: crash/resume, health, downloads e fonte consolidada validados");
} finally { await sql.end(); }
