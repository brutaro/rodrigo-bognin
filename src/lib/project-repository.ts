import "server-only";

import { demoProjects, getDemoProject, type Project, type ProjectStatus } from "./demo-data";
import { getSql, isDatabaseConfigured } from "./database";
import { evidenceAvailability, relationLabel } from "./project-semantics";

export type ProjectSummary = {
  id: string;
  name: string;
  period: string;
  status: ProjectStatus;
  narrative: string;
  activityCount: number;
  evidenceCount: number;
};

export type FiscalNoteSummary = {
  id: string;
  year: number;
  number: string;
  issueDate: string;
  amount: string;
  category: string;
  declaredProjectId: string | null;
  declaredProject: string | null;
  relationStrength: string;
  relationState: string;
};

export type PublicationSummary = {
  id: string;
  projectId: string;
  projectTitle: string;
  version: number;
  createdAt: string;
  contentHash: string;
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
  const third = Number(fraction[2] ?? "0");
  if (third >= 5) cents += negative ? BigInt(-1) : BigInt(1);
  return cents;
}

function formatBrlDecimal(value: string | null) {
  if (value === null) return "Não informado";
  const cents = decimalToCents(value);
  const negative = cents < 0;
  const absolute = negative ? -cents : cents;
  const integer = absolute / BigInt(100);
  const decimal = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
}

