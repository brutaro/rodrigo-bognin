import { readFile } from "node:fs/promises";
import postgres from "postgres";
async function password() { return process.env.PGPASSWORD_FILE ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim() : process.env.PGPASSWORD ?? ""; }
const sql = postgres({ host: process.env.PGHOST ?? "db", port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? "tria", username: process.env.PGUSER ?? "tria_migrator", password: await password(), max: 1, prepare: false });
try {
  const [row] = await sql`SELECT
    (SELECT count(*)::int FROM import_batch) batches,
    (SELECT count(*)::int FROM project) projects,
    (SELECT count(*)::int FROM bm_activity) activities,
    (SELECT count(DISTINCT bm_code)::int FROM bm_activity) bms,
    (SELECT count(*)::int FROM fiscal_note) notes,
    (SELECT count(*)::int FROM financial_relation) relations,
    (SELECT count(*)::int FROM evidence_asset) evidence_assets,
    (SELECT count(*)::int FROM project_evidence) evidence_links,
    (SELECT count(*)::int FROM financial_relation WHERE candidate_project_id IS NOT NULL) mapped_candidates,
    (SELECT count(*)::int FROM financial_relation WHERE full_value_eligible = false) ineligible,
    (SELECT count(*)::int FROM financial_relation WHERE batch_id IS NULL) relation_without_batch,
    (SELECT count(*)::int FROM project_evidence WHERE batch_id IS NULL) evidence_without_batch,
    (SELECT count(*)::int FROM financial_relation r JOIN import_batch b ON b.id = r.batch_id WHERE b.source_type <> 'financial_relations') relation_wrong_batch,
    (SELECT count(*)::int FROM evidence_asset e JOIN import_batch b ON b.id = e.batch_id WHERE b.source_type <> 'project_evidence') asset_wrong_batch,
    (SELECT count(*)::int FROM project_evidence e JOIN import_batch b ON b.id = e.batch_id WHERE b.source_type <> 'project_evidence') evidence_wrong_batch,
    (SELECT count(*)::int FROM bm_activity WHERE coalesce(activity, '') ~* '[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}|[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}' OR coalesce(functionality, '') ~* '[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}|[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}') contact_hits,
    (SELECT bool_and(relative_path LIKE 'source://%') FROM import_batch) source_refs_opaque,
    (SELECT bool_and(private_path = 'sha256://' || sha256) FROM evidence_asset) evidence_refs_opaque,
    (SELECT count(*)::int FROM schema_migration) migrations,
    has_schema_privilege('tria_importer', 'public', 'create') importer_can_ddl,
    has_table_privilege('tria_importer', 'bm_activity', 'insert') importer_can_insert_activity,
    has_table_privilege('tria_importer', 'publication', 'insert') importer_can_publish,
    has_column_privilege('tria_app', 'project', 'title', 'select') app_can_read_title,
    has_column_privilege('tria_app', 'project', 'import_batch_id', 'select') app_can_read_project_batch,
    has_column_privilege('tria_app', 'project_draft', 'narrative', 'update') app_can_update_narrative,
    has_column_privilege('tria_app', 'project_draft', 'project_id', 'update') app_can_move_draft`;
  const expected = {
    batches: 4, projects: 59, activities: 3364, bms: 32, notes: 142, relations: 142,
    evidence_assets: 53, evidence_links: 72, mapped_candidates: 21, ineligible: 142,
    relation_without_batch: 0, evidence_without_batch: 0, relation_wrong_batch: 0, asset_wrong_batch: 0, evidence_wrong_batch: 0, contact_hits: 0, migrations: 14,
    source_refs_opaque: true, evidence_refs_opaque: true, importer_can_ddl: false,
    importer_can_insert_activity: true, importer_can_publish: false, app_can_read_title: true,
    app_can_read_project_batch: false, app_can_update_narrative: true, app_can_move_draft: false,
  };
  for (const [key, value] of Object.entries(expected)) if (row[key] !== value) throw new Error(`Invariante PostgreSQL falhou: ${key}.`);
  console.log(JSON.stringify({ status: "valid", projects: row.projects, activities: row.activities, notes: row.notes, evidence_links: row.evidence_links, migrations: row.migrations }));
} finally { await sql.end(); }
