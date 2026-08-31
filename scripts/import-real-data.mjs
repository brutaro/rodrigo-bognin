import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse } from "csv-parse/sync";
import postgres from "postgres";

const sourceDefinitions = {
  activities: {
    type: "bm_activities",
    path: process.env.IMPORT_ACTIVITIES ?? "/imports/bm_activities_normalized.complete.csv",
    relativePath: "source://bm-activities/complete-v1",
    sha256: "2b8bf025afb44dd4204d4a78755c2fae0bcee217fa765416da55d62652c354b0",
    rows: 3364,
    delimiter: ",",
    headers: ["bm_line_id", "source_id", "source_relative_path", "source_sheet", "source_excel_row", "bm", "person", "activity_date", "month_period", "cost_center", "project_contract", "course", "course_stage", "functionality", "activity", "extract", "duration", "hourly_rate_brl", "value_brl", "reserved", "de_para", "check", "duration_seconds", "duration_hours", "month_period_formula", "value_formula_or_literal"],
  },
  notes: {
    type: "fiscal_notes",
    path: process.env.IMPORT_NOTES ?? "/imports/NFS_PROCESSADA_FONTE_VERDADE.csv",
    relativePath: "source://fiscal-notes/truth-v1",
    sha256: "c71e2728a6f5c2d65a3eded66cbdf3e54f4305c6144d1a86018803ed3d3f23bc",
    rows: 142,
    delimiter: ";",
    headers: ["ID NFS-e", "Ano", "NFS-e", "Emissão", "Tomador", "Documento tomador", "Valor NFS-e", "Descrição da NFS-e", "Categoria", "Projeto vinculado"],
  },
  relations: {
    type: "financial_relations",
    path: process.env.IMPORT_RELATIONS ?? "/imports/CLASSIFICACAO_RELACAO_NFS_PROJETOS.csv",
    relativePath: "source://financial-relations/audited-v1",
    sha256: "0ea7c3bf5bc97ebc28a88d83819a036936b261fe313576690aeb26cf767b4a7c",
    rows: 142,
    delimiter: ";",
    headers: ["ID NFS-e", "Ano", "NFS-e", "Emissão", "Tomador", "Documento tomador (mascarado)", "Valor NFS-e", "Descrição", "Categoria", "Projeto declarado na fonte", "Força do vínculo", "Estado da relação", "Projeto auditado/candidato", "Critério reproduzível", "Evidência/ponte não financeira", "Observação", "Valor integral elegível no total do projeto", "Valor relacionado verificado", "BI 15/05 — chave e data exatas", "BI 15/05 — valor do título", "BI 15/05 — status", "BI 30/09 — chave localizada", "BI 30/09 — data", "BI 30/09 — valor do título", "BI 30/09 — status"],
  },
  evidence: {
    type: "project_evidence",
    path: process.env.IMPORT_EVIDENCE ?? "/imports/project_deliverable_crosswalk.csv",
    relativePath: "source://project-evidence/crosswalk-v1",
    sha256: "38bdc6177ee59b502cc1af926b480eaf55b8c7283dea65ac7e0e85bd544ffb51",
    rows: 59,
    delimiter: ",",
    headers: ["bm_project_id", "project_contract", "bm_record_count", "bm_date_min_valid", "bm_date_max_valid", "bm_source_excel_row_min", "bm_source_excel_row_max", "bm_source_reference", "link_strength", "rule_used", "caveats", "candidate_count", "candidate_1_source_id", "candidate_1_relative_path", "candidate_1_sha256", "candidate_1_hash_status", "candidate_1_type", "candidate_1_internal_created", "candidate_1_internal_modified", "candidate_1_date_tokens_in_path", "candidate_1_metadata_note", "candidate_2_source_id", "candidate_2_relative_path", "candidate_2_sha256", "candidate_2_hash_status", "candidate_2_type", "candidate_2_internal_created", "candidate_2_internal_modified", "candidate_2_date_tokens_in_path", "candidate_2_metadata_note"],
  },
};

