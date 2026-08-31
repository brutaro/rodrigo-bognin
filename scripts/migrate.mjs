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
} finally {
  await sql`SELECT pg_advisory_unlock(7824001)`.catch(() => undefined);
  await sql.end();
}
