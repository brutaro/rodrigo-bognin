#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";

async function secret(file, label) {
  if (!file) throw new Error(`Arquivo secreto ausente: ${label}.`);
  const value = (await readFile(file, "utf8")).trim(); if (!value) throw new Error(`Arquivo secreto vazio: ${label}.`); return value;
}
const adminUrl = await secret(process.env.TRIA_DATABASE_ADMIN_URL_FILE, "database-admin-url");
const roles = {
  tria_app: await secret(process.env.TRIA_DB_APP_PASSWORD_FILE, "db-app-password"),
  tria_migrator: await secret(process.env.TRIA_DB_MIGRATOR_PASSWORD_FILE, "db-migrator-password"),
  tria_importer: await secret(process.env.TRIA_DB_IMPORTER_PASSWORD_FILE, "db-importer-password"),
  tria_admin: await secret(process.env.TRIA_DB_ADMIN_PASSWORD_FILE, "db-admin-password"),
};
const rotate = process.env.TRIA_ROTATE_DB_ROLE_PASSWORDS === "confirmed";
const parsed = new URL(adminUrl); const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!database || !parsed.hostname) throw new Error("URL privada do PostgreSQL inválida.");
const sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => undefined });
let selfRoleToHarden = null;
try {
  for (const [role, password] of Object.entries(roles)) {
    const [state] = await sql`SELECT found.oid IS NOT NULL exists, found.oid = 10 bootstrap, current_user = ${role}::text self,
      coalesce(pg_roles.rolsuper OR pg_roles.rolcreatedb OR pg_roles.rolcreaterole OR pg_roles.rolreplication OR pg_roles.rolbypassrls, false) privileged
      FROM (SELECT (SELECT oid FROM pg_roles WHERE rolname = ${role}::text) oid) found
      LEFT JOIN pg_roles ON pg_roles.oid = found.oid`;
    if (state.bootstrap && role === "tria_admin" && !(process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" && /^tria-evidence-/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? ""))) {
      throw new Error("O usuário bootstrap do provedor não pode ser o papel tria_admin da aplicação.");
    }
    if (!state.exists) {
      const [row] = await sql`SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', ${role}::text, ${password}::text) command`;
      await sql.unsafe(row.command);
    } else {
      if (state.privileged && state.self && !state.bootstrap) selfRoleToHarden = role;
      if (state.privileged && !state.self && !state.bootstrap) { const [row] = await sql`SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', ${role}::text) command`; await sql.unsafe(row.command); }
      if (rotate) { const [row] = await sql`SELECT format('ALTER ROLE %I PASSWORD %L', ${role}::text, ${password}::text) command`; await sql.unsafe(row.command); }
    }
  }

    const [ownerState] = await sql`SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname = current_database()`;
    if (ownerState.owner !== "tria_admin") { const [owner] = await sql`SELECT format('ALTER DATABASE %I OWNER TO tria_admin', current_database()) command`; await sql.unsafe(owner.command); }
    await sql`REVOKE CREATE ON SCHEMA public FROM PUBLIC`; await sql`GRANT USAGE, CREATE ON SCHEMA public TO tria_migrator`;
    const [revoke] = await sql`SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) command`; await sql.unsafe(revoke.command);
    const [grant] = await sql`SELECT format('GRANT CONNECT ON DATABASE %I TO tria_admin, tria_app, tria_migrator, tria_importer', current_database()) command`; await sql.unsafe(grant.command);
    if (selfRoleToHarden) {
      const [hardenSelf] = await sql`SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', ${selfRoleToHarden}::text) command`;
      await sql.unsafe(hardenSelf.command);
    }
} finally { await sql.end(); }
const configPath = process.env.TRIA_DATABASE_CONFIG_OUTPUT; if (!configPath) throw new Error("Destino da configuração privada ausente.");
await writeFile(configPath, `${JSON.stringify({ host: parsed.hostname, port: Number(parsed.port || 5432), database })}\n`, { mode: 0o600, flag: "wx" });
await chmod(configPath, 0o600); console.log(rotate ? "Papéis PostgreSQL preparados e rotação explícita aplicada." : "Papéis PostgreSQL preparados sem rotação.");
