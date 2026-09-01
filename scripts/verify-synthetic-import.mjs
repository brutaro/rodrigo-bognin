#!/usr/bin/env node
import { lstat, opendir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
const phase = process.argv[2] === "--phase" ? process.argv[3] : process.argv[2]; if (!["crash", "final"].includes(phase)) throw new Error("Use --phase crash|final");
const password = (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim();
const sql = postgres({ host: process.env.PGHOST ?? "db", database: process.env.PGDATABASE ?? "tria", username: "tria_migrator", password, max: 1 });
try {
  const [state] = await sql`SELECT used_bytes::text used, reserved_bytes::text reserved,
    (SELECT count(*)::int FROM file_version WHERE evidence_asset_id IS NOT NULL) versions,
    (SELECT count(*)::int FROM file_reservation WHERE status = 'committed') committed FROM file_store_counter WHERE singleton`;
  const names = []; for await (const item of await opendir(path.join(process.env.TRIA_FILE_STORE_PATH, "objects"))) if (item.isFile()) names.push(item.name);
  let journal = false; try { journal = (await lstat(path.join(process.env.TRIA_FILE_STORE_PATH, ".tria-evidence-import-v1.json"))).isFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (phase === "crash" && !(state.used === "0" && state.reserved === "5" && state.versions === 0 && names.length === 1 && journal)) throw new Error(`Estado pós-crash inválido: ${JSON.stringify({ state, names, journal })}`);
  if (phase === "final" && !(state.used === "5" && state.reserved === "0" && state.versions === 2 && state.committed === 2 && names.length === 2 && !journal)) throw new Error(`Estado final inválido: ${JSON.stringify({ state, names, journal })}`);
  const ids = await sql`SELECT d.id::text document_id, v.id::text version_id, v.object_key::text FROM file_version v JOIN file_document d ON d.id=v.document_id ORDER BY v.sha256`;
  console.log(JSON.stringify({ phase, ids, ...state }));
} finally { await sql.end(); }
