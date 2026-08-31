import fs from "node:fs/promises";
import postgres from "postgres";

async function secret(path) { return (await fs.readFile(path, "utf8")).trim(); }
const host = process.env.PGHOST ?? "db";
const database = process.env.PGDATABASE ?? "tria";
const appPassword = await secret(process.env.DB_APP_PASSWORD_FILE ?? "/run/secrets/db_app_password");
const adminPassword = await secret(process.env.DB_ADMIN_PASSWORD_FILE ?? "/run/secrets/db_admin_password");
const app = postgres({ host, database, username: "tria_app", password: appPassword, max: 1 });
const admin = postgres({ host, database, username: "tria_admin", password: adminPassword, max: 1 });
function assert(condition, message) { if (!condition) throw new Error(message); }
try {
  const [{ count }] = await app`SELECT count(*)::int count FROM project`;
  assert(count === 59, "tria_app não leu os 59 projetos");
  let ddlDenied = false;
  try { await app.unsafe('CREATE TABLE forbidden_integration_probe(id integer)'); } catch (error) { ddlDenied = error?.code === "42501"; }
  assert(ddlDenied, "tria_app recebeu DDL indevido");

  const [project] = await app`SELECT id FROM project ORDER BY id LIMIT 1`;
  await app.begin(async (tx) => {
    const requestId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    await tx`INSERT INTO manual_financial_entry (id, project_id, kind, amount_cents, description, origin, document_state, created_at, request_id)
      VALUES (${entryId}, ${project.id}, 'Valor informado', 123, 'Teste transacional', 'Informado por Rodrigo', 'Sem arquivo associado', now(), ${requestId}::uuid)`;
    await tx`INSERT INTO manual_financial_entry (id, project_id, kind, amount_cents, description, origin, document_state, created_at, request_id)
      VALUES (${crypto.randomUUID()}, ${project.id}, 'Valor informado', 123, 'Teste transacional', 'Informado por Rodrigo', 'Sem arquivo associado', now(), ${requestId}::uuid)
      ON CONFLICT (request_id) DO NOTHING`;
    const [{ entries }] = await tx`SELECT count(*)::int entries FROM manual_financial_entry WHERE request_id = ${requestId}::uuid`;
    assert(entries === 1, "request_id não foi idempotente");
    throw Object.assign(new Error("rollback-probe"), { expectedRollback: true });
  }).catch((error) => { if (!error.expectedRollback) throw error; });

  let invalidSnapshotDenied = false;
  try {
    await admin.begin(async (tx) => {
      await tx`INSERT INTO publication (id, project_id, version, created_at, created_by, content_hash, record_hash, snapshot)
        VALUES (${crypto.randomUUID()}::uuid, ${project.id}, 1, now(), 'integration', ${"a".repeat(64)}, ${"b".repeat(64)}, '{}'::jsonb)`;
    });
  } catch (error) { invalidSnapshotDenied = error?.code === "23514"; }
  assert(invalidSnapshotDenied, "snapshot JSONB incompleto não foi recusado");

  const base = process.env.APP_BASE_URL ?? "http://app:3000";
  const health = await fetch(`${base}/api/health`);
  const invalidUuid = await fetch(`${base}/publicacoes/not-a-uuid`);
  assert(health.status === 200, `health HTTP ${health.status}`);
  assert(invalidUuid.status === 404, `UUID inválido retornou HTTP ${invalidUuid.status}`);
  console.log(JSON.stringify({ status: "ok", projects: count, ddl_denied: true, idempotency: true, snapshot_check: true, health: 200, invalid_uuid: 404 }));
} finally {
  await Promise.all([app.end(), admin.end()]);
}
