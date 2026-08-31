import "server-only";

import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";

declare global {
  var triaSql: Sql | undefined;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER));
}

function connectionOptions() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const passwordFile = process.env.PGPASSWORD_FILE;
  const password = passwordFile ? readFileSync(passwordFile, "utf8").trim() : process.env.PGPASSWORD;
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !password) {
    throw new Error("Configuração PostgreSQL incompleta.");
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? "5432"),
    database: process.env.PGDATABASE,
    username: process.env.PGUSER,
    password,
  };
}

export function getSql() {
  if (!isDatabaseConfigured()) throw new Error("PostgreSQL não configurado.");
  if (!globalThis.triaSql) {
    const connection = connectionOptions();
    const options = {
      max: Number(process.env.PGPOOL_MAX ?? "5"),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
    };
    globalThis.triaSql = typeof connection === "string"
      ? postgres(connection, options)
      : postgres({ ...connection, ...options });
  }
  return globalThis.triaSql;
}
