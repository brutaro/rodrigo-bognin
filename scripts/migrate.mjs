import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

function password() {
  if (process.env.PGPASSWORD_FILE) return readFile(process.env.PGPASSWORD_FILE, "utf8").then((value) => value.trim());
  return Promise.resolve(process.env.PGPASSWORD ?? "");
}

const sql = postgres({
  host: process.env.PGHOST ?? "db",
  port: Number(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE ?? "tria",
  username: process.env.PGUSER ?? "tria_migrator",
  password: await password(),
  max: 1,
  prepare: false,
});

try {
  await sql`SELECT pg_advisory_lock(7824001)`;
  await sql`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const directory = path.resolve("db/migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const body = await readFile(path.join(directory, name), "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const existing = await sql`SELECT sha256 FROM schema_migration WHERE name = ${name}`;
    if (existing.length) {
      if (existing[0].sha256 !== sha256) throw new Error(`Migration alterada após aplicação: ${name}`);
      console.log(`migration ${name}: already applied`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migration (name, sha256) VALUES (${name}, ${sha256})`;
    });
    console.log(`migration ${name}: applied`);
  }
  const namespace = process.env.TRIA_INSTANCE_NAMESPACE;
  if (namespace) {
    if (!/^[a-z0-9][a-z0-9_-]{2,100}$/.test(namespace)) throw new Error("Namespace da instância inválido.");
    const [marker] = await sql`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
    if (marker && marker.namespace !== namespace) throw new Error("Banco pertence a outra instância.");
    if (!marker) await sql`INSERT INTO runtime_instance_marker (singleton, namespace) VALUES (true, ${namespace})`;
  }
} finally {
  await sql`SELECT pg_advisory_unlock(7824001)`.catch(() => undefined);
  await sql.end();
}
