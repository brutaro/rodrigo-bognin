import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { demoProjects, getDemoProject, type Project, type ProjectStatus } from "./demo-data";
import { getSql, isDatabaseConfigured } from "./database";
import { relationLabel } from "./project-semantics";

export type ProjectSummary = {
  id: string; name: string; period: string; status: ProjectStatus; narrative: string;
  activityCount: number; evidenceCount: number; archived?: boolean; lastOpenedAt?: string | null;
};

export type ProjectOption = { id: string; title: string };

export type FiscalNoteSummary = {
  id: string;
  year: number; number: string; issueDate: string; amount: string; amountDecimal: string;
  category: string; categoryValue: string | null;
  declaredProjectId: string | null; declaredProject: string | null;
  candidateProjectId: string | null; candidateProject: string | null;
  relationStrength: string; relationState: string; criterion: string | null;
  fullValueEligible: boolean | null; verifiedRelatedValue: string | null; verifiedRelatedValueDecimal: string | null;
  source: {
    year: number; number: string; issueDate: string; amount: string; amountDecimal: string;
    category: string | null; declaredProjectId: string | null; candidateProjectId: string | null;
    relationStrength: string; relationState: string; criterion: string | null;
    fullValueEligible: boolean | null; verifiedRelatedValue: string | null;
  };
  adjustmentRevision: string; adjustmentOperation: "adjust" | "restore" | null; adjusted: boolean; adjustmentReason: string | null;
  adjustedBy: string | null; adjustedAt: string | null;
  adjustmentHistory: Array<{
    revision: string; operation: "adjust" | "restore"; reason: string; actor: string; adjustedAt: string;
    before: string; after: string;
  }>;
};

export type PublicationSummary = {
  id: string; projectId: string; projectTitle: string; version: number; createdAt: string; contentHash: string;
};

function period(start: string | null, end: string | null) {
  const format = (value: string | null) => value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : "data não informada";
  return `${format(start)} a ${format(end)}`;
}

function decimalToCents(value: string) {
  const [integerRaw, fractionRaw = ""] = value.split(".");
  const negative = integerRaw.startsWith("-");
  const integer = BigInt(integerRaw || "0");
  const fraction = `${fractionRaw}000`.slice(0, 3);
  let cents = integer * BigInt(100) + BigInt((negative ? fraction.slice(0, 2).replace(/\D/g, "") : fraction.slice(0, 2)) || "0") * (negative ? BigInt(-1) : BigInt(1));
  if (Number(fraction[2] ?? "0") >= 5) cents += negative ? BigInt(-1) : BigInt(1);
  return cents;
}

export function formatBrlDecimal(value: string | null) {
  if (value === null) return "Não informado";
  const cents = decimalToCents(value);
  const negative = cents < 0;
  const absolute = negative ? -cents : cents;
  const integer = absolute / BigInt(100);
  const decimal = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
}

export function formatDuration(seconds: string | null) {
  if (seconds === null) return "Não informado";
  const total = BigInt(seconds);
  const hours = total / BigInt(3600);
  const minutes = (total % BigInt(3600)) / BigInt(60);
  const remainingSeconds = total % BigInt(60);
  const base = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  return remainingSeconds === 0n ? base : `${base}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function status(publicationCount: number, revision: number, publicationStale = false): ProjectStatus {
  if (publicationCount > 0 && !publicationStale) return "Publicado";
  if (publicationCount > 0 && publicationStale) return "Pronto para revisar";
  if (revision > 0) return "Pronto para revisar";
  return "Em trabalho";
}

export async function listProjectOptions(): Promise<ProjectOption[]> {
  if (!isDatabaseConfigured()) return demoProjects.map((item) => ({ id: item.id, title: item.name }));
  return getSql()<ProjectOption[]>`SELECT id, title FROM project ORDER BY title`;
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  if (!isDatabaseConfigured()) return demoProjects.map((project) => ({
    id: project.id, name: project.name, period: project.period, status: project.status,
    narrative: project.narrative, activityCount: project.activities.length, evidenceCount: project.evidence.length,
  }));
  const rows = await getSql()<{
    id: string; title: string; date_start: string | null; date_end: string | null;
    activity_count: number; evidence_count: number; narrative: string; revision: string; publication_count: number;
    archived_at: string | null; last_opened_at: string | null; resource_source_title: string; metadata_revision: string; draft_updated_at: string | null; latest_publication_at: string | null;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text, p.archived_at::text, p.last_opened_at::text, p.resource_source_title, p.metadata_revision::text, p.activity_count,
      count(DISTINCT pe.evidence_asset_id)::int evidence_count,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(DISTINCT pub.id)::int publication_count, d.updated_at::text draft_updated_at,
      max(pub.created_at)::text latest_publication_at
    FROM project p LEFT JOIN project_evidence pe ON pe.project_id = p.id
    LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    GROUP BY p.id, d.narrative, d.revision, d.updated_at ORDER BY p.date_end DESC NULLS LAST, p.title`;
  return rows.map((row) => ({
    id: row.id, name: row.title, archived: Boolean(row.archived_at), lastOpenedAt: row.last_opened_at, sourceName: row.resource_source_title || row.title, metadataRevision: row.metadata_revision, period: period(row.date_start, row.date_end),
    status: status(row.publication_count, Number(row.revision), Boolean(row.draft_updated_at && row.latest_publication_at && new Date(row.draft_updated_at) > new Date(row.latest_publication_at))),
    narrative: row.narrative || "Narrativa ainda não registrada por Rodrigo.",
    activityCount: row.activity_count, evidenceCount: row.evidence_count,
  }));
}

