#!/usr/bin/env node
import {assertSyntheticTarget} from "./assert-synthetic-target.mjs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" || process.env.TRIA_RUNTIME === "railway" || !/^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "")) {
  throw new Error("A atestação sintética exige namespace isolado e não pode rodar em Railway.");
}
await assertSyntheticTarget();
const sourceFileId = process.argv[2];
if (!sourceFileId) throw new Error("Informe o source_file_id da fixture.");
const password = process.env.PGPASSWORD_FILE ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim() : process.env.PGPASSWORD ?? "";
const sql = postgres({ host: process.env.PGHOST ?? "db", port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? "tria", username: "tria_importer", password, max: 1, prepare: false });
try {
  const [source] = await sql`SELECT sf.id::text source_file_id, sf.file_version_id::text file_version_id, upper(sf.source_format) source_format, v.sha256
    FROM source_file sf JOIN file_version v ON v.id = sf.file_version_id AND v.document_id = sf.document_id
    JOIN file_document d ON d.id = sf.document_id
    WHERE sf.id = ${sourceFileId}::uuid AND d.document_kind = 'source' AND d.status = 'active' AND v.status = 'active'`;
  if (!source || !["CSV", "XLSX", "XLS"].includes(source.source_format)) throw new Error("Fonte não é uma fixture tabular ativa.");
  const [inserted] = await sql`INSERT INTO src_import_source_attestation
    (id, source_file_id, file_version_id, source_sha256, source_format, namespace, attestation_kind, attested_at)
    VALUES (${randomUUID()}, ${source.source_file_id}::uuid, ${source.file_version_id}::uuid, ${source.sha256}, ${source.source_format}, ${process.env.TRIA_INTEGRATION_NAMESPACE}, 'synthetic-seed-v1', now())
    ON CONFLICT (source_file_id) DO NOTHING
    RETURNING id::text`;
  if (!inserted) {
    const [existing] = await sql`SELECT file_version_id::text, source_sha256, source_format, namespace, attestation_kind
      FROM src_import_source_attestation WHERE source_file_id = ${source.source_file_id}::uuid`;
    if (!existing || existing.file_version_id !== source.file_version_id || existing.source_sha256 !== source.sha256 || existing.source_format !== source.source_format || existing.namespace !== process.env.TRIA_INTEGRATION_NAMESPACE || existing.attestation_kind !== "synthetic-seed-v1") {
      throw new Error("A atestação sintética existente não corresponde à fixture solicitada.");
    }
  }
  console.log(JSON.stringify({ status: "attested", sourceFileId: source.source_file_id, fileVersionId: source.file_version_id, sourceFormat: source.source_format }));
} finally { await sql.end(); }
