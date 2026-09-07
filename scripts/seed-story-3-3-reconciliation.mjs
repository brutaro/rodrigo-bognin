#!/usr/bin/env node
import postgres from "postgres";

if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" || process.env.TRIA_RUNTIME === "railway") {
  throw new Error("A fixture de reconciliação só pode ser criada no ambiente isolado.");
}

const recordId = "00000000-0000-4000-8000-000000000001";
const updatedRecordId = "53000000-0000-4000-8000-000000000002";
const unchangedRecordId = "53000000-0000-4000-8000-000000000003";
const absenceRecordIds = Array.from({ length: 51 }, (_, index) => `53000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`);
const manualLinkRecordId = absenceRecordIds.at(-1);
const namespace = process.env.TRIA_INTEGRATION_NAMESPACE ?? "";
const instanceNamespace = process.env.TRIA_INSTANCE_NAMESPACE ?? "";
const database = process.env.PGDATABASE ?? "";
const host = process.env.PGHOST ?? "";
if (process.env.TRIA_INTEGRATION_ISOLATED !== "confirmed" ||
    process.env.TRIA_RUNTIME === "railway" ||
    !/^tria-adjustments-[a-z0-9_-]+$/.test(namespace) ||
    instanceNamespace !== namespace || host !== "db" || database !== "tria") {
  throw new Error("A fixture da Story 3.3 exige namespace tria-adjustments, marcador TRIA_INSTANCE_NAMESPACE coincidente e banco descartável db/tria.");
}
const password = process.env.TRIA_ADMIN_PASSWORD ?? "";
const sql = postgres({
  host,
  port: Number(process.env.PGPORT ?? 5432),
  database,
  username: "tria_admin",
  password,
  max: 1,
  prepare: false,
});

try {
  await sql.begin(async (tx) => {
    const [databaseMarker] = await tx`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
    if (!databaseMarker || databaseMarker.namespace !== namespace) throw new Error("O marcador persistido não corresponde ao namespace isolado da fixture.");
    const [version] = await tx`SELECT version::text FROM src_projection_version WHERE singleton FOR UPDATE`;
    await tx`INSERT INTO src_stable_record (id, state, matching_attributes, created_at)
      VALUES (${recordId}::uuid, 'active', ${tx.json({ rf81_fixture: "absent" })}, now())`;
    await tx`INSERT INTO src_effective_record_projection
      (record_id, payload, decimal_sources, duration_sources, state, version, updated_at)
      VALUES (${recordId}::uuid, ${tx.json({ rf81_fixture: "absent", valor: "99.90", duracao: "01:02" })},
        ${tx.json({ valor: { source_text: "99.90", source_scale: 2, normalized_value: "99.90" } })},
        ${tx.json({ duracao: { source_text: "01:02", unit: "clock" } })}, 'active', ${version?.version ?? "0"}, now())`;
    await tx`INSERT INTO src_stable_record (id, state, matching_attributes, created_at)
      VALUES (${updatedRecordId}::uuid, 'active', ${tx.json({ referencia: "RF-UPDATED" })}, now()),
             (${unchangedRecordId}::uuid, 'active', ${tx.json({ referencia: "RF-UNCHANGED" })}, now())`;
    await tx`INSERT INTO src_effective_record_projection
      (record_id, payload, decimal_sources, duration_sources, state, version, updated_at)
      VALUES
        (${updatedRecordId}::uuid, ${tx.json({ codigo: "ATUALIZADA", referencia: "RF-UPDATED", data: "2026-01-01", valor: "9.50" })},
          ${tx.json({ valor: { source_text: "9.50", source_scale: 2, normalized_value: "9.50" } })}, '{}'::jsonb, 'active', ${version?.version ?? "0"}, now()),
        (${unchangedRecordId}::uuid, ${tx.json({ codigo: "IGUAL", referencia: "RF-UNCHANGED", data: "2026-01-01", valor: "99.90", duracao: "00:30" })},
          ${tx.json({ valor: { source_text: "99.90", source_scale: 2, normalized_value: "99.90" } })}, ${tx.json({ duracao: { source_text: "00:30", unit: "clock" } })}, 'active', ${version?.version ?? "0"}, now())`;
    for (const absenceId of absenceRecordIds) {
      await tx`INSERT INTO src_stable_record (id, state, matching_attributes, created_at)
        VALUES (${absenceId}::uuid, 'active', ${tx.json({ rf81_fixture: "absent" })}, now())`;
      await tx`INSERT INTO src_effective_record_projection
        (record_id, payload, decimal_sources, duration_sources, state, version, updated_at)
        VALUES (${absenceId}::uuid, ${tx.json({ rf81_fixture: "absent", valor: "1.00" })},
          ${tx.json({ valor: { source_text: "1.00", source_scale: 2, normalized_value: "1.00" } })}, '{}', 'active', ${version?.version ?? "0"}, now())`;
    }
  });
  console.log(JSON.stringify({ status: "seeded", recordId, manualLinkRecordId }));
} finally {
  await sql.end();
}
