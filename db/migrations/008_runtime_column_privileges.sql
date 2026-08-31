-- Remove source lineage and audit notes from the runtime role unless a query needs them.
REVOKE SELECT ON project, project_evidence FROM tria_app;
GRANT SELECT (id, title, date_start, date_end, bm_count, activity_count, hours_total, value_total, evidence_status)
  ON project TO tria_app;
GRANT SELECT (project_id, evidence_asset_id, strength, status)
  ON project_evidence TO tria_app;
GRANT SELECT (full_value_eligible, verified_related_value)
  ON financial_relation TO tria_app;
