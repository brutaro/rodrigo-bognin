import { assertSyntheticTarget } from "./assert-synthetic-target.mjs";
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
const namespace=process.env.TRIA_INTEGRATION_NAMESPACE ?? '';
if(process.env.TRIA_INTEGRATION_ISOLATED!=='confirmed' || process.env.TRIA_RUNTIME==='railway' || !/^tria-adjustments-[a-z0-9_-]+$/.test(namespace)) throw new Error('Isolated synthetic namespace required');
await assertSyntheticTarget();
const sql=postgres({host:'db',database:'tria',username:'tria_admin',password:(await readFile(process.env.PGPASSWORD_FILE,'utf8')).trim(),max:1});
try { await sql`INSERT INTO src_import_synthetic_context(namespace) VALUES (${namespace})`; } finally { await sql.end(); }
