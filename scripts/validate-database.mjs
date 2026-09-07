import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";
async function password() { return process.env.PGPASSWORD_FILE ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim() : process.env.PGPASSWORD ?? ""; }
const expectedMigrationCount = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((name) => /^\d+.*\.sql$/.test(name)).length;
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
    (SELECT count(*)::int FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_versions,
    (SELECT count(DISTINCT object_key)::int FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_objects,
    (SELECT coalesce(sum(size_bytes), 0)::text FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_bytes,
    (SELECT count(*)::int FROM project_evidence pe JOIN file_version v ON v.evidence_asset_id = pe.evidence_asset_id
      JOIN file_document d ON d.id = v.document_id WHERE v.status = 'active' AND d.status = 'active' AND d.document_kind = 'evidence') resolvable_evidence_links,
    (SELECT count(*)::int FROM file_version WHERE evidence_asset_id IS NOT NULL AND sha256 <> evidence_asset_id) invalid_evidence_hashes,
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
    (SELECT count(*)::int FROM source_file) source_files,
    (SELECT count(*)::int FROM src_import_batch) src_import_batches,
    (SELECT count(*)::int FROM src_import_preview) src_import_previews,
    (SELECT count(*)::int FROM src_import_preview_confirmation) src_import_confirmations,
    (SELECT count(*)::int FROM src_import_staging_row WHERE normalized_payload ? 'curso' OR normalized_payload ? 'trilha') src_import_rows_with_ignored_fields,
    (SELECT count(*)::int FROM src_import_preview p LEFT JOIN src_import_batch b ON b.id = p.batch_id WHERE b.id IS NULL OR p.preview_hash !~ '^[0-9a-f]{64}$') src_import_invalid_previews,
    (SELECT count(*)::int FROM src_reconciliation WHERE parent_reconciliation_id IS NULL AND revision_no <> 1) src_invalid_reconciliation_roots,
    (SELECT count(*)::int FROM src_reconciliation_decision d JOIN src_reconciliation r ON r.id = d.reconciliation_id
      WHERE d.policy_version <> r.policy_version OR d.actor <> 'Rodrigo' OR (d.outcome = 'reject' AND d.stable_record_id IS NOT NULL)) src_invalid_reconciliation_decisions,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('write_source_reconciliation', 'alias_source_reconciliation_request', 'apply_source_reconciliation') AND p.prosecdef) story33_security_definer_functions,
    has_function_privilege('tria_app', 'write_source_reconciliation(text,jsonb)', 'execute') app_can_write_reconciliation,
    has_function_privilege('tria_app', 'apply_source_reconciliation(uuid,text,uuid,text)', 'execute') app_can_apply_reconciliation,
    has_table_privilege('tria_app', 'src_reconciliation', 'insert') app_can_insert_reconciliation,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'src_import_staging_row' AND column_name IN ('duration_sources','matching_attributes')) src33_staging_columns,
    (SELECT count(*)::int FROM file_document d WHERE d.document_kind = 'source' AND NOT EXISTS (
      SELECT 1 FROM source_file sf WHERE sf.document_id = d.id)) source_documents_without_record,
    (SELECT count(*)::int FROM source_file sf JOIN file_document d ON d.id = sf.document_id
      JOIN file_version v ON v.id = sf.file_version_id
      WHERE d.document_kind <> 'source' OR d.project_id IS NOT NULL OR d.include_in_publication OR d.status <> 'active' OR
        v.document_id <> d.id OR v.version <> 1 OR v.status <> 'active' OR v.evidence_asset_id IS NOT NULL OR
        sf.source_format <> lower(substring(v.original_name FROM '\\.([^.]+)$')) OR
        sf.received_at <> d.created_at OR sf.received_at <> d.updated_at OR sf.received_at <> v.created_at) invalid_source_files,
    (SELECT count(*)::int FROM source_file sf WHERE (SELECT count(*) FROM file_version v WHERE v.document_id = sf.document_id) <> 1) source_documents_with_extra_versions,
    (SELECT count(*)::int FROM source_file sf WHERE NOT EXISTS (
      SELECT 1 FROM source_file_event e JOIN file_version v ON v.id = sf.file_version_id
      WHERE e.source_file_id = sf.id AND e.operation = 'source.file.received.v1' AND e.byte_count = v.size_bytes AND
        e.actor = sf.received_by AND e.occurred_at = sf.received_at)) source_files_without_receipt_event,
    (SELECT count(*)::int FROM runtime_instance_marker) instance_markers,
    has_table_privilege('tria_app', 'runtime_instance_marker', 'select') app_can_read_instance_marker,
    has_table_privilege('tria_app', 'runtime_instance_marker', 'insert') app_can_write_instance_marker,
    (SELECT count(*)::int FROM owner_fiscal_note_revision WHERE duplicate_confirmed <> (cardinality(detected_duplicate_fiscal_note_ids) > 0)) invalid_duplicate_audits,
    (SELECT volume_uuid IS NOT NULL AND quota_bytes = 4000000000 AND used_bytes >= 0 AND reserved_bytes >= 0 AND used_bytes + reserved_bytes <= quota_bytes FROM file_store_counter WHERE singleton) file_counter_valid,
    (SELECT count(*)::int FROM owner_session WHERE expires_at <= created_at OR (revoked_at IS NOT NULL AND revoked_at < created_at)) invalid_owner_sessions,
    (SELECT count(*)::int FROM file_operation_event WHERE actor <> 'Rodrigo' OR byte_count < 0 OR version_count < 0 OR publication_count < 0) invalid_file_events,
    (SELECT count(*)::int FROM file_version v LEFT JOIN file_document d ON d.id = v.document_id WHERE d.id IS NULL) orphan_file_versions,
    (SELECT used_bytes = (SELECT coalesce(sum(size_bytes), 0) FROM file_version) FROM file_store_counter WHERE singleton) file_used_matches_catalog,
    (SELECT reserved_bytes = (SELECT coalesce(sum(reserved_bytes), 0) FROM file_reservation WHERE status = 'reserved') FROM file_store_counter WHERE singleton) file_reserved_matches_sessions,
    (SELECT count(*)::int FROM file_reservation r LEFT JOIN file_version v ON v.object_key = r.object_key
      WHERE r.object_key IS NOT NULL AND v.id IS NULL) orphan_object_reservations,
    (SELECT count(*)::int FROM publication_file pf LEFT JOIN publication p ON p.id = pf.publication_id LEFT JOIN file_version v ON v.id = pf.file_version_id WHERE p.id IS NULL OR v.id IS NULL) orphan_publication_files,
    EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
      WHERE d.datname = current_database() AND acl.grantee = 0 AND acl.privilege_type IN ('CONNECT','TEMPORARY')) public_database_access,
    has_schema_privilege('tria_importer', 'public', 'create') importer_can_ddl,
    has_table_privilege('tria_importer', 'bm_activity', 'insert') importer_can_insert_activity,
    has_table_privilege('tria_importer', 'publication', 'insert') importer_can_publish,
    has_column_privilege('tria_app', 'project', 'title', 'select') app_can_read_title,
    has_column_privilege('tria_app', 'project', 'import_batch_id', 'select') app_can_read_project_batch,
    has_column_privilege('tria_app', 'project_draft', 'narrative', 'update') app_can_update_narrative,
    has_column_privilege('tria_app', 'project_draft', 'project_id', 'update') app_can_move_draft,
    has_column_privilege('tria_app', 'file_document', 'project_id', 'update') app_can_move_file,
    has_column_privilege('tria_app', 'file_document', 'include_in_publication', 'update') app_can_toggle_file,
    has_column_privilege('tria_app', 'file_version', 'id', 'insert') app_can_insert_file_version,
    has_column_privilege('tria_app', 'file_version', 'evidence_asset_id', 'insert') app_can_claim_evidence,
    has_column_privilege('tria_app', 'file_document', 'document_kind', 'insert') app_can_set_document_kind,
    has_table_privilege('tria_app', 'source_file', 'select') app_can_read_source_file,
    has_table_privilege('tria_app', 'source_file', 'insert') app_can_insert_source_file,
    has_table_privilege('tria_app', 'source_file', 'update') app_can_update_source_file,
    has_table_privilege('tria_app', 'source_file_event', 'select') app_can_read_source_event,
    has_table_privilege('tria_app', 'source_file_event', 'insert') app_can_insert_source_event,
    has_table_privilege('tria_app', 'source_file_event', 'delete') app_can_delete_source_event,
    has_table_privilege('tria_app', 'file_operation_event', 'insert') app_can_insert_file_event,
    has_column_privilege('tria_app', 'owner_session', 'revoked_at', 'update') app_can_revoke_session,
    has_column_privilege('tria_app', 'owner_session', 'expires_at', 'update') app_can_extend_session,
    has_table_privilege('tria_app', 'file_operation_event', 'update') app_can_update_file_event,
    has_table_privilege('tria_app', 'publication', 'delete') app_can_delete_publication,
    has_function_privilege('tria_app', 'complete_file_purge(uuid)', 'execute') app_can_complete_purge,
    (SELECT count(*)::int FROM effective_bm_activity) effective_activities,
    (SELECT count(*)::int FROM effective_fiscal_note) effective_notes,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN ('owner_activity_revision'::regclass, 'owner_fiscal_note_revision'::regclass) AND NOT tgisinternal) adjustment_triggers,
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND
      ((table_name = 'effective_bm_activity' AND column_name IN ('batch_id','source_id','source_sheet','source_excel_row','cost_center','quality_status')) OR
       (table_name = 'effective_fiscal_note' AND column_name IN ('batch_id','source_note_id')))) effective_views_safe,
    has_table_privilege('tria_app', 'effective_bm_activity', 'select') app_can_read_effective_activities,
    has_table_privilege('tria_app', 'effective_fiscal_note', 'select') app_can_read_effective_notes,
    has_table_privilege('tria_app', 'owner_activity_revision', 'insert') app_can_insert_activity_revision,
    has_table_privilege('tria_app', 'owner_fiscal_note_revision', 'update') app_can_update_fiscal_revision,
    has_table_privilege('tria_app', 'bm_activity', 'update') app_can_update_activity_source,
    has_table_privilege('tria_app', 'fiscal_note', 'update') app_can_update_fiscal_source,
    has_table_privilege('tria_app', 'financial_relation', 'update') app_can_update_relation_source,
    has_function_privilege('tria_app', 'apply_owner_activity_adjustment(text,bigint,uuid,text,bigint,numeric)', 'execute') app_can_adjust_activity,
    has_function_privilege('tria_app', 'restore_owner_activity(text,bigint,uuid,text)', 'execute') app_can_restore_activity,
    has_function_privilege('tria_app', 'apply_owner_fiscal_note_adjustment(text,bigint,uuid,text,smallint,text,date,numeric,text,text,text,text,text,text,boolean,numeric,boolean)', 'execute') app_can_adjust_fiscal,
    has_function_privilege('tria_app', 'restore_owner_fiscal_note(text,bigint,uuid,text,boolean)', 'execute') app_can_restore_fiscal`;
  const expected = {
    batches: 4, projects: 59, activities: 3364, bms: 32, notes: 142, relations: 142,
    evidence_assets: 53, evidence_links: 72, evidence_versions: 53, evidence_objects: 53,
    evidence_bytes: "1126834973", resolvable_evidence_links: 72, invalid_evidence_hashes: 0,
    mapped_candidates: 21, ineligible: 142,
    relation_without_batch: 0, evidence_without_batch: 0, relation_wrong_batch: 0, asset_wrong_batch: 0, evidence_wrong_batch: 0, contact_hits: 0, migrations: expectedMigrationCount, source_documents_without_record: 0, invalid_source_files: 0, source_documents_with_extra_versions: 0, source_files_without_receipt_event: 0, instance_markers: 1, app_can_read_instance_marker: true, app_can_write_instance_marker: false, invalid_duplicate_audits: 0, file_counter_valid: true, file_used_matches_catalog: true, file_reserved_matches_sessions: true, invalid_owner_sessions: 0, invalid_file_events: 0, orphan_file_versions: 0, orphan_object_reservations: 0, orphan_publication_files: 0,
    source_refs_opaque: true, evidence_refs_opaque: true, public_database_access: false, importer_can_ddl: false,
    src_import_rows_with_ignored_fields: 0, src_import_invalid_previews: 0,
    src_invalid_reconciliation_roots: 0, src_invalid_reconciliation_decisions: 0, story33_security_definer_functions: 3,
    app_can_write_reconciliation: true, app_can_apply_reconciliation: true, app_can_insert_reconciliation: false, src33_staging_columns: 2,
    importer_can_insert_activity: true, importer_can_publish: false, app_can_read_title: true,
    app_can_read_project_batch: false, app_can_update_narrative: true, app_can_move_draft: false,
    app_can_move_file: false, app_can_toggle_file: true, app_can_insert_file_version: true, app_can_claim_evidence: false, app_can_set_document_kind: true,
    app_can_read_source_file: true, app_can_insert_source_file: true, app_can_update_source_file: false,
    app_can_read_source_event: true, app_can_insert_source_event: true, app_can_delete_source_event: false,
    app_can_insert_file_event: true, app_can_revoke_session: true, app_can_extend_session: false, app_can_update_file_event: false, app_can_delete_publication: false, app_can_complete_purge: true,
    effective_activities: 3364, effective_notes: 142, adjustment_triggers: 4, effective_views_safe: true,
    app_can_read_effective_activities: true, app_can_read_effective_notes: true,
    app_can_insert_activity_revision: false, app_can_update_fiscal_revision: false,
    app_can_update_activity_source: false, app_can_update_fiscal_source: false, app_can_update_relation_source: false,
    app_can_adjust_activity: true, app_can_restore_activity: true, app_can_adjust_fiscal: true, app_can_restore_fiscal: true,
  };
  for (const key of ["src_import_batches", "src_import_previews", "src_import_confirmations"]) {
    if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error(`Cardinalidade PostgreSQL inválida: ${key}.`);
  }
  for (const [key, value] of Object.entries(expected)) if (row[key] !== value) throw new Error(`Invariante PostgreSQL falhou: ${key}.`);
  console.log(JSON.stringify({ status: "valid", projects: row.projects, activities: row.activities, notes: row.notes, evidence_links: row.evidence_links, source_files: row.source_files, migrations: row.migrations }));
} finally { await sql.end(); }
