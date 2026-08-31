-- Restrict the runtime role to the columns used by the local application.
REVOKE ALL PRIVILEGES ON
  import_batch, project, bm_activity, fiscal_note, financial_relation,
  evidence_asset, project_evidence, narrative_document, project_draft,
  manual_financial_entry, history_event, publication
FROM tria_app;

GRANT SELECT ON project, project_evidence TO tria_app;
GRANT SELECT (id, project_id, bm_code, activity_date, functionality, activity, duration_seconds, measured_value)
  ON bm_activity TO tria_app;
GRANT SELECT (id, issue_year, note_number, issue_date, amount, category, declared_project_id)
  ON fiscal_note TO tria_app;
GRANT SELECT (fiscal_note_id, candidate_project_id, strength, state)
  ON financial_relation TO tria_app;
GRANT SELECT (id, sha256, file_type, access_level)
  ON evidence_asset TO tria_app;
GRANT SELECT, UPDATE ON project_draft TO tria_app;
GRANT SELECT, INSERT ON manual_financial_entry, history_event, publication TO tria_app;

-- The runtime never receives raw source locations, import manifests, or narrative source paths.
REVOKE ALL PRIVILEGES ON import_batch, narrative_document FROM tria_app;
