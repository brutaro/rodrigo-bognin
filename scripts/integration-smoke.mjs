import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" || !process.env.TRIA_INTEGRATION_NAMESPACE?.startsWith("tria-vault-")) {
  throw new Error("Integração recusada: use um projeto Compose tria-vault-*, banco e volume descartáveis, e confirme TRIA_INTEGRATION_ISOLATED=confirmed.");
}


const execute = promisify(execFile);
async function secret(file) { return (await fs.readFile(file, "utf8")).trim(); }
const host = process.env.PGHOST ?? "db";
const database = process.env.PGDATABASE ?? "tria";
const appPassword = await secret(process.env.DB_APP_PASSWORD_FILE ?? "/run/secrets/db_app_password");
const adminPassword = await secret(process.env.DB_ADMIN_PASSWORD_FILE ?? "/run/secrets/db_admin_password");
const loginCode = await secret(process.env.TRIA_LOGIN_CODE_FILE ?? "/run/secrets/tria_login_code");
const app = postgres({ host, database, username: "tria_app", password: appPassword, max: 1, prepare: false });
const admin = postgres({ host, database, username: "tria_admin", password: adminPassword, max: 1, prepare: false });
function assert(condition, message) { if (!condition) throw new Error(message); }
const base = process.env.APP_BASE_URL ?? "http://app:3000";
const browserOrigin = "http://app:3000";
async function http(pathname, init = {}) {
  return fetch(`${base}${pathname}`, init);
}

async function loginActionId() {
  const response = await http("/entrar");
  const html = await response.text();
  const match = html.match(/name="(\$ACTION_ID_[^"]+)"/);
  assert(response.status === 200 && match, "formulário de login indisponível");
  return match[1];
}
async function submitLogin(actionId, code) {
  const form = new FormData(); form.set(actionId, ""); form.set("codigo", code);
  return http("/entrar", { method: "POST", body: form, headers: { Origin: browserOrigin }, redirect: "manual" });
}

function decodeAttribute(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}
async function publicationForm(projectId) {
  const response = await http(`/projetos/${encodeURIComponent(projectId)}/conferir`, { headers: { Cookie: activeCookie }, redirect: "manual" });
  const html = await response.text(); const form = new FormData();
  for (const tag of html.match(/<input\b[^>]*>/g) ?? []) {
    const name = tag.match(/name="([^"]+)"/)?.[1]; const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    if (name && (name.startsWith("$ACTION_REF_") || /^\$ACTION_\d+:/.test(name) || name === "acknowledgeCaveats"))
      form.set(decodeAttribute(name), decodeAttribute(value));
  }
  assert([...form.keys()].some((name) => name.startsWith("$ACTION_REF_")), "formulário real de publicação ausente");
  return form;
}
async function submitPublication(projectId, form) {
  return http(`/projetos/${encodeURIComponent(projectId)}/conferir`, {
    method: "POST", body: form, headers: { Cookie: activeCookie, Origin: browserOrigin }, redirect: "manual",
  });
}