async function load(definition) {
  if (definition === sourceDefinitions.activities && basename(definition.path) !== "bm_activities_normalized.complete.csv") {
    throw new Error("A fonte de atividades deve ser o CSV canônico com sufixo .complete.csv.");
  }
  const bytes = await readFile(definition.path);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== definition.sha256) throw new Error(`Hash inválido para ${definition.type}.`);
  const body = bytes.toString("utf8");
  const rows = parse(body.replace(/^\uFEFF/, ""), { columns: true, delimiter: definition.delimiter, bom: true, skip_empty_lines: true, relax_quotes: false });
  const headers = Object.keys(rows[0] ?? {});
  if (headers.length !== definition.headers.length || headers.some((value, index) => value !== definition.headers[index])) {
    throw new Error(`Cabeçalho incompatível para ${definition.type}.`);
  }
  if (rows.length !== definition.rows) throw new Error(`Contagem incompatível para ${definition.type}.`);
  return rows;
}

function unique(values, label) {
  const set = new Set(values);
  if (set.size !== values.length) throw new Error(`Chave duplicada em ${label}.`);
  return set;
}

function normalizeTitle(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function redactPrivateText(value) {
  const text = String(value ?? "");
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[dado pessoal omitido]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[dado pessoal omitido]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[dado pessoal omitido]")
    .replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[dado pessoal omitido]");
}

function timestampOrNull(value) {
  return /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value ?? "") ? value : null;
}

function numericOrNull(value) {
  const clean = String(value ?? "").trim();
  return /^-?\d+(?:\.\d+)?$/.test(clean) ? clean : null;
}

function wholeNumberOrNull(value) {
  const clean = String(value ?? "").trim();
  return /^-?\d+(?:\.0+)?$/.test(clean) ? clean.replace(/\.0+$/, "") : null;
}

