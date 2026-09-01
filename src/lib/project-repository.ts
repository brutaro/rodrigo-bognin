import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { demoProjects, getDemoProject, type Project, type ProjectStatus } from "./demo-data";
import { getSql, isDatabaseConfigured } from "./database";
import { evidenceAvailability, relationLabel } from "./project-semantics";

export type ProjectSummary = {
  id: string; name: string; period: string; status: ProjectStatus; narrative: string;
  activityCount: number; evidenceCount: number;
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
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
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
    draft_updated_at: string | null; latest_publication_at: string | null;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text, p.activity_count,
      count(DISTINCT pe.evidence_asset_id)::int evidence_count,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(DISTINCT pub.id)::int publication_count, d.updated_at::text draft_updated_at,
      max(pub.created_at)::text latest_publication_at
    FROM project p LEFT JOIN project_evidence pe ON pe.project_id = p.id
    LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    GROUP BY p.id, d.narrative, d.revision, d.updated_at ORDER BY p.date_end DESC NULLS LAST, p.title`;
  return rows.map((row) => ({
    id: row.id, name: row.title, period: period(row.date_start, row.date_end),
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
    narrative: string; revision: string; publication_count: number; draft_updated_at: string | null; latest_publication_at: string | null;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(pub.id)::int publication_count, d.updated_at::text draft_updated_at, max(pub.created_at)::text latest_publication_at
    FROM project p LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    WHERE p.id = ${id} GROUP BY p.id, d.narrative, d.revision, d.updated_at`;
  const row = projects[0];
  if (!row) return undefined;
  const [activities, notes, evidence] = await Promise.all([
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
    sql<{ id: string; file_type: string | null; strength: string; status: string }[]>`
      SELECT e.id, e.file_type, pe.strength, pe.status FROM project_evidence pe
      JOIN evidence_asset e ON e.id = pe.evidence_asset_id WHERE pe.project_id = ${id} ORDER BY e.id`,
  ]);
  return {
    id: row.id, name: row.title, period: period(row.date_start, row.date_end),
    periodStart: row.date_start ?? "", periodEnd: row.date_end ?? "",
    status: status(row.publication_count, Number(row.revision), Boolean(row.draft_updated_at && row.latest_publication_at && new Date(row.draft_updated_at) > new Date(row.latest_publication_at))),
    narrative: row.narrative || "Narrativa ainda não registrada por Rodrigo.",
    activities: activities.map((item) => ({
      id: item.id, description: item.description || item.functionality || "Atividade registrada na fonte", bm: item.bm_code,
      hours: formatDuration(item.effective_duration_seconds), measuredValue: formatBrlDecimal(item.effective_measured_value),
      sourceHours: formatDuration(item.source_duration_seconds), sourceMeasuredValue: formatBrlDecimal(item.source_measured_value),
      adjustmentRevision: item.adjustment_revision, adjustmentOperation: item.adjustment_operation, adjusted: item.adjusted, adjustmentReason: item.adjustment_reason,
      adjustedBy: item.adjusted_by, adjustedAt: item.adjusted_at,
    })),
    financialReferences: notes.map((item) => {
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
    }),
    evidence: evidence.map((item, index) => ({
      id: item.id, name: `Evidência ${String(index + 1).padStart(2, "0")}`,
      kind: item.file_type || "Arquivo", availability: evidenceAvailability(item.status),
    })),
  };
}

export async function listFiscalNotes(): Promise<FiscalNoteSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getSql()<{
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
    LEFT JOIN project cp ON cp.id = n.candidate_project_id ORDER BY n.issue_date DESC, n.note_number, n.id`;
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
  }));
}

export async function listPublicationSummaries(): Promise<PublicationSummary[]> {
  if (!isDatabaseConfigured()) return [];
  return getSql()<PublicationSummary[]>`SELECT pub.id::text id, pub.project_id "projectId", p.title "projectTitle",
      pub.version, pub.created_at::text "createdAt", pub.content_hash "contentHash"
    FROM publication pub JOIN project p ON p.id = pub.project_id ORDER BY pub.created_at DESC`;
}