export async function getProjectDetails(id: string, query?: Sql | TransactionSql): Promise<Project | undefined> {
  if (!isDatabaseConfigured()) return getDemoProject(id);
  const sql = query ?? getSql();
  const projects = await sql<{
    id: string; title: string; date_start: string | null; date_end: string | null;
    narrative: string; revision: string; publication_count: number; archived_at: string | null; last_opened_at: string | null; resource_source_title: string; metadata_revision: string; draft_updated_at: string | null; latest_publication_at: string | null;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text, p.archived_at::text, p.last_opened_at::text, p.resource_source_title, p.metadata_revision::text,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(pub.id)::int publication_count, d.updated_at::text draft_updated_at, max(pub.created_at)::text latest_publication_at
    FROM project p LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    WHERE p.id = ${id} GROUP BY p.id, d.narrative, d.revision, d.updated_at`;
  const row = projects[0];
  if (!row) return undefined;
  const [activities, notes, evidence, activityHistory] = await Promise.all([
    sql<{ id: string; description: string | null; functionality: string | null; bm_code: string;
      source_duration_seconds: string | null; source_measured_value: string; effective_duration_seconds: string | null;
      effective_measured_value: string | null; adjustment_revision: string; adjustment_operation: "adjust" | "restore" | null; adjusted: boolean;
      adjustment_reason: string | null; adjusted_by: string | null; adjusted_at: string | null }[]>`
      SELECT id, activity description, functionality, bm_code, source_duration_seconds::text,
        source_measured_value::text, effective_duration_seconds::text, effective_measured_value::text,
        adjustment_revision::text, adjustment_operation, adjusted, adjustment_reason, adjusted_by, adjusted_at::text
      FROM effective_bm_activity WHERE project_id = ${id} ORDER BY activity_date NULLS LAST, id`,
    sql<{ id: string; note_number: string; amount: string; source_amount: string;
      declared_project_id: string | null; source_declared_project_id: string | null;
      candidate_project_id: string | null; source_candidate_project_id: string | null;
      strength: string | null; relation_state: string | null; full_value_eligible: boolean | null;
      verified_related_value: string | null; adjustment_revision: string; adjustment_operation: "adjust" | "restore" | null; adjusted: boolean;
      adjustment_reason: string | null; adjusted_by: string | null; adjusted_at: string | null }[]>`
      SELECT id, note_number, amount::text, source_amount::text, declared_project_id,
        source_declared_project_id, candidate_project_id, source_candidate_project_id,
        strength, relation_state, full_value_eligible, verified_related_value::text,
        adjustment_revision::text, adjustment_operation, adjusted, adjustment_reason, adjusted_by, adjusted_at::text
      FROM effective_fiscal_note
      WHERE declared_project_id = ${id} OR candidate_project_id = ${id}
      ORDER BY note_number, id`,
    sql<{ id: string; file_type: string | null; strength: string; status: string; version_id: string | null;
      original_name: string | null; size_bytes: string | null; sha256: string }[]>`
      SELECT e.id, e.file_type, pe.strength, pe.status,
        CASE WHEN d.id IS NOT NULL THEN v.id::text END version_id,
        CASE WHEN d.id IS NOT NULL THEN v.original_name END original_name,
        CASE WHEN d.id IS NOT NULL THEN v.size_bytes::text END size_bytes, e.sha256
      FROM project_evidence pe JOIN evidence_asset e ON e.id = pe.evidence_asset_id
      LEFT JOIN file_version v ON v.evidence_asset_id = e.id AND v.status = 'active'
      LEFT JOIN file_document d ON d.id = v.document_id AND d.document_kind = 'evidence' AND d.status = 'active'
      WHERE pe.project_id = ${id} ORDER BY e.id`,
    sql<{ activity_id: string; revision: string; operation: "adjust" | "restore"; reason: string; actor: string; created_at: string;
      before_duration_seconds: string | null; before_measured_value: string | null; duration_seconds: string | null; measured_value: string | null }[]>`
      SELECT h.activity_id, h.revision::text, h.operation, h.reason, h.actor, h.created_at::text,
        h.before_state->>'durationSeconds' before_duration_seconds, h.before_state->>'measuredValue' before_measured_value,
        h.duration_seconds::text, h.measured_value::text
      FROM owner_activity_adjustment_history h JOIN bm_activity a ON a.id = h.activity_id
      WHERE a.project_id = ${id} ORDER BY h.activity_id, h.revision`,
  ]);
  const resource = await sql<{amount: string; applied_at: string; import_id: string}[]>`SELECT sum((r->>'amount')::numeric)::text amount, i.applied_at::text, i.id::text import_id
    FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id
    CROSS JOIN LATERAL jsonb_array_elements(i.rows) r WHERE r->>'project'=${row.resource_source_title || row.title} GROUP BY i.id`;
  const histories = new Map<string, Project["activities"][number]["adjustmentHistory"]>();
  for (const entry of activityHistory) {
    const list = histories.get(entry.activity_id) ?? [];
    list.push({ revision: entry.revision, operation: entry.operation, reason: entry.reason, actor: entry.actor, adjustedAt: entry.created_at,
      beforeHours: formatDuration(entry.before_duration_seconds), afterHours: formatDuration(entry.duration_seconds),
      beforeMeasuredValue: entry.before_measured_value === null ? "Não informado" : `${entry.before_measured_value} (${formatBrlDecimal(entry.before_measured_value)})`,
      afterMeasuredValue: entry.measured_value === null ? "Não informado" : `${entry.measured_value} (${formatBrlDecimal(entry.measured_value)})` });
    histories.set(entry.activity_id, list);
  }
  return {
    id: row.id, name: row.title, archived: Boolean(row.archived_at), lastOpenedAt: row.last_opened_at, sourceName: row.resource_source_title || row.title, metadataRevision: row.metadata_revision, period: period(row.date_start, row.date_end),
    periodStart: row.date_start ?? "", periodEnd: row.date_end ?? "",
    status: status(row.publication_count, Number(row.revision), Boolean(row.draft_updated_at && row.latest_publication_at && new Date(row.draft_updated_at) > new Date(row.latest_publication_at))),
    narrative: row.narrative || "Narrativa ainda não registrada por Rodrigo.",
    activities: activities.map((item) => ({
      id: item.id, description: item.description || item.functionality || "Atividade registrada na fonte", bm: item.bm_code,
      hours: formatDuration(item.effective_duration_seconds), measuredValue: formatBrlDecimal(item.effective_measured_value),
      durationSeconds: item.effective_duration_seconds, measuredValueDecimal: item.effective_measured_value,
      sourceHours: formatDuration(item.source_duration_seconds), sourceDurationSeconds: item.source_duration_seconds,
      sourceMeasuredValue: formatBrlDecimal(item.source_measured_value), sourceMeasuredValueDecimal: item.source_measured_value,
      adjustmentRevision: item.adjustment_revision, adjustmentOperation: item.adjustment_operation, adjusted: item.adjusted, adjustmentReason: item.adjustment_reason,
      adjustedBy: item.adjusted_by, adjustedAt: item.adjusted_at, adjustmentHistory: histories.get(item.id) ?? [],
    })),
    financialReferences: [...notes.map((item) => {
      const auditedForProject = item.candidate_project_id === id;
      return {
        id: item.id, kind: "NFS-e" as const, label: item.note_number, amount: formatBrlDecimal(item.amount),
        relatedAmount: auditedForProject ? formatBrlDecimal(item.verified_related_value) : null,
        fullValueEligible: auditedForProject ? item.full_value_eligible : null,
        relationBasis: auditedForProject ? "Candidato auditado" as const : item.declared_project_id === id ? "Declarado na fonte" as const : "Sem vínculo de projeto" as const,
        relation: relationLabel(item.strength, auditedForProject), payment: "Não informado" as const,
        sourceAmount: formatBrlDecimal(item.source_amount), sourceDeclaredProjectId: item.source_declared_project_id,
        sourceCandidateProjectId: item.source_candidate_project_id, adjustmentRevision: item.adjustment_revision,
        adjustmentOperation: item.adjustment_operation, adjusted: item.adjusted, adjustmentReason: item.adjustment_reason, adjustedBy: item.adjusted_by, adjustedAt: item.adjusted_at,
      };
    }), ...resource.map(item => ({id: `base-${item.import_id}`, kind: "Referência financeira" as const,
      label: `Aplicação de recursos — base de ${new Date(item.applied_at).toLocaleDateString("pt-BR")} (não somar às medições)`,
      amount: formatBrlDecimal(item.amount), relationBasis: "Declarado na fonte" as const,
      relation: "Sem relação confirmada" as const, payment: "Não informado" as const}))],
    evidence: evidence.map((item, index) => ({
      id: item.id, name: item.original_name || `Evidência ${String(index + 1).padStart(2, "0")}`,
      kind: item.file_type || "Arquivo",
      availability: item.version_id ? "Disponível" as const : "Pendente" as const,
      linkStrength: item.strength, linkStatus: item.status,
      versionId: item.version_id ?? undefined,
      sizeBytes: item.size_bytes === null ? undefined : Number(item.size_bytes),
      sha256: item.sha256,
    })),
  };
}

export async function listFiscalNotes(): Promise<FiscalNoteSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const sql = getSql();
  const [rows, fiscalHistory] = await Promise.all([
    sql<{
    id: string; issue_year: number; note_number: string; issue_date: string; amount: string; category: string | null;
    declared_project_id: string | null; declared_title: string | null; candidate_project_id: string | null; candidate_title: string | null;
    strength: string; relation_state: string; criterion: string | null; full_value_eligible: boolean | null; verified_related_value: string | null;
    source_issue_year: number; source_note_number: string; source_issue_date: string; source_amount: string; source_category: string | null;
    source_declared_project_id: string | null; source_candidate_project_id: string | null; source_strength: string | null;
    source_relation_state: string | null; source_criterion: string | null; source_full_value_eligible: boolean | null;
    source_verified_related_value: string | null; adjustment_revision: string; adjustment_operation: "adjust" | "restore" | null; adjusted: boolean;
    adjustment_reason: string | null; adjusted_by: string | null; adjusted_at: string | null;
  }[]>`SELECT n.id, n.issue_year, n.note_number, n.issue_date::text, n.amount::text, n.category,
      n.declared_project_id, dp.title declared_title, n.candidate_project_id, cp.title candidate_title,
      n.strength, n.relation_state, n.criterion, n.full_value_eligible, n.verified_related_value::text,
      n.source_issue_year, n.source_note_number, n.source_issue_date::text, n.source_amount::text, n.source_category,
      n.source_declared_project_id, n.source_candidate_project_id, n.source_strength, n.source_relation_state,
      n.source_criterion, n.source_full_value_eligible, n.source_verified_related_value::text,
      n.adjustment_revision::text, n.adjustment_operation, n.adjusted, n.adjustment_reason, n.adjusted_by, n.adjusted_at::text
    FROM effective_fiscal_note n LEFT JOIN project dp ON dp.id = n.declared_project_id
    LEFT JOIN project cp ON cp.id = n.candidate_project_id ORDER BY n.issue_date DESC, n.note_number, n.id`,
    sql<{ fiscal_note_id: string; revision: string; operation: "adjust" | "restore"; reason: string; actor: string; created_at: string;
      before_issue_year: string | null; before_note_number: string | null; before_issue_date: string | null; before_amount: string | null;
      before_category: string | null; before_declared: string | null; before_candidate: string | null; before_strength: string | null;
      before_relation_state: string | null; before_criterion: string | null; before_eligible: string | null; before_related: string | null;
      issue_year: string; note_number: string; issue_date: string; amount: string; category: string | null; declared_project_id: string | null;
      candidate_project_id: string | null; strength: string; relation_state: string; criterion: string | null;
      full_value_eligible: boolean | null; verified_related_value: string | null; detected_duplicate_fiscal_note_ids: string[] }[]>`
      SELECT fiscal_note_id, revision::text, operation, reason, actor, created_at::text,
        before_state->>'issueYear' before_issue_year, before_state->>'noteNumber' before_note_number,
        before_state->>'issueDate' before_issue_date, before_state->>'amount' before_amount,
        before_state->>'category' before_category, before_state->>'declaredProjectId' before_declared,
        before_state->>'candidateProjectId' before_candidate, before_state->>'strength' before_strength,
        before_state->>'relationState' before_relation_state, before_state->>'criterion' before_criterion,
        before_state->>'fullValueEligible' before_eligible, before_state->>'verifiedRelatedValue' before_related,
        issue_year::text, note_number, issue_date::text, amount::text, category, declared_project_id, candidate_project_id,
        strength, relation_state, criterion, full_value_eligible, verified_related_value::text, detected_duplicate_fiscal_note_ids
      FROM owner_fiscal_note_adjustment_history ORDER BY fiscal_note_id, revision`,
  ]);
  const stateSummary = (value: { year: string | null; number: string | null; date: string | null; amount: string | null; category: string | null;
    declared: string | null; candidate: string | null; strength: string | null; relationState: string | null; criterion: string | null;
    eligible: string | boolean | null; related: string | null }) =>
    `Ano ${value.year ?? "—"}; número ${value.number ?? "—"}; emissão ${value.date ?? "—"}; valor ${formatBrlDecimal(value.amount)}; ` +
    `categoria ${value.category ?? "—"}; declarado ${value.declared ?? "—"}; candidato ${value.candidate ?? "—"}; ` +
    `relação ${value.strength ?? "—"}/${value.relationState ?? "—"}; critério ${value.criterion ?? "—"}; ` +
    `integral ${value.eligible === true || value.eligible === "true" ? "sim" : value.eligible === false || value.eligible === "false" ? "não" : "não informado"}; relacionado ${formatBrlDecimal(value.related)}`;
  const histories = new Map<string, FiscalNoteSummary["adjustmentHistory"]>();
  for (const entry of fiscalHistory) {
    const list = histories.get(entry.fiscal_note_id) ?? [];
    list.push({ revision: entry.revision, operation: entry.operation, reason: entry.reason, actor: entry.actor, adjustedAt: entry.created_at,
      before: stateSummary({ year: entry.before_issue_year, number: entry.before_note_number, date: entry.before_issue_date,
        amount: entry.before_amount, category: entry.before_category, declared: entry.before_declared, candidate: entry.before_candidate,
        strength: entry.before_strength, relationState: entry.before_relation_state, criterion: entry.before_criterion,
        eligible: entry.before_eligible, related: entry.before_related }),
      after: stateSummary({ year: entry.issue_year, number: entry.note_number, date: entry.issue_date,
        amount: entry.amount, category: entry.category, declared: entry.declared_project_id, candidate: entry.candidate_project_id,
        strength: entry.strength, relationState: entry.relation_state, criterion: entry.criterion,
        eligible: entry.full_value_eligible, related: entry.verified_related_value }) +
        (entry.detected_duplicate_fiscal_note_ids.length ? `; duplicatas detectadas ${entry.detected_duplicate_fiscal_note_ids.join(", ")}` : "") });
    histories.set(entry.fiscal_note_id, list);
  }
  return rows.map((row) => ({
    id: row.id, year: row.issue_year, number: row.note_number, issueDate: row.issue_date,
    amount: formatBrlDecimal(row.amount), amountDecimal: row.amount,
    category: row.category || "Não informada", categoryValue: row.category,
    declaredProjectId: row.declared_project_id, declaredProject: row.declared_title,
    candidateProjectId: row.candidate_project_id, candidateProject: row.candidate_title,
    relationStrength: row.strength, relationState: row.relation_state, criterion: row.criterion,
    fullValueEligible: row.full_value_eligible,
    verifiedRelatedValue: formatBrlDecimal(row.verified_related_value), verifiedRelatedValueDecimal: row.verified_related_value,
    source: {
      year: row.source_issue_year, number: row.source_note_number, issueDate: row.source_issue_date,
      amount: formatBrlDecimal(row.source_amount), amountDecimal: row.source_amount,
      category: row.source_category, declaredProjectId: row.source_declared_project_id,
      candidateProjectId: row.source_candidate_project_id,
      relationStrength: row.source_strength || "Sem relação verificável",
      relationState: row.source_relation_state || "Não informado", criterion: row.source_criterion,
      fullValueEligible: row.source_full_value_eligible,
      verifiedRelatedValue: formatBrlDecimal(row.source_verified_related_value),
    },
    adjustmentRevision: row.adjustment_revision, adjustmentOperation: row.adjustment_operation, adjusted: row.adjusted,
    adjustmentReason: row.adjustment_reason, adjustedBy: row.adjusted_by, adjustedAt: row.adjusted_at,
    adjustmentHistory: histories.get(row.id) ?? [],
  }));
}

export async function listPublicationSummaries(): Promise<PublicationSummary[]> {
  if (!isDatabaseConfigured()) return [];
  return getSql()<PublicationSummary[]>`SELECT pub.id::text id, pub.project_id "projectId", p.title "projectTitle",
      pub.version, pub.created_at::text "createdAt", pub.content_hash "contentHash"
    FROM publication pub JOIN project p ON p.id = pub.project_id ORDER BY pub.created_at DESC`;
}