function brNumericOrNull(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [wholeRaw, fractionRaw = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const fraction = fractionRaw.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function boolOrNull(value) {
  const normalized = normalizeTitle(value);
  if (["sim", "true", "1", "elegivel"].includes(normalized) || normalized.startsWith("sim ")) return true;
  if (["nao", "false", "0", "nao elegivel"].includes(normalized) || normalized.startsWith("nao ")) return false;
  return null;
}

function stableId(namespace, value) {
  const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function password() {
  if (process.env.PGPASSWORD_FILE) return (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim();
  return process.env.PGPASSWORD ?? "";
}

async function insertChunks(tx, table, rows, columns, size = 400) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    await tx`INSERT INTO ${tx(table)} ${tx(chunk, ...columns)}`;
  }
}

const loaded = {};
for (const [name, definition] of Object.entries(sourceDefinitions)) loaded[name] = await load(definition);

const activities = loaded.activities;
const notes = loaded.notes;
const relations = loaded.relations;
const crosswalk = loaded.evidence;
unique(activities.map((row) => row.bm_line_id), "bm_line_id");
unique(activities.map((row) => `${row.source_id}\0${row.source_sheet}\0${row.source_excel_row}`), "linhagem de atividade");
unique(notes.map((row) => row["ID NFS-e"]), "ID NFS-e");
unique(notes.map((row) => `${row.Ano}\0${row["NFS-e"]}`), "Ano + NFS-e");
unique(relations.map((row) => row["ID NFS-e"]), "classificação NFS-e");
unique(crosswalk.map((row) => row.bm_project_id), "bm_project_id");
unique(crosswalk.map((row) => row.project_contract), "project_contract no crosswalk");

const activityProjects = new Set(activities.map((row) => row.project_contract));
const crosswalkProjects = new Set(crosswalk.map((row) => row.project_contract));
if (activityProjects.size !== 59 || crosswalkProjects.size !== 59 || [...activityProjects].some((value) => !crosswalkProjects.has(value))) {
  throw new Error("Os conjuntos de projetos das atividades e evidências não coincidem.");
}
if (new Set(activities.map((row) => row.bm)).size !== 32) throw new Error("Contagem de BMs incompatível.");
const noteIds = new Set(notes.map((row) => row["ID NFS-e"]));
if (relations.some((row) => !noteIds.has(row["ID NFS-e"]))) throw new Error("Classificação sem NFS-e correspondente.");
const noteById = new Map(notes.map((row) => [row["ID NFS-e"], row]));
for (const relation of relations) {
  const note = noteById.get(relation["ID NFS-e"]);
  if (!note || note.Ano !== relation.Ano || note["NFS-e"] !== relation["NFS-e"] ||
      note["Emissão"] !== relation["Emissão"] || brNumericOrNull(note["Valor NFS-e"]) !== brNumericOrNull(relation["Valor NFS-e"])) {
    throw new Error("Classificação financeira diverge da NFS-e canônica.");
  }
  if (boolOrNull(relation["Valor integral elegível no total do projeto"]) === null ||
      brNumericOrNull(relation["Valor relacionado verificado"]) === null) {
    throw new Error("Classificação financeira contém valor não interpretável.");
  }
}
if (activities.some((row) => numericOrNull(row.value_brl) === null) || notes.some((row) => numericOrNull(row["Valor NFS-e"]) === null)) {
  throw new Error("Valor monetário canônico não interpretável.");
}
if (activities.filter((row) => !timestampOrNull(row.activity_date)).length !== 19 ||
    activities.filter((row) => !timestampOrNull(row.month_period)).length !== 345) {
  throw new Error("Contagens de qualidade temporal incompatíveis.");
}

const projectByNormalizedTitle = new Map();
for (const row of crosswalk) {
  const key = normalizeTitle(row.project_contract);
  if (projectByNormalizedTitle.has(key)) throw new Error("Título de projeto ambíguo após normalização.");
  projectByNormalizedTitle.set(key, row.bm_project_id);
  const count = activities.filter((activity) => activity.project_contract === row.project_contract).length;
  if (count !== Number(row.bm_record_count)) throw new Error("Contagem de atividades por projeto incompatível.");
}

const evidenceRows = [];
const evidenceAssets = new Map();
for (const row of crosswalk) {
  let populated = 0;
  for (const slot of [1, 2]) {
    const hash = row[`candidate_${slot}_sha256`]?.trim();
    if (!hash) continue;
    populated += 1;
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("SHA-256 de evidência inválido.");
    const asset = {
      id: hash,
      sha256: hash,
      file_type: row[`candidate_${slot}_type`] || null,
      private_path: `sha256://${hash}`,
      access_level: "private",
      batch_id: null,
    };
    const prior = evidenceAssets.get(hash);
    if (!prior) evidenceAssets.set(hash, asset);
    evidenceRows.push({
      project_id: row.bm_project_id,
      evidence_asset_id: hash,
      batch_id: null,
      strength: row.link_strength || "não informado",
      rule_used: row.rule_used || null,
      caveat: row.caveats || null,
      status: row[`candidate_${slot}_hash_status`] || "candidato",
    });
  }
  if (populated !== Number(row.candidate_count)) throw new Error("candidate_count incompatível.");
}
unique(evidenceRows.map((row) => `${row.project_id}\0${row.evidence_asset_id}`), "vínculo projeto-evidência");
if (evidenceRows.length !== 72 || evidenceAssets.size !== 53) throw new Error("Contagem de evidências incompatível.");

const declaredNotes = notes.filter((row) => row["Projeto vinculado"]?.trim());
if (declaredNotes.length !== 31 || declaredNotes.some((row) => !projectByNormalizedTitle.has(normalizeTitle(row["Projeto vinculado"])))) {
  throw new Error("Projeto declarado em NFS-e sem correspondência canônica.");
}

const mappedCandidates = relations.filter((row) => projectByNormalizedTitle.has(normalizeTitle(row["Projeto auditado/candidato"]))).length;
if (mappedCandidates !== 21) throw new Error("Contagem de candidatos financeiros exatos incompatível.");
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ status: "validated", projects: 59, activities: 3364, fiscal_notes: 142, financial_relations: 142, evidence_assets: 53, evidence_links: 72, candidate_projects_mapped: mappedCandidates }));
  process.exit(0);
}