let activeCookie = "";
const integrationStartedAt = new Date(Date.now() - 1000).toISOString();
try {
  const [{ count }] = await app`SELECT count(*)::int count FROM project`;
  assert(count === 59, "tria_app não leu os 59 projetos");
  let ddlDenied = false;
  try { await app.unsafe("CREATE TABLE forbidden_integration_probe(id integer)"); } catch (error) { ddlDenied = error?.code === "42501"; }
  assert(ddlDenied, "tria_app recebeu DDL indevido");

  const [project] = await app`SELECT id FROM project ORDER BY id LIMIT 1`;
  await app.begin(async (tx) => {
    const requestId = crypto.randomUUID();
    await tx`INSERT INTO manual_financial_entry (id, project_id, kind, amount_cents, description, origin, document_state, created_at, request_id)
      VALUES (${crypto.randomUUID()}, ${project.id}, 'Valor informado', 123, 'Teste transacional', 'Informado por Rodrigo', 'Sem arquivo associado', now(), ${requestId}::uuid)`;
    await tx`INSERT INTO manual_financial_entry (id, project_id, kind, amount_cents, description, origin, document_state, created_at, request_id)
      VALUES (${crypto.randomUUID()}, ${project.id}, 'Valor informado', 123, 'Teste transacional', 'Informado por Rodrigo', 'Sem arquivo associado', now(), ${requestId}::uuid)
      ON CONFLICT (request_id) DO NOTHING`;
    const [{ entries }] = await tx`SELECT count(*)::int entries FROM manual_financial_entry WHERE request_id = ${requestId}::uuid`;
    assert(entries === 1, "request_id não foi idempotente");
    throw Object.assign(new Error("rollback-probe"), { expectedRollback: true });
  }).catch((error) => { if (!error.expectedRollback) throw error; });

  let invalidSnapshotDenied = false;
  try {
    await admin`INSERT INTO publication (id, project_id, version, created_at, created_by, content_hash, record_hash, snapshot)
      VALUES (${crypto.randomUUID()}::uuid, ${project.id}, 2147483647, now(), 'integration', ${"a".repeat(64)}, ${"b".repeat(64)}, '{}'::jsonb)`;
  } catch (error) { invalidSnapshotDenied = error?.code === "23514"; }
  assert(invalidSnapshotDenied, "snapshot JSONB incompleto não foi recusado");

  const health = await http("/api/health");
  assert(health.status === 200, `health HTTP ${health.status}`);
  const anonymousPage = await http("/projetos", { redirect: "manual" });
  const anonymousFile = await http(`/api/files/${crypto.randomUUID()}/download`);
  assert([302, 307, 308].includes(anonymousPage.status), "página privada não redirecionou");
  assert(anonymousFile.status === 401, "arquivo anônimo não retornou 401");

  const actionId = await loginActionId();
  const failedLogin = await submitLogin(actionId, `${loginCode}-incorreto`);
  const failedBody = await failedLogin.text();
  assert([302, 303].includes(failedLogin.status) && !failedBody.includes(loginCode), "falha de login não foi genérica");
  const login = await submitLogin(actionId, loginCode);
  const setCookie = login.headers.get("set-cookie");
  assert([302, 303].includes(login.status) && setCookie?.includes("tria_session=") && setCookie.includes("HttpOnly") && !setCookie.includes("Secure") && /SameSite=Strict/i.test(setCookie), "cookie de sessão inválido");
  const cookie = setCookie.split(";")[0];
  activeCookie = cookie;

  const privatePage = await http("/projetos", { headers: { Cookie: cookie }, redirect: "manual" });
  assert(privatePage.status === 200, `sessão não abriu página privada: ${privatePage.status}`);
  const initialObjects = (await fs.readdir(path.join(process.env.TRIA_FILE_STORE_PATH ?? "/data/files", "objects"))).length;
  const rejectedUpload = await http(`/api/projects/PROJETO-INEXISTENTE/files`, {
    method: "POST", body: Buffer.from("não persistir"),
    headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/octet-stream", "X-TRIA-File-Name": "rejeitado.bin", "X-TRIA-File-Title": "Rejeitado" },
  });
  const rejectedObjects = (await fs.readdir(path.join(process.env.TRIA_FILE_STORE_PATH ?? "/data/files", "objects"))).length;
  assert(rejectedUpload.status === 404 && rejectedObjects === initialObjects, "upload rejeitado deixou objeto órfão");
  await app`UPDATE project_draft SET narrative = 'Narrativa temporária da integração isolada com composição verificável.',
    revision = revision + 1, updated_at = now() WHERE project_id = ${project.id}`;
  const payload = Buffer.from(`arquivo-integracao-${crypto.randomUUID()}
`, "utf8");
  const [draftBeforeFiles] = await app`SELECT revision::text FROM project_draft WHERE project_id = ${project.id}`;
  const [{ used_before }] = await app`SELECT used_bytes::text used_before FROM file_store_counter WHERE singleton`;
  const upload = await http(`/api/projects/${encodeURIComponent(project.id)}/files`, {
    method: "POST", body: payload,
    headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "text/plain", "X-TRIA-File-Name": encodeURIComponent("prova.txt"), "X-TRIA-File-Title": encodeURIComponent("Prova integrada") },
  });
  const uploaded = await upload.json();
  assert(upload.status === 201 && uploaded.version === 1 && /^[0-9a-f]{64}$/.test(uploaded.sha256), `upload falhou: ${upload.status}`);

  const [stored] = await app`SELECT v.id::text id, v.object_key::text object_key, v.sha256, v.size_bytes::text, d.id::text document_id, d.include_in_publication
    FROM file_version v JOIN file_document d ON d.id = v.document_id WHERE v.id = ${uploaded.versionId}`;
  assert(stored && Number(stored.size_bytes) === payload.length && stored.include_in_publication === false, "catálogo/default do upload divergiu");
  const include = await http(`/api/files/${stored.document_id}/publication`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ include: true }),
  });
  assert(include.status === 200, "inclusão explícita em publicação falhou");
  const [included] = await app`SELECT include_in_publication, (SELECT revision::text FROM project_draft WHERE project_id = ${project.id}) revision FROM file_document WHERE id = ${stored.document_id}`;
  assert(included.include_in_publication === true && BigInt(included.revision) === BigInt(draftBeforeFiles.revision) + 2n, "upload/toggle não invalidou a revisão da prévia");

  const storeRoot = process.env.TRIA_FILE_STORE_PATH ?? "/data/files";
  const volumeUuid = await secret("/run/secrets/file_store_uuid");
  const sentinel = path.join(storeRoot, ".tria-volume");
  const orphanKey = crypto.randomUUID();
  await fs.writeFile(path.join(storeRoot, "objects", orphanKey), "órfão");
  const payloadV2 = Buffer.from(`segunda-versao-${crypto.randomUUID()}\n`, "utf8");
  const uploadV2 = await http(`/api/projects/${encodeURIComponent(project.id)}/files`, {
    method: "POST", body: payloadV2,
    headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "text/plain", "X-TRIA-File-Name": encodeURIComponent("prova-v2.txt"),
      "X-TRIA-File-Title": encodeURIComponent("Prova integrada"), "X-TRIA-Document-Id": stored.document_id },
  });
  const uploadedV2 = await uploadV2.json();
  assert(uploadV2.status === 201 && uploadedV2.version === 2, "nova versão falhou");
  let orphanRemoved = false; try { await fs.access(path.join(storeRoot, "objects", orphanKey)); } catch { orphanRemoved = true; }
  assert(orphanRemoved, "reconciliação não removeu objeto órfão");
  const stalePublicationForm = await publicationForm(project.id);
  const payloadV3 = Buffer.from(`terceira-versao-${crypto.randomUUID()}\n`, "utf8");
  const uploadV3 = await http(`/api/projects/${encodeURIComponent(project.id)}/files`, {
    method: "POST", body: payloadV3,
    headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "text/plain", "X-TRIA-File-Name": encodeURIComponent("prova-v3.txt"),
      "X-TRIA-File-Title": encodeURIComponent("Prova integrada"), "X-TRIA-Document-Id": stored.document_id },
  });
  const uploadedV3 = await uploadV3.json();
  assert(uploadV3.status === 201 && uploadedV3.version === 3, "terceira versão concorrente falhou");
  const stalePublish = await submitPublication(project.id, stalePublicationForm);
  assert(stalePublish.status === 303 && (stalePublish.headers.get("location") ?? "").includes("publication-stale-review") &&
    (await app`SELECT id FROM publication WHERE project_id = ${project.id}`).length === 0,
    "publicação aceitou prévia obsoleta após nova versão");
  const firstPublish = await submitPublication(project.id, await publicationForm(project.id));
  const firstLocation = firstPublish.headers.get("location") ?? "";
  const firstPublicationId = firstLocation.match(/\/publicacoes\/([0-9a-f-]{36})/)?.[1];
  assert(firstPublish.status === 303 && firstPublicationId, "publicação v3 real falhou");
  const [firstPublished] = await admin`SELECT version, prior_publication_id::text, snapshot,
      (SELECT count(*)::int FROM publication_file WHERE publication_id = p.id) links
    FROM publication p WHERE id = ${firstPublicationId}`;
  assert(firstPublished.version === 1 && firstPublished.links === 1 && firstPublished.snapshot.schemaVersion === "tria-publication-v3" &&
    firstPublished.snapshot.rendererVersion === "tria-export-v3" && firstPublished.snapshot.files?.length === 1 &&
    firstPublished.snapshot.files[0].versionId === uploadedV3.versionId && firstPublished.snapshot.files[0].sha256 === uploadedV3.sha256,
    "snapshot v3 não fixou a última versão selecionada");
  const [storedLatest] = await app`SELECT id::text id, object_key::text object_key FROM file_version WHERE id = ${uploadedV3.versionId}`;
  const replacement = "/tmp/tria-replacement-volume";
  await fs.rm(replacement, { recursive: true, force: true });
  let replacementDenied = false;
  try {
    await execute("node", ["scripts/init-file-store.mjs"], { env: { ...process.env,
      PGPASSWORD_FILE: process.env.DB_APP_PASSWORD_FILE, TRIA_FILE_STORE_PATH: replacement,
      TRIA_FILE_STORE_UUID_FILE: "/run/secrets/file_store_uuid" } });
  } catch { replacementDenied = true; }
  assert(replacementDenied, "volume vazio substituto foi aceito com catálogo não vazio");
  const download = await http(`/api/files/${stored.id}/download`, { headers: { Cookie: cookie } });
  assert(download.status === 200 && Buffer.compare(Buffer.from(await download.arrayBuffer()), payload) === 0, "download íntegro falhou");
  assert(download.headers.get("cache-control")?.includes("no-store") && download.headers.get("content-disposition")?.startsWith("attachment"), "headers seguros do download ausentes");

  const backup = await http("/api/backups/files", { headers: { Cookie: cookie } });
  assert(backup.status === 200 && backup.headers.get("content-type") === "application/zip", "backup manual falhou");
  const bundle = "/tmp/tria-integration-backup.zip";
  await fs.writeFile(bundle, Buffer.from(await backup.arrayBuffer()), { mode: 0o600 });
  await execute("node", ["scripts/restore-file-backup.mjs", "--verify-only", bundle]);
  const restoreTarget = "/tmp/tria-integration-restore";
  await fs.rm(restoreTarget, { recursive: true, force: true });
  await execute("node", ["scripts/restore-file-backup.mjs", "--target", restoreTarget, bundle]);
  assert(Buffer.compare(await fs.readFile(path.join(restoreTarget, "objects", stored.object_key)), payload) === 0, "restore não preservou bytes");

  const objectPath = path.join(storeRoot, "objects", stored.object_key);
  await fs.writeFile(objectPath, Buffer.from("adulterado"));
  const corruptDownload = await http(`/api/files/${stored.id}/download`, { headers: { Cookie: cookie } });
  let corruptBackupCancelled = false;
  try {
    const corruptBackup = await http("/api/backups/files", { headers: { Cookie: cookie } });
    corruptBackupCancelled = corruptBackup.status === 503;
    if (corruptBackup.status === 200) {
      try { await corruptBackup.arrayBuffer(); } catch { corruptBackupCancelled = true; }
    }
  } catch { corruptBackupCancelled = true; }
  assert(corruptDownload.status === 409 && (await corruptDownload.arrayBuffer()).byteLength < payload.length + 200, "download corrompido enviou conteúdo");
  assert(corruptBackupCancelled, "backup adulterado não foi cancelado durante o stream");
  await fs.writeFile(objectPath, payload);

  await fs.writeFile(sentinel, `${crypto.randomUUID()}\n`);
  const invalidVolumeDownload = await http(`/api/files/${stored.id}/download`, { headers: { Cookie: cookie } });
  const invalidVolumePurge = await http(`/api/files/${stored.document_id}/purge`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: loginCode, confirmacao: "EXCLUIR" }),
  });
  const [stillActive] = await app`SELECT status FROM file_document WHERE id = ${stored.document_id}`;
  assert([409, 503].includes(invalidVolumeDownload.status) && invalidVolumePurge.status === 503 && stillActive.status === "active",
    "volume inválido permitiu leitura ou transição destrutiva");
  await fs.writeFile(sentinel, `${volumeUuid}\n`);

  await admin`DELETE FROM publication_file WHERE publication_id = ${firstPublicationId}`;
  const exclude = await http(`/api/files/${stored.document_id}/publication`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ include: false }),
  });
  assert(exclude.status === 200, "exclusão seletiva da publicação falhou");
  await app`UPDATE project_draft SET narrative = narrative || ' Segunda publicação sem o arquivo.', revision = revision + 1,
    updated_at = now() WHERE project_id = ${project.id}`;
  const secondPublish = await submitPublication(project.id, await publicationForm(project.id));
  const secondLocation = secondPublish.headers.get("location") ?? "";
  const secondPublicationId = secondLocation.match(/\/publicacoes\/([0-9a-f-]{36})/)?.[1];
  assert(secondPublish.status === 303 && secondPublicationId, "segunda publicação real falhou");
  const [secondPublished] = await admin`SELECT version, prior_publication_id::text, snapshot FROM publication WHERE id = ${secondPublicationId}`;
  assert(secondPublished.version === 2 && secondPublished.prior_publication_id === firstPublicationId &&
    secondPublished.snapshot.schemaVersion === "tria-publication-v3" && secondPublished.snapshot.files?.length === 0,
    "segunda publicação não preservou cadeia v3 sem arquivo");
  const deniedPurge = await http(`/api/files/${stored.document_id}/purge`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: `${loginCode}-incorreto`, confirmacao: "EXCLUIR" }),
  });
  assert(deniedPurge.status === 403, "expurgo aceitou código incorreto");
  const latestObjectPath = path.join(storeRoot, "objects", storedLatest.object_key);
  await fs.rm(latestObjectPath, { force: true }); await fs.mkdir(latestObjectPath);
  const pendingPurge = await http(`/api/files/${stored.document_id}/purge`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: loginCode, confirmacao: "EXCLUIR" }),
  });
  const [pendingState] = await app`SELECT status FROM file_document WHERE id = ${stored.document_id}`;
  assert(pendingPurge.status === 503 && pendingState.status === "purging", "falha física não deixou expurgo retomável");
  await fs.rm(latestObjectPath, { recursive: true, force: true }); await fs.writeFile(latestObjectPath, payloadV3, { mode: 0o600 });
  const purge = await http(`/api/files/${stored.document_id}/purge`, {
    method: "POST", headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: loginCode, confirmacao: "EXCLUIR" }),
  });
  assert(purge.status === 200, `expurgo retomado falhou: ${purge.status}`);
  const [remaining] = await app`SELECT
    (SELECT count(*)::int FROM file_document WHERE id = ${stored.document_id}) documents,
    (SELECT count(*)::int FROM file_version WHERE document_id = ${stored.document_id}) versions,
    (SELECT count(*)::int FROM publication_file pf JOIN publication p ON p.id = pf.publication_id WHERE p.project_id = ${project.id}) links,
    (SELECT count(*)::int FROM publication WHERE project_id = ${project.id}) publications,
    (SELECT used_bytes::text FROM file_store_counter WHERE singleton) used_after`;
  assert(remaining.documents === 0 && remaining.versions === 0 && remaining.links === 0 && remaining.publications === 0 && remaining.used_after === used_before,
    "expurgo reteve bytes, catálogo, vínculo, publicação ou quota");

  await fs.writeFile(sentinel, `${crypto.randomUUID()}\n`);
  assert((await http("/api/health")).status === 503, "sentinel trocado não derrubou readiness");
  await fs.writeFile(sentinel, `${volumeUuid}\n`);
  assert((await http("/api/health")).status === 200, "readiness não recuperou após sentinel correto");

  await admin`UPDATE file_store_counter SET reserved_bytes = quota_bytes - used_bytes WHERE singleton`;
  const quotaUpload = await http(`/api/projects/${encodeURIComponent(project.id)}/files`, {
    method: "POST", body: Buffer.from("x"), headers: { Cookie: cookie, Origin: browserOrigin, "Content-Type": "application/octet-stream",
      "X-TRIA-File-Name": "quota.bin", "X-TRIA-File-Title": "Quota" },
  });
  assert(quotaUpload.status === 413 && (await http("/api/health")).status === 503, "quota cheia não foi fail-closed");
  await admin`UPDATE file_store_counter SET reserved_bytes = 0 WHERE singleton`;
  assert((await http("/api/health")).status === 200, "readiness não recuperou após liberar quota");

  await admin`DELETE FROM auth_login_throttle`;
  for (let attempt = 0; attempt < 5; attempt += 1) await submitLogin(actionId, `${loginCode}-bloqueio`);
  const blockedLogin = await submitLogin(actionId, loginCode);
  assert([302, 303].includes(blockedLogin.status) && !blockedLogin.headers.get("set-cookie"), "throttle não bloqueou após cinco falhas");
  await admin`DELETE FROM auth_login_throttle`;

  const logoutPage = await http("/projetos", { headers: { Cookie: cookie } });
  const logoutAction = (await logoutPage.text()).match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  assert(logoutAction, "ação de logout ausente");
  const logoutForm = new FormData(); logoutForm.set(logoutAction, "");
  const logout = await http("/projetos", { method: "POST", body: logoutForm, headers: { Cookie: cookie, Origin: browserOrigin }, redirect: "manual" });
  const replay = await http("/projetos", { headers: { Cookie: cookie }, redirect: "manual" });
  assert(logout.status === 303 && [302, 307, 308].includes(replay.status), "logout não revogou o bearer no servidor");

  const events = await admin`SELECT DISTINCT operation FROM file_operation_event WHERE occurred_at >= ${integrationStartedAt}::timestamptz`;
  const eventNames = new Set(events.map((event) => event.operation));
  for (const expected of ["upload_version", "publication_include", "download", "backup_prepared", "purge"])
    assert(eventNames.has(expected), `trilha de arquivo ausente: ${expected}`);

  console.log(JSON.stringify({ status: "ok", projects: count, auth: true, throttle: true, upload: true, versions: true,
    explicit_publication_inclusion: true, orphan_reconciliation: true, download_integrity: true, backup_restore: true,
    replacement_volume_denied: true, invalid_volume_readiness: true, quota_fail_closed: true,
    corruption_blocked: true, purge_retry: true, purge: true, health: 200 }));
} finally {
  await Promise.all([app.end(), admin.end()]);
}
