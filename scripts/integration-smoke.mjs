import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" ||
    !["tria-vault-", "tria-adjustments-"].some((prefix) => process.env.TRIA_INTEGRATION_NAMESPACE?.startsWith(prefix))) {
  throw new Error("Integração recusada: use um projeto Compose tria-vault-* ou tria-adjustments-*, banco e volume descartáveis, e confirme TRIA_INTEGRATION_ISOLATED=confirmed.");
}


const execute = promisify(execFile);
async function secret(file) { return (await fs.readFile(file, "utf8")).trim(); }
const host = process.env.PGHOST ?? "db";
const database = process.env.PGDATABASE ?? "tria";
const appPassword = await secret(process.env.DB_APP_PASSWORD_FILE ?? "/run/secrets/db_app_password");
const adminPassword = await secret(process.env.DB_ADMIN_PASSWORD_FILE ?? "/run/secrets/db_admin_password");
const loginCode = await secret(process.env.TRIA_LOGIN_CODE_FILE ?? "/run/secrets/tria_login_code");
const app = postgres({ host, database, username: "tria_app", password: appPassword, max: 2, prepare: false });
const admin = postgres({ host, database, username: "tria_admin", password: adminPassword, max: 1, prepare: false });
function assert(condition, message) { if (!condition) throw new Error(message); }
function brl(value) {
  if (value === null) return "Não informado"; const negative = value.startsWith("-"); const [wholeRaw, fractionRaw = ""] = (negative ? value.slice(1) : value).split(".");
  let cents = BigInt(wholeRaw) * 100n + BigInt(fractionRaw.padEnd(2, "0").slice(0, 2));
  if (Number(fractionRaw.padEnd(3, "0")[2]) >= 5) cents += 1n; const whole = cents / 100n; const fraction = cents % 100n;
  return `${negative ? "-" : ""}R$ ${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.toString().padStart(2, "0")}`;
}
function centsBrl(value) { if (value === null) return "Não informado"; const cents = BigInt(value); return `R$ ${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(cents % 100n).toString().padStart(2, "0")}`; }
function duration(seconds) { const total = BigInt(seconds); const base = `${(total / 3600n).toString().padStart(2, "0")}:${(total % 3600n / 60n).toString().padStart(2, "0")}`; return total % 60n ? `${base}:${(total % 60n).toString().padStart(2, "0")}` : base; }
const base = process.env.APP_BASE_URL ?? "http://app:3000";
const browserOrigin = "http://app:3000";
async function http(pathname, init = {}) {
  return fetch(`${base}${pathname}`, init);
}
async function extractPdfText(bytes) {
  const document = await getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/` }).promise;
  const text = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    text.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return { pages: document.numPages, text: text.join(" ") };
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
async function fiscalActionForm(noteId) {
  const response = await http("/notas-fiscais", { headers: { Cookie: activeCookie } }); const html = await response.text();
  const formHtml = (html.match(/<form\b[\s\S]*?<\/form>/g) ?? []).find((form) =>
    form.includes(`name="fiscalNoteId" value="${noteId}"`));
  assert(response.status === 200 && formHtml, "formulário fiscal real ausente");
  const form = new FormData();
  for (const tag of formHtml.match(/<input\b[^>]*>/g) ?? []) {
    const name = tag.match(/name="([^"]+)"/)?.[1]; const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    if (name && (name.startsWith("$ACTION_REF_") || /^\$ACTION_\d+:/.test(name))) form.set(decodeAttribute(name), decodeAttribute(value));
  }
  assert([...form.keys()].some((name) => name.startsWith("$ACTION_REF_")), "referência da action fiscal ausente");
  return form;
}
async function submitFiscalAction(form) {
  return http("/notas-fiscais", { method: "POST", body: form, headers: { Cookie: activeCookie, Origin: browserOrigin }, redirect: "manual" });
}

let activeCookie = "";
const integrationStartedAt = new Date(Date.now() - 1000).toISOString();
try {
  const namespace = process.env.TRIA_INTEGRATION_NAMESPACE;
  assert(namespace === process.env.TRIA_INSTANCE_NAMESPACE, "namespace de integração diverge do marcador esperado");
  const [databaseMarker] = await admin`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
  const volumeMarker = (await fs.readFile(path.join(process.env.TRIA_FILE_STORE_PATH ?? "/data/files", ".tria-instance-namespace"), "utf8")).trim();
  assert(databaseMarker?.namespace === namespace && volumeMarker === namespace,
    "integração recusada: marcadores independentes do banco e do volume não coincidem");
  const [{ count }] = await app`SELECT count(*)::int count FROM project`;
  assert(count === 59, "tria_app não leu os 59 projetos");
  let ddlDenied = false;
  try { await app.unsafe("CREATE TABLE forbidden_integration_probe(id integer)"); } catch (error) { ddlDenied = error?.code === "42501"; }
  assert(ddlDenied, "tria_app recebeu DDL indevido");

  const [project] = await app`SELECT p.id FROM project p WHERE EXISTS (SELECT 1 FROM bm_activity a WHERE a.project_id = p.id)
    AND EXISTS (SELECT 1 FROM effective_fiscal_note n WHERE n.source_declared_project_id = p.id AND n.source_amount > 1) ORDER BY p.id LIMIT 1`;
  await admin`DELETE FROM project_draft WHERE project_id = ${project.id}`;
  const [sourceActivity] = await app`SELECT a.id, a.duration_seconds::text source_duration, a.measured_value::text source_value,
    e.adjustment_revision::text revision FROM bm_activity a JOIN effective_bm_activity e ON e.id = a.id
    WHERE a.project_id = ${project.id} ORDER BY a.id LIMIT 1`;
  const startingActivityRevision = BigInt(sourceActivity.revision);
  const activityRequest = crypto.randomUUID();
  const initialActivityRetries = await Promise.allSettled([1, 2].map(() => app`SELECT * FROM apply_owner_activity_adjustment(
    ${sourceActivity.id}, ${sourceActivity.revision}, ${activityRequest}::uuid,
    'Teste isolado de segundos e alta precisão', 108959, -12.1234567890123456)`));
  assert(initialActivityRetries.every((item) => item.status === "fulfilled"), "duas chamadas diretas de atividade não foram idempotentes");
  const [{ activityRevisions }] = await app`SELECT count(*)::int "activityRevisions" FROM owner_activity_adjustment_history WHERE id = ${activityRequest}::uuid`;
  assert(activityRevisions === 1, "retry de atividade não foi idempotente");
  const [createdDraft] = await app`SELECT revision::text FROM project_draft WHERE project_id = ${project.id}`;
  assert(createdDraft?.revision === "1", "invalidação não criou project_draft ausente");
  let activityNoOpDenied = false;
  try { await app`SELECT * FROM apply_owner_activity_adjustment(${sourceActivity.id}, ${(startingActivityRevision + 1n).toString()},
    ${crypto.randomUUID()}::uuid, 'No-op de atividade deve falhar', 108959, -12.1234567890123456)`; }
  catch (error) { activityNoOpDenied = error?.code === "22023"; }
  assert(activityNoOpDenied, "ajuste de atividade sem alteração foi aceito");
  const competing = await Promise.allSettled([1, 2].map((index) => app`SELECT * FROM apply_owner_activity_adjustment(
    ${sourceActivity.id}, ${(startingActivityRevision + 1n).toString()}, ${crypto.randomUUID()}::uuid, ${`Concorrência isolada ${index}`}, ${108900 + index * 60}, ${-12.50 - index})`));
  assert(competing.filter((item) => item.status === "fulfilled").length === 1 &&
    competing.filter((item) => item.status === "rejected" && ["40001", "23505"].includes(item.reason?.code)).length === 1,
    "concorrência de atividade não produziu um vencedor e um conflito");
  const restoreRequest = crypto.randomUUID();
  await app`SELECT * FROM restore_owner_activity(${sourceActivity.id}, ${(startingActivityRevision + 2n).toString()}, ${restoreRequest}::uuid, 'Restaurar auditoria importada')`;
  await app`SELECT * FROM restore_owner_activity(${sourceActivity.id}, ${(startingActivityRevision + 2n).toString()}, ${restoreRequest}::uuid, 'Restaurar auditoria importada')`;
  const [restoredActivity] = await app`SELECT a.duration_seconds::text source_duration, a.measured_value::text source_value,
    e.effective_duration_seconds::text effective_duration, e.effective_measured_value::text effective_value,
    e.adjustment_revision::text revision FROM bm_activity a JOIN effective_bm_activity e ON e.id = a.id WHERE a.id = ${sourceActivity.id}`;
  assert(restoredActivity.revision === (startingActivityRevision + 3n).toString() && restoredActivity.source_duration === sourceActivity.source_duration &&
    restoredActivity.source_value === sourceActivity.source_value && restoredActivity.effective_duration === sourceActivity.source_duration &&
    restoredActivity.effective_value === sourceActivity.source_value, "restauração não preservou fonte/efetivo");
  let redundantRestoreDenied = false;
  try { await app`SELECT * FROM restore_owner_activity(${sourceActivity.id}, ${(startingActivityRevision + 3n).toString()},
    ${crypto.randomUUID()}::uuid, 'Restauração redundante deve falhar')`; } catch (error) { redundantRestoreDenied = error?.code === "22023"; }
  assert(redundantRestoreDenied, "restauração redundante de atividade foi aceita");
  const identicalRequest = crypto.randomUUID();
  const identical = await Promise.allSettled([1, 2].map(() => app`SELECT * FROM apply_owner_activity_adjustment(
    ${sourceActivity.id}, ${(startingActivityRevision + 3n).toString()}, ${identicalRequest}::uuid,
    'Entrega simultânea idempotente', 3600, 1.25)`));
  assert(identical.every((item) => item.status === "fulfilled"), "entrega simultânea idêntica não foi idempotente");
  const [{ identicalRows }] = await app`SELECT count(*)::int "identicalRows" FROM owner_activity_adjustment_history WHERE id = ${identicalRequest}::uuid`;
  assert(identicalRows === 1, "entrega simultânea idêntica criou mais de uma revisão");
  await app`SELECT * FROM restore_owner_activity(${sourceActivity.id}, ${(startingActivityRevision + 4n).toString()},
    ${crypto.randomUUID()}::uuid, 'Restaurar após retry simultâneo')`;

  const [sourceFiscal] = await app`SELECT id, source_issue_year issue_year, source_note_number note_number,
    source_issue_date::text issue_date, source_amount::text amount, source_declared_project_id declared_project_id,
    adjustment_revision::text revision FROM effective_fiscal_note WHERE source_amount > 1 AND source_declared_project_id = ${project.id} ORDER BY id LIMIT 1`;
  const startingFiscalRevision = BigInt(sourceFiscal.revision);
  const fiscalRequest = activityRequest;
  const fiscalIdentical = await Promise.allSettled([1, 2].map(() => app`SELECT * FROM apply_owner_fiscal_note_adjustment(
    ${sourceFiscal.id}, ${startingFiscalRevision.toString()}, ${fiscalRequest}::uuid,
    'Teste fiscal atômico', ${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number}, ${sourceFiscal.issue_date}::date,
    ${sourceFiscal.amount}::numeric, 'Categoria ajustada', ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, true)`));
  assert(fiscalIdentical.every((item) => item.status === "fulfilled"), "entrega fiscal simultânea idêntica não foi idempotente");
  const [{ fiscalIdenticalRows }] = await app`SELECT count(*)::int "fiscalIdenticalRows" FROM owner_fiscal_note_adjustment_history WHERE id = ${fiscalRequest}::uuid`;
  assert(fiscalIdenticalRows === 1, "entrega fiscal simultânea criou mais de uma revisão");
  let fiscalRequestReuseDenied = false;
  try { await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${startingFiscalRevision.toString()}, ${fiscalRequest}::uuid,
    'Teste fiscal atômico', ${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number}, ${sourceFiscal.issue_date}::date,
    ${sourceFiscal.amount}::numeric, 'Categoria ajustada', ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, false)`; }
  catch (error) { fiscalRequestReuseDenied = error?.code === "22023"; }
  assert(fiscalRequestReuseDenied, "request_id fiscal aceitou payload de confirmação diferente");
  const [historyIdentity] = await admin`SELECT
    EXISTS (SELECT 1 FROM history_event WHERE id = md5(${activityRequest} || ':activity:' || ${sourceActivity.id} || ':' || ${project.id})::uuid) activity_event,
    EXISTS (SELECT 1 FROM history_event WHERE id = md5(${activityRequest} || ':fiscal_note:' || ${sourceFiscal.id} || ':' || ${project.id})::uuid) fiscal_event`;
  assert(historyIdentity.activity_event && historyIdentity.fiscal_event, "IDs de history_event colidiram entre tipos de entidade");
  let fiscalNoOpDenied = false;
  try { await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${(startingFiscalRevision + 1n).toString()}, ${crypto.randomUUID()}::uuid,
    'No-op fiscal deve falhar', ${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number}, ${sourceFiscal.issue_date}::date,
    ${sourceFiscal.amount}::numeric, 'Categoria ajustada', ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, false)`; } catch (error) { fiscalNoOpDenied = error?.code === "22023"; }
  let nanDenied = false;
  try { await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${(startingFiscalRevision + 1n).toString()}, ${crypto.randomUUID()}::uuid,
    'NaN fiscal deve falhar', ${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number}, ${sourceFiscal.issue_date}::date,
    'NaN'::numeric, 'Categoria inválida', ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, false)`; } catch (error) { nanDenied = error?.code === "22023" || error?.code === "23514"; }
  assert(fiscalNoOpDenied && nanDenied, "domínio fiscal aceitou no-op ou NaN");
  let invalidRelationDenied = false;
  try { await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${(startingFiscalRevision + 1n).toString()}, ${crypto.randomUUID()}::uuid,
    'Relação inválida isolada', ${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number}, ${sourceFiscal.issue_date}::date,
    ${sourceFiscal.amount}::numeric, 'Não deve gravar', ${sourceFiscal.declared_project_id}, 'PROJETO-INEXISTENTE',
    'Forte', 'Confirmada', NULL, false, ${sourceFiscal.amount}::numeric, true)`; }
  catch (error) { invalidRelationDenied = ["22023", "23503"].includes(error?.code); }
  const [fiscalAfterInvalid] = await app`SELECT adjustment_revision::text revision FROM effective_fiscal_note WHERE id = ${sourceFiscal.id}`;
  assert(invalidRelationDenied && fiscalAfterInvalid.revision === (startingFiscalRevision + 1n).toString(), "relação fiscal inválida não foi atômica");
  const fiscalRestore = crypto.randomUUID();
  await app`SELECT * FROM restore_owner_fiscal_note(${sourceFiscal.id}, ${(startingFiscalRevision + 1n).toString()}, ${fiscalRestore}::uuid, 'Restaurar fonte fiscal', true)`;
  await app`SELECT * FROM restore_owner_fiscal_note(${sourceFiscal.id}, ${(startingFiscalRevision + 1n).toString()}, ${fiscalRestore}::uuid, 'Restaurar fonte fiscal', true)`;
  const [duplicateTarget] = await app`SELECT id, issue_year, note_number, issue_date::text issue_date, amount::text amount
    FROM effective_fiscal_note WHERE id <> ${sourceFiscal.id} AND (issue_year, note_number) <> (${sourceFiscal.issue_year}::smallint, ${sourceFiscal.note_number})
    ORDER BY id LIMIT 1`;
  const duplicateRequest = crypto.randomUUID(); let duplicateDenied = false;
  try { await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${(startingFiscalRevision + 2n).toString()},
    ${duplicateRequest}::uuid, 'Confirmar duplicidade fiscal', ${duplicateTarget.issue_year}::smallint, ${duplicateTarget.note_number},
    ${duplicateTarget.issue_date}::date, ${duplicateTarget.amount}::numeric, NULL, ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, false)`; }
  catch (error) { duplicateDenied = error?.code === "23505"; }
  assert(duplicateDenied, "duplicidade fiscal não exigiu confirmação");
  await app`SELECT * FROM apply_owner_fiscal_note_adjustment(${sourceFiscal.id}, ${(startingFiscalRevision + 2n).toString()},
    ${duplicateRequest}::uuid, 'Confirmar duplicidade fiscal', ${duplicateTarget.issue_year}::smallint, ${duplicateTarget.note_number},
    ${duplicateTarget.issue_date}::date, ${duplicateTarget.amount}::numeric, NULL, ${sourceFiscal.declared_project_id}, NULL,
    'Sem relação verificável', 'Não informado', NULL, NULL, NULL::numeric, true)`;
  const [duplicateAudit] = await app`SELECT detected_duplicate_fiscal_note_ids ids, duplicate_confirmation_requested requested, duplicate_confirmed confirmed
    FROM owner_fiscal_note_adjustment_history WHERE id = ${duplicateRequest}::uuid`;
  assert(duplicateAudit.requested && duplicateAudit.confirmed && duplicateAudit.ids.includes(duplicateTarget.id), "IDs da duplicidade não foram preservados para auditoria");
  await app`SELECT * FROM restore_owner_fiscal_note(${sourceFiscal.id}, ${(startingFiscalRevision + 3n).toString()},
    ${crypto.randomUUID()}::uuid, 'Restaurar após teste de duplicidade', true)`;
  await app`SELECT * FROM apply_owner_activity_adjustment(${sourceActivity.id}, ${(startingActivityRevision + 5n).toString()},
    ${crypto.randomUUID()}::uuid, 'Valor efetivo para relatório e publicação V4', 111660, -123.45)`;

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
  const anonymousReport = await http(`/api/reports/projects/${encodeURIComponent(project.id)}`);
  assert([302, 307, 308].includes(anonymousPage.status), "página privada não redirecionou");
  assert(anonymousFile.status === 401, "arquivo anônimo não retornou 401");
  assert(anonymousReport.status === 401, "relatório anônimo não retornou 401");

  const actionId = await loginActionId();
  const failedLogin = await submitLogin(actionId, `${loginCode}-incorreto`);
  const failedBody = await failedLogin.text();
  assert([302, 303].includes(failedLogin.status) && !failedBody.includes(loginCode), "falha de login não foi genérica");
  const login = await submitLogin(actionId, loginCode);
  const setCookie = login.headers.get("set-cookie");
  assert([302, 303].includes(login.status) && setCookie?.includes("tria_session=") && setCookie.includes("HttpOnly") && !setCookie.includes("Secure") && /SameSite=Strict/i.test(setCookie), "cookie de sessão inválido");
  const cookie = setCookie.split(";")[0];
  activeCookie = cookie;

  const [otherProject] = await app`SELECT id FROM project WHERE id <> ${project.id} ORDER BY id LIMIT 1`;
  const [fiscalBeforeAction] = await app`SELECT adjustment_revision::text revision FROM effective_fiscal_note WHERE id = ${sourceFiscal.id}`;
  const fiscalForm = await fiscalActionForm(sourceFiscal.id);
  fiscalForm.set("fiscalNoteId", sourceFiscal.id); fiscalForm.set("expectedRevision", fiscalBeforeAction.revision);
  fiscalForm.set("requestId", crypto.randomUUID()); fiscalForm.set("reason", "Ajuste via FormData com projetos distintos");
  fiscalForm.set("issueYear", String(sourceFiscal.issue_year)); fiscalForm.set("number", sourceFiscal.note_number);
  fiscalForm.set("issueDate", sourceFiscal.issue_date); fiscalForm.set("amount", sourceFiscal.amount.replace(".", ","));
  fiscalForm.set("category", "Categoria via action"); fiscalForm.set("declaredProjectId", project.id);
  fiscalForm.set("candidateProjectId", otherProject.id); fiscalForm.set("strength", "Forte"); fiscalForm.set("relationState", "Confirmada");
  fiscalForm.set("criterion", "Projeto candidato auditado na integração"); fiscalForm.set("fullValueEligible", "no");
  fiscalForm.set("verifiedRelatedValue", "1,00");
  const fiscalActionResponse = await submitFiscalAction(fiscalForm);
  assert(fiscalActionResponse.status < 500, "action fiscal via FormData falhou");
  const [fiscalAfterAction] = await app`SELECT adjustment_revision::text revision, declared_project_id, candidate_project_id,
    category, verified_related_value::text related FROM effective_fiscal_note WHERE id = ${sourceFiscal.id}`;
  assert(BigInt(fiscalAfterAction.revision) === BigInt(fiscalBeforeAction.revision) + 1n && fiscalAfterAction.declared_project_id === project.id &&
    fiscalAfterAction.candidate_project_id === otherProject.id && fiscalAfterAction.category === "Categoria via action" && fiscalAfterAction.related === "1.00",
    "FormData/action fiscal não preservou declarado e candidato distintos");
  await app`INSERT INTO manual_financial_entry (id, project_id, kind, amount_cents, description, origin, document_state, created_at, request_id)
    VALUES (${crypto.randomUUID()}, ${project.id}, 'Pagamento', 98765, 'Pagamento canário do relatório global',
      'Informado por Rodrigo', 'Sem arquivo associado', now(), ${crypto.randomUUID()}::uuid)`;
  const [globalCanary] = await app`SELECT
    (SELECT sum(effective_measured_value)::text FROM effective_bm_activity) measurement,
    (SELECT sum(amount)::text FROM effective_fiscal_note) invoiced,
    (SELECT sum(verified_related_value)::text FROM effective_fiscal_note) related,
    (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Pagamento') payments,
    to_char(date_trunc('month', a.activity_date), 'YYYY-MM') month_label,
    (SELECT coalesce(sum(effective_duration_seconds), 0)::text FROM effective_bm_activity m
      WHERE date_trunc('month', m.activity_date) = date_trunc('month', a.activity_date)) month_seconds
    FROM effective_bm_activity a WHERE a.id = ${sourceActivity.id}`;
  const expectedGlobalValues = [brl(globalCanary.measurement), brl(globalCanary.invoiced), brl(globalCanary.related), centsBrl(globalCanary.payments)];
  assert(new Set(expectedGlobalValues).size === expectedGlobalValues.length, "canários globais não são distintos");

  const privatePage = await http("/projetos", { headers: { Cookie: cookie }, redirect: "manual" });
  assert(privatePage.status === 200, `sessão não abriu página privada: ${privatePage.status}`);
  for (const reportPath of [`/api/reports/projects/${encodeURIComponent(project.id)}`, "/api/reports/global"]) {
    const response = await http(reportPath, { headers: { Cookie: cookie } });
    const bytes = Buffer.from(await response.arrayBuffer());
    const expectedHash = response.headers.get("x-tria-report-sha256");
    const actualHash = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const semantic = await extractPdfText(bytes);
    assert(response.status === 200 && bytes.subarray(0, 4).toString() === "%PDF" && expectedHash === actualHash &&
      response.headers.get("cache-control")?.includes("no-store") && semantic.text.includes("Tabela equivalente ao gráfico"),
      `relatório privado inválido: ${reportPath}`);
    if (reportPath.includes("/projects/")) {
      const normalizedText = semantic.text.replace(/\s+/g, " ");
      assert(normalizedText.includes("31:01") && normalizedText.includes("123,45") && normalizedText.includes("Histórico de ajustes"),
        "PDF de projeto não refletiu ajuste PostgreSQL efetivo e histórico");
    } else {
      const normalizedText = semantic.text.replace(/\s+/g, " ");
      assert(expectedGlobalValues.every((value) => normalizedText.includes(value)) && normalizedText.includes(globalCanary.month_label) &&
        normalizedText.includes(duration(globalCanary.month_seconds)) && normalizedText.includes("Universos financeiros separados"),
        "PDF global não preservou universos distintos ou tendência efetiva");
    }
  }
  const missingReport = await http(`/api/reports/projects/PROJETO-INEXISTENTE`, { headers: { Cookie: cookie } });
  assert(missingReport.status === 404, "relatório de projeto ausente não retornou 404");
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
  const snapshotActivity = firstPublished.snapshot.activities.find((item) => item.id === sourceActivity.id);
  const snapshotFiscal = firstPublished.snapshot.financialEntries.find((item) => item.id === sourceFiscal.id);
  assert(firstPublished.version === 1 && firstPublished.links === 1 && firstPublished.snapshot.schemaVersion === "tria-publication-v4" &&
    firstPublished.snapshot.rendererVersion === "tria-export-v4" && firstPublished.snapshot.files?.length === 1 &&
    firstPublished.snapshot.files[0].versionId === uploadedV3.versionId && firstPublished.snapshot.files[0].sha256 === uploadedV3.sha256,
    "snapshot V4 não fixou a última versão selecionada");
  assert(snapshotActivity?.durationSeconds === "111660" && snapshotActivity?.sourceDurationSeconds === sourceActivity.source_duration &&
    snapshotActivity?.measuredValueDecimal === "-123.4500000000000000" && snapshotActivity?.sourceMeasuredValueDecimal === sourceActivity.source_value &&
    snapshotActivity?.adjustmentRevision === (startingActivityRevision + 6n).toString() &&
    snapshotActivity?.adjustmentReason === "Valor efetivo para relatório e publicação V4" && snapshotActivity?.adjustedBy === "Rodrigo",
    "snapshot V4 não preservou atividade efetiva/original e proveniência crua");
  assert(snapshotFiscal?.provenance?.sourceAmount && snapshotFiscal?.amount && snapshotFiscal.provenance.revision === fiscalAfterAction.revision &&
    snapshotFiscal.provenance.reason === "Ajuste via FormData com projetos distintos" && snapshotFiscal.provenance.actor === "Rodrigo",
    "snapshot V4 não preservou NFS-e original/efetiva e proveniência");
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
    secondPublished.snapshot.schemaVersion === "tria-publication-v4" && secondPublished.snapshot.files?.length === 0,
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
    adjustments: true, concurrency_conflict: true, restoration: true, fiscal_atomicity: true, reports_pdf: true, publication_v4: true,
    corruption_blocked: true, purge_retry: true, purge: true, health: 200 }));
} finally {
  await Promise.all([app.end(), admin.end()]);
}