const sql = postgres({
  host: process.env.PGHOST ?? "db",
  port: Number(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE ?? "tria",
  username: process.env.PGUSER ?? "tria_app",
  password: await password(),
  max: 1,
  prepare: false,
});

try {
  await sql`SELECT pg_advisory_lock(7824002)`;
  const hashes = Object.values(sourceDefinitions).map((definition) => definition.sha256);
  const existing = await sql`SELECT source_type, sha256 FROM import_batch WHERE sha256 IN ${sql(hashes)}`;
  const expectedPairs = new Set(Object.values(sourceDefinitions).map((definition) => `${definition.type}:${definition.sha256}`));
  const existingPairsValid = existing.every((row) => expectedPairs.has(`${row.source_type}:${row.sha256}`));
  if (existing.length === hashes.length && existingPairsValid) {
    const counts = await sql`SELECT
      (SELECT count(*)::int FROM import_batch) batches,
      (SELECT count(*)::int FROM project) projects,
      (SELECT count(*)::int FROM bm_activity) activities,
      (SELECT count(DISTINCT bm_code)::int FROM bm_activity) bms,
      (SELECT count(*)::int FROM fiscal_note) notes,
      (SELECT count(*)::int FROM financial_relation) relations,
      (SELECT count(*)::int FROM evidence_asset) evidence_assets,
      (SELECT count(*)::int FROM project_evidence) evidence_links,
      (SELECT count(*)::int FROM financial_relation WHERE candidate_project_id IS NOT NULL) mapped_candidates,
      (SELECT count(*)::int FROM financial_relation WHERE full_value_eligible = false) ineligible_full_values,
      (SELECT bool_and(relative_path LIKE 'source://%') FROM import_batch) source_refs_opaque,
      (SELECT bool_and(private_path = 'sha256://' || sha256) FROM evidence_asset) evidence_refs_opaque`;
    const result = counts[0];
    if (result.batches !== 4 || result.projects !== 59 || result.activities !== 3364 || result.bms !== 32 ||
        result.notes !== 142 || result.relations !== 142 || result.evidence_assets !== 53 || result.evidence_links !== 72 ||
        result.mapped_candidates !== 21 || result.ineligible_full_values !== 142 ||
        result.source_refs_opaque !== true || result.evidence_refs_opaque !== true) {
      throw new Error("Carga existente não atende às invariantes canônicas.");
    }
    console.log(JSON.stringify({ status: "already_imported", projects: result.projects, activities: result.activities, notes: result.notes, evidence_links: result.evidence_links }));
  } else {
    if (existing.length || !existingPairsValid) throw new Error("Carga parcial ou lote divergente detectado; intervenção explícita necessária.");
    const occupied = await sql`SELECT (SELECT count(*)::int FROM project) projects, (SELECT count(*)::int FROM import_batch) batches`;
    if (occupied[0].projects || occupied[0].batches) throw new Error("Banco já contém outra carga; nenhuma substituição automática será feita.");

    const batchIds = Object.fromEntries(Object.entries(sourceDefinitions).map(([name]) => [name, randomUUID()]));
    for (const asset of evidenceAssets.values()) asset.batch_id = batchIds.evidence;
    for (const link of evidenceRows) link.batch_id = batchIds.evidence;
    await sql.begin(async (tx) => {
      const batches = Object.entries(sourceDefinitions).map(([name, definition]) => ({
        id: batchIds[name], source_type: definition.type, relative_path: definition.relativePath,
        sha256: definition.sha256, row_count: definition.rows, status: "completed",
        metadata: { delimiter: definition.delimiter, encoding: "utf-8-sig" },
      }));
      await tx`INSERT INTO import_batch ${tx(batches, "id", "source_type", "relative_path", "sha256", "row_count", "status", "metadata")}`;

      const projects = crosswalk.map((row) => ({
        id: row.bm_project_id, source_project_id: row.bm_project_id, title: row.project_contract,
        evidence_status: row.link_strength || "não localizado", import_batch_id: batchIds.activities,
      }));
      await tx`INSERT INTO project ${tx(projects, "id", "source_project_id", "title", "evidence_status", "import_batch_id")}`;
      await tx`INSERT INTO project_draft ${tx(projects.map((row) => ({ project_id: row.id, narrative: "", revision: 0 })), "project_id", "narrative", "revision")}`;

      const activityRows = activities.map((row) => ({
        id: row.bm_line_id, batch_id: batchIds.activities,
        project_id: projectByNormalizedTitle.get(normalizeTitle(row.project_contract)),
        source_id: row.source_id, source_sheet: row.source_sheet, source_excel_row: Number(row.source_excel_row),
        bm_code: row.bm, activity_date: timestampOrNull(row.activity_date), month_period: timestampOrNull(row.month_period),
        cost_center: row.cost_center || null, functionality: row.functionality ? redactPrivateText(row.functionality) : null, activity: row.activity ? redactPrivateText(row.activity) : null,
        duration_seconds: wholeNumberOrNull(row.duration_seconds), hourly_rate: numericOrNull(row.hourly_rate_brl),
        measured_value: row.value_brl,
        quality_status: {
          activity_date: timestampOrNull(row.activity_date) ? "valid" : "invalid_or_range",
          month_period: timestampOrNull(row.month_period) ? "valid" : row.month_period ? "invalid" : "missing",
          duration: wholeNumberOrNull(row.duration_seconds) ? "valid" : "missing",
          hourly_rate: numericOrNull(row.hourly_rate_brl) ? "valid" : row.hourly_rate_brl ? "invalid" : "missing",
          source_check: row.check || null,
        },
      }));
      await insertChunks(tx, "bm_activity", activityRows, ["id", "batch_id", "project_id", "source_id", "source_sheet", "source_excel_row", "bm_code", "activity_date", "month_period", "cost_center", "functionality", "activity", "duration_seconds", "hourly_rate", "measured_value", "quality_status"]);
      await tx`UPDATE project p SET
        date_start = a.date_start, date_end = a.date_end, bm_count = a.bm_count,
        activity_count = a.activity_count, hours_total = a.hours_total, value_total = a.value_total
        FROM (
          SELECT project_id, min(activity_date)::date date_start, max(activity_date)::date date_end,
            count(DISTINCT bm_code)::int bm_count, count(*)::int activity_count,
            sum(duration_seconds)::numeric / 3600 hours_total, sum(measured_value) value_total
          FROM bm_activity GROUP BY project_id
        ) a WHERE p.id = a.project_id`;

      const noteRows = notes.map((row) => ({
        id: stableId("nfs", row["ID NFS-e"]), batch_id: batchIds.notes, source_note_id: row["ID NFS-e"],
        issue_year: Number(row.Ano), note_number: row["NFS-e"], issue_date: row["Emissão"],
        amount: row["Valor NFS-e"], category: row.Categoria || null,
        declared_project_id: row["Projeto vinculado"] ? projectByNormalizedTitle.get(normalizeTitle(row["Projeto vinculado"])) : null,
      }));
      await tx`INSERT INTO fiscal_note ${tx(noteRows, "id", "batch_id", "source_note_id", "issue_year", "note_number", "issue_date", "amount", "category", "declared_project_id")}`;
      const noteIdBySource = new Map(noteRows.map((row) => [row.source_note_id, row.id]));
      const relationRows = relations.map((row) => ({
        batch_id: batchIds.relations,
        fiscal_note_id: noteIdBySource.get(row["ID NFS-e"]),
        candidate_project_id: projectByNormalizedTitle.get(normalizeTitle(row["Projeto auditado/candidato"])) ?? null,
        strength: row["Força do vínculo"] || "Sem relação verificável", state: row["Estado da relação"] || "Não informado",
        criterion: row["Critério reproduzível"] || null,
        full_value_eligible: boolOrNull(row["Valor integral elegível no total do projeto"]),
        verified_related_value: brNumericOrNull(row["Valor relacionado verificado"]),
        snapshot_1505_state: row["BI 15/05 — status"] || null, snapshot_3009_state: row["BI 30/09 — status"] || null,
      }));
      await tx`INSERT INTO financial_relation ${tx(relationRows, "batch_id", "fiscal_note_id", "candidate_project_id", "strength", "state", "criterion", "full_value_eligible", "verified_related_value", "snapshot_1505_state", "snapshot_3009_state")}`;
      await tx`INSERT INTO evidence_asset ${tx([...evidenceAssets.values()], "id", "sha256", "file_type", "private_path", "access_level", "batch_id")}`;
      await tx`INSERT INTO project_evidence ${tx(evidenceRows, "project_id", "evidence_asset_id", "batch_id", "strength", "rule_used", "caveat", "status")}`;


    });
    console.log(JSON.stringify({ status: "imported", projects: 59, activities: 3364, fiscal_notes: 142, evidence_assets: 53, evidence_links: 72, candidate_projects_mapped: mappedCandidates }));
  }
} finally {
  await sql`SELECT pg_advisory_unlock(7824002)`.catch(() => undefined);
  await sql.end();
}