function formatDuration(seconds: string | null) {
  if (seconds === null) return "Não informado";
  const total = BigInt(seconds);
  const hours = total / BigInt(3600);
  const minutes = (total % BigInt(3600)) / BigInt(60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function status(publicationCount: number, revision: number): ProjectStatus {
  if (publicationCount > 0) return "Publicado";
  if (revision > 0) return "Pronto para revisar";
  return "Em trabalho";
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  if (!isDatabaseConfigured()) {
    return demoProjects.map((project) => ({
      id: project.id,
      name: project.name,
      period: project.period,
      status: project.status,
      narrative: project.narrative,
      activityCount: project.activities.length,
      evidenceCount: project.evidence.length,
    }));
  }
  const sql = getSql();
  const rows = await sql<{
    id: string; title: string; date_start: string | null; date_end: string | null;
    activity_count: number; evidence_count: number; narrative: string; revision: string; publication_count: number;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text, p.activity_count,
      count(DISTINCT pe.evidence_asset_id)::int evidence_count,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(DISTINCT pub.id)::int publication_count
    FROM project p
    LEFT JOIN project_evidence pe ON pe.project_id = p.id
    LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    GROUP BY p.id, d.narrative, d.revision
    ORDER BY p.date_end DESC NULLS LAST, p.title`;
  return rows.map((row) => ({
    id: row.id,
    name: row.title,
    period: period(row.date_start, row.date_end),
    status: status(row.publication_count, Number(row.revision)),
    narrative: row.narrative || "Narrativa ainda não registrada por Rodrigo.",
    activityCount: row.activity_count,
    evidenceCount: row.evidence_count,
  }));
}

export async function getProjectDetails(id: string): Promise<Project | undefined> {
  if (!isDatabaseConfigured()) return getDemoProject(id);
  const sql = getSql();
  const projects = await sql<{
    id: string; title: string; date_start: string | null; date_end: string | null;
    narrative: string; revision: string; publication_count: number;
  }[]>`SELECT p.id, p.title, p.date_start::text, p.date_end::text,
      coalesce(d.narrative, '') narrative, coalesce(d.revision, 0)::text revision,
      count(pub.id)::int publication_count
    FROM project p LEFT JOIN project_draft d ON d.project_id = p.id
    LEFT JOIN publication pub ON pub.project_id = p.id
    WHERE p.id = ${id} GROUP BY p.id, d.narrative, d.revision`;
  const row = projects[0];
  if (!row) return undefined;
  const [activities, notes, evidence] = await Promise.all([
    sql<{ id: string; description: string | null; functionality: string | null; bm_code: string; duration_seconds: string | null; measured_value: string }[]>`
      SELECT id, activity description, functionality, bm_code, duration_seconds::text, measured_value::text
      FROM bm_activity WHERE project_id = ${id} ORDER BY activity_date NULLS LAST, id`,
    sql<{ id: string; note_number: string; amount: string; declared_project_id: string | null; candidate_project_id: string | null; strength: string | null; state: string | null; full_value_eligible: boolean | null; verified_related_value: string | null }[]>`
      SELECT DISTINCT n.id, n.note_number, n.amount::text, n.declared_project_id,
        r.candidate_project_id, r.strength, r.state, r.full_value_eligible,
        r.verified_related_value::text
      FROM fiscal_note n LEFT JOIN financial_relation r ON r.fiscal_note_id = n.id
      WHERE n.declared_project_id = ${id} OR r.candidate_project_id = ${id}
      ORDER BY n.note_number, n.id`,
    sql<{ id: string; file_type: string | null; strength: string; status: string }[]>`
      SELECT e.id, e.file_type, pe.strength, pe.status FROM project_evidence pe
      JOIN evidence_asset e ON e.id = pe.evidence_asset_id
      WHERE pe.project_id = ${id} ORDER BY e.id`,
  ]);
  return {
    id: row.id,
    name: row.title,
    period: period(row.date_start, row.date_end),
    periodStart: row.date_start ?? "",
    periodEnd: row.date_end ?? "",
    status: status(row.publication_count, Number(row.revision)),
    narrative: row.narrative || "Narrativa ainda não registrada por Rodrigo.",
    activities: activities.map((item) => ({
      id: item.id,
      description: item.description || item.functionality || "Atividade registrada na fonte",
      bm: item.bm_code,
      hours: formatDuration(item.duration_seconds),
      measuredValue: formatBrlDecimal(item.measured_value),
    })),
    financialReferences: notes.map((item) => {
      const auditedForProject = item.candidate_project_id === id;
      const relation = relationLabel(item.strength, auditedForProject);
      return {
        id: item.id,
        kind: "NFS-e" as const,
        label: item.note_number,
        amount: formatBrlDecimal(item.amount),
        relatedAmount: auditedForProject ? formatBrlDecimal(item.verified_related_value) : null,
        fullValueEligible: auditedForProject ? item.full_value_eligible : null,
        relationBasis: auditedForProject ? "Candidato auditado" as const : item.declared_project_id === id ? "Declarado na fonte" as const : "Sem vínculo de projeto" as const,
        relation,
        payment: "Não informado" as const,
      };
    }),
    evidence: evidence.map((item, index) => ({
      id: item.id,
      name: `Evidência ${String(index + 1).padStart(2, "0")}`,
      kind: item.file_type || "Arquivo",
      availability: evidenceAvailability(item.status),
    })),
  };
}

export async function listFiscalNotes(): Promise<FiscalNoteSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const sql = getSql();
  const rows = await sql<{
    id: string; issue_year: number; note_number: string; issue_date: string; amount: string;
    category: string | null; project_id: string | null; project_title: string | null; strength: string | null; state: string | null;
  }[]>`SELECT n.id, n.issue_year, n.note_number, n.issue_date::text, n.amount::text,
      n.category, p.id project_id, p.title project_title, r.strength, r.state
    FROM fiscal_note n LEFT JOIN project p ON p.id = n.declared_project_id
    LEFT JOIN financial_relation r ON r.fiscal_note_id = n.id
    ORDER BY n.issue_date DESC, n.note_number`;
  return rows.map((row) => ({
    id: row.id, year: row.issue_year, number: row.note_number, issueDate: row.issue_date,
    amount: formatBrlDecimal(row.amount), category: row.category || "Não informada",
    declaredProjectId: row.project_id, declaredProject: row.project_title, relationStrength: row.strength || "Sem relação verificável",
    relationState: row.state || "Não informado",
  }));
}

export async function listPublicationSummaries(): Promise<PublicationSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const sql = getSql();
  return sql<PublicationSummary[]>`SELECT pub.id::text id, pub.project_id "projectId", p.title "projectTitle",
      pub.version, pub.created_at::text "createdAt", pub.content_hash "contentHash"
    FROM publication pub JOIN project p ON p.id = pub.project_id
    ORDER BY pub.created_at DESC`;
}
