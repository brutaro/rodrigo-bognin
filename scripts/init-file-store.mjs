import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const root = process.env.TRIA_FILE_STORE_PATH;
const uuidFile = process.env.TRIA_FILE_STORE_UUID_FILE;
if (!root || !path.isAbsolute(root) || !uuidFile) throw new Error("Configuração do volume ausente.");
const expected = (await readFile(uuidFile, "utf8")).trim();
const instanceNamespace = process.env.TRIA_INSTANCE_NAMESPACE;
if (instanceNamespace && !/^[a-z0-9][a-z0-9_-]{2,100}$/.test(instanceNamespace)) throw new Error("Namespace da instância inválido.");
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expected)) throw new Error("UUID do volume inválido.");
await mkdir(root, { recursive: true, mode: 0o700 });
const sentinel = path.join(root, ".tria-volume");
try {
  const details = await lstat(sentinel);
  if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && details.uid !== process.getuid())) throw new Error("Sentinel inseguro.");
  const handle = await open(sentinel, constants.O_RDONLY | constants.O_NOFOLLOW);
  let current; try { current = (await handle.readFile("utf8")).trim(); } finally { await handle.close(); }
  if (current !== expected) throw new Error("Sentinel pertence a outro volume.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const passwordFile = process.env.PGPASSWORD_FILE;
  const password = passwordFile ? (await readFile(passwordFile, "utf8")).trim() : "";
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !password) throw new Error("Banco indisponível para validar volume novo.");
  const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE,
    username: process.env.PGUSER, password, max: 1, prepare: false });
  try {
    const [catalog] = await sql`SELECT count(*)::int files FROM file_version`;
    if (catalog.files > 0) throw new Error("Volume novo recusado porque o catálogo contém arquivos.");
  } finally { await sql.end(); }
  await writeFile(sentinel, `${expected}
`, { mode: 0o600, flag: "wx" });
}
const sentinelHandle = await open(sentinel, "r");
await sentinelHandle.sync(); await sentinelHandle.close();
await mkdir(path.join(root, "objects"), { recursive: true, mode: 0o700 });
await mkdir(path.join(root, "staging"), { recursive: true, mode: 0o700 });
await access(path.join(root, "objects"));
const directory = await open(root, "r");
await directory.sync(); await directory.close();

const passwordFile = process.env.PGPASSWORD_FILE;
const password = passwordFile ? (await readFile(passwordFile, "utf8")).trim() : "";
if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !password) throw new Error("Banco indisponível para vincular o volume.");
const bindingSql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE,
  username: process.env.PGUSER, password, max: 1, prepare: false });
try {
  await bindingSql.begin(async (tx) => {
    if (instanceNamespace) {
      const [instance] = await tx`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
      if (!instance || instance.namespace !== instanceNamespace) throw new Error("Banco pertence a outra instância.");
    }
    const [counter] = await tx`SELECT volume_uuid::text FROM file_store_counter WHERE singleton FOR UPDATE`;
    if (!counter) throw new Error("Contador do cofre ausente.");
    if (counter.volume_uuid && counter.volume_uuid !== expected) throw new Error("Banco vinculado a outro volume.");
    if (!counter.volume_uuid) await tx`UPDATE file_store_counter SET volume_uuid = ${expected}::uuid WHERE singleton`;
  });
} finally { await bindingSql.end(); }
if (instanceNamespace) {
  const instanceFile = path.join(root, ".tria-instance-namespace");
  try {
    const details = await lstat(instanceFile);
    if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o077) !== 0) throw new Error("Marcador de instância inseguro.");
    const current = (await readFile(instanceFile, "utf8")).trim();
    if (current !== instanceNamespace) throw new Error("Volume pertence a outra instância.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(instanceFile, `${instanceNamespace}
`, { mode: 0o600, flag: "wx" });
  }
}
console.log("file store initialized");
