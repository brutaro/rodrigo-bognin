import {contractMetrics} from '../contract-domain';
import { readCashProject, readCashProjects } from "../cash-repository";
import { aggregateCash, cashMoney, cashResultLabel, costConfirmationLabel } from "../cash-domain";
import { reimbursementLabel, type ReimbursementStatus } from "../reimbursement-status";
import "server-only";

import { createHash } from "node:crypto";
import { getSql, isDatabaseConfigured } from "../database";
import { formatBrlDecimal, formatDuration } from "../project-repository";
import type { GlobalReportModel, ProjectReportModel } from "./types";
import { assertReportCell, enforceReportModelSize, enforceReportRows, fillMonthlyTrend, REPORT_QUERY_LIMIT, REPORT_STATEMENT_TIMEOUT_MS } from "./limits";

export class ReportNotFoundError extends Error {}
export class ReportUnavailableError extends Error {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hashModel(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function date(value: string | null) { return value ?? "Não informada"; }
function period(start: string | null, end: string | null) { return `${date(start)} a ${date(end)}`; }
function provenance(row: { adjusted_by: string | null; adjusted_at: string | null; adjustment_reason: string | null }) {
  return row.adjusted_by ? `${row.adjusted_by} · ${row.adjusted_at ?? "sem horário"} · ${row.adjustment_reason ?? "sem motivo"}` : "Auditoria importada";
}
function state(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function valueText(value: unknown, fallback = "Não informado") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function reportDate(value: unknown) { const text = valueText(value, ""); return /^\d{4}-\d{2}-\d{2}/.test(text) ? `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}` : "Não informada"; }
function reportDateTime(value: string | null) {
  if (!value) return "Não informado";
  const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(parsed);
}
function projectLabel(value: unknown, labels: Map<string, string>) { const id = valueText(value, ""); return id ? labels.get(id) ?? "Outro projeto" : "Não informado"; }
function activityStateText(value: unknown) {
  const item = state(value); const duration = item.durationSeconds === null || item.durationSeconds === undefined ? null : String(item.durationSeconds);
  const measured = item.measuredValue === null || item.measuredValue === undefined ? null : String(item.measuredValue);
  return `Horas: ${formatDuration(duration)}; medição: ${formatBrlDecimal(measured)}`;
}
function fiscalStateText(value: unknown, labels: Map<string, string>) {
  const item = state(value); const eligible = item.fullValueEligible === true ? "Sim" : item.fullValueEligible === false ? "Não" : "Não informada";
  const amount = item.amount === null || item.amount === undefined ? null : String(item.amount);
  const related = item.verifiedRelatedValue === null || item.verifiedRelatedValue === undefined ? null : String(item.verifiedRelatedValue);
  const duplicates = Array.isArray(item.detectedDuplicateFiscalNoteIds) && item.detectedDuplicateFiscalNoteIds.length ? "Sim" : "Não";
  return `NFS-e: ${valueText(item.number ?? item.noteNumber)}; emissão: ${reportDate(item.issueDate)}; valor: ${formatBrlDecimal(amount)}; ` +
    `categoria: ${valueText(item.category)}; projeto declarado: ${projectLabel(item.declaredProjectId, labels)}; ` +
    `projeto candidato: ${projectLabel(item.candidateProjectId, labels)}; relação: ${valueText(item.strength)}; ` +
    `situação: ${valueText(item.relationState)}; critério: ${valueText(item.criterion)}; elegibilidade integral: ${eligible}; ` +
    `valor relacionado: ${formatBrlDecimal(related)}; duplicidade detectada: ${duplicates}`;
}
function numberFromSeconds(seconds: string) { const value = Number(seconds) / 3600; return Number.isFinite(value) ? value : 0; }
function formatCents(cents: string | null) {
  if (cents === null) return "Não informado";
  const value = BigInt(cents); const integer = value / 100n; const fraction = (value % 100n).toString().padStart(2, "0");
  return `R$ ${integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}

export async function readProjectReport(projectId: string): Promise<ProjectReportModel> {
  if (!isDatabaseConfigured()) throw new ReportUnavailableError();
  if (!projectId || projectId.length > 200) throw new ReportNotFoundError();
  try {
    const sql = getSql();
    const data = await sql.begin("read only isolation level repeatable read", async (tx) => {
      await tx`SELECT set_config('statement_timeout', ${String(REPORT_STATEMENT_TIMEOUT_MS)}, true)`;
      const [project] = await tx<{ id: string; title: string; date_start: string | null; date_end: string | null; narrative: string; generated_at: string }[]>`
        SELECT p.id, p.title, p.date_start::text, p.date_end::text, coalesce(d.narrative, '') narrative,
          transaction_timestamp()::text generated_at FROM project p LEFT JOIN project_draft d ON d.project_id = p.id WHERE p.id = ${projectId}`;
      if (!project) throw new ReportNotFoundError();
      const activities = await tx<{ id: string; description: string | null; functionality: string | null; bm_code: string;
        source_duration_seconds: string | null; effective_duration_seconds: string | null; source_measured_value: string;
        effective_measured_value: string | null; adjustment_revision: string; adjusted_by: string | null; adjusted_at: string | null; adjustment_reason: string | null }[]>`
        SELECT id, activity description, functionality, bm_code, source_duration_seconds::text, effective_duration_seconds::text,
          source_measured_value::text, effective_measured_value::text, adjustment_revision::text,
          adjusted_by, adjusted_at::text, adjustment_reason
        FROM effective_bm_activity WHERE project_id = ${projectId} ORDER BY activity_date NULLS LAST, id LIMIT ${REPORT_QUERY_LIMIT}`;
      const hours = await tx<{ bm_code: string; seconds: string }[]>`
        SELECT bm_code, coalesce(sum(effective_duration_seconds), 0)::text seconds FROM effective_bm_activity
        WHERE project_id = ${projectId} GROUP BY bm_code ORDER BY bm_code LIMIT ${REPORT_QUERY_LIMIT}`;
      const [financial] = await tx<{ measurement: string | null; invoiced: string | null; related: string | null; payments: string | null; reimbursements: string | null; manual_cost: string | null; manual_invoice: string | null; reported: string | null }[]>`
        SELECT
          (SELECT sum(effective_measured_value)::text FROM effective_bm_activity WHERE project_id = ${projectId}) measurement,
          (SELECT sum(amount)::text FROM effective_fiscal_note WHERE declared_project_id = ${projectId}) invoiced,
          (SELECT sum(verified_related_value)::text FROM effective_fiscal_note WHERE candidate_project_id = ${projectId}) related,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE project_id = ${projectId} AND kind = 'Pagamento') payments,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE project_id = ${projectId} AND kind = 'Reembolso') reimbursements,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE project_id = ${projectId} AND kind = 'Custo ou valor do projeto') manual_cost,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE project_id = ${projectId} AND kind = 'Nota ou cobrança') manual_invoice,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE project_id = ${projectId} AND kind = 'Valor informado') reported`;
      const evidence = await tx<{ id: string; file_type: string | null; status: string }[]>`
        SELECT e.id, e.file_type, pe.status FROM project_evidence pe JOIN evidence_asset e ON e.id = pe.evidence_asset_id
        WHERE pe.project_id = ${projectId} ORDER BY e.id LIMIT ${REPORT_QUERY_LIMIT}`;
      const activityHistory = await tx<{ activity_id: string; record_label: string; revision: string; operation: string; reason: string; actor: string; created_at: string; before_state: unknown; duration_seconds: string | null; measured_value: string | null }[]>`
        SELECT h.activity_id, coalesce(a.activity, a.functionality, 'Atividade registrada') record_label,
          h.revision::text, h.operation, h.reason, h.actor, h.created_at::text,
          h.before_state, h.duration_seconds::text, h.measured_value::text
        FROM owner_activity_adjustment_history h JOIN bm_activity a ON a.id = h.activity_id
        WHERE a.project_id = ${projectId} ORDER BY h.created_at DESC, h.revision DESC LIMIT ${REPORT_QUERY_LIMIT}`;
      const fiscalHistory = await tx<{ fiscal_note_id: string; revision: string; operation: string; reason: string; actor: string; created_at: string; before_state: unknown;
        issue_year: number; note_number: string; issue_date: string; amount: string; category: string | null; declared_project_id: string | null;
        candidate_project_id: string | null; strength: string; relation_state: string; criterion: string | null;
        full_value_eligible: boolean | null; verified_related_value: string | null; detected_duplicate_fiscal_note_ids: string[] }[]>`
        SELECT h.fiscal_note_id, h.revision::text, h.operation, h.reason, h.actor, h.created_at::text,
          h.before_state, h.issue_year, h.note_number, h.issue_date::text, h.amount::text, h.category,
          h.declared_project_id, h.candidate_project_id, h.strength, h.relation_state, h.criterion,
          h.full_value_eligible, h.verified_related_value::text, h.detected_duplicate_fiscal_note_ids
        FROM owner_fiscal_note_adjustment_history h
        WHERE h.declared_project_id = ${projectId} OR h.candidate_project_id = ${projectId}
          OR h.before_state->>'declaredProjectId' = ${projectId} OR h.before_state->>'candidateProjectId' = ${projectId}
        ORDER BY h.created_at DESC, h.revision DESC LIMIT ${REPORT_QUERY_LIMIT}`;
      const projectLabels = await tx<{ id: string; title: string }[]>`SELECT id, title FROM project ORDER BY id LIMIT ${REPORT_QUERY_LIMIT}`;
      const cashProject=await readCashProject(tx,projectId);
      const financialDocuments = await tx<Array<{id:string;kind:string;description:string;amount:string;title:string|null;version:number|null;reimbursement:ReimbursementStatus|null}>>`
        SELECT m.id::text,m.kind,m.description,m.amount_cents::text amount,d.title,v.version,
          CASE WHEN r.entry_id IS NULL THEN NULL ELSE jsonb_build_object('status',r.status,'receivedOn',r.received_on::text,'revision',r.revision::text) END reimbursement
        FROM manual_financial_entry m LEFT JOIN financial_entry_proof f ON f.entry_id=m.id
        LEFT JOIN file_version v ON v.id=f.file_version_id AND v.status='active'
        LEFT JOIN file_document d ON d.id=v.document_id AND d.status='active'
        LEFT JOIN current_reimbursement_status r ON r.entry_id=m.id
        WHERE m.project_id=${projectId} ORDER BY m.created_at,m.id LIMIT ${REPORT_QUERY_LIMIT}`;
      enforceReportRows([activities, hours, evidence, activityHistory, fiscalHistory, projectLabels, financialDocuments]);
      const [resource] = await tx`SELECT sum((r->>'amount')::numeric)::text amount FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id CROSS JOIN LATERAL jsonb_array_elements(i.rows) r WHERE r->>'project'=(SELECT coalesce(nullif(resource_source_title,''),title) FROM project WHERE id=${projectId})`;
      return { project, activities, hours, financial, evidence, activityHistory, fiscalHistory, projectLabels, resource, financialDocuments, cashProject };
    });
    const draft = {
      kind: "project" as const,
      cash: data.cashProject.result,
      project: { id: data.project.id, title: data.project.title, period: period(data.project.date_start, data.project.date_end), narrative: data.project.narrative },
      activities: data.activities.map((row) => ({ id: row.id, description: assertReportCell(row.description || row.functionality || "Atividade registrada"), bm: row.bm_code,
        sourceHours: formatDuration(row.source_duration_seconds), effectiveHours: formatDuration(row.effective_duration_seconds),
        sourceMeasurement: formatBrlDecimal(row.source_measured_value), effectiveMeasurement: formatBrlDecimal(row.effective_measured_value),
        revision: row.adjustment_revision, provenance: provenance(row) })),
      financialDocuments: data.financialDocuments.map(row=>({kind:row.kind,description:assertReportCell(row.description)+(data.cashProject.entries.find(e=>e.id===row.id)?.confirmation ? ` · ${costConfirmationLabel(row.kind,data.cashProject.entries.find(e=>e.id===row.id)?.confirmation)}` : "")+(row.kind === "Reembolso" ? ` · ${reimbursementLabel(row.reimbursement ?? undefined)}` : ""),amount:formatCents(row.amount),document:row.title ? `${assertReportCell(row.title)} · V${row.version}` : "Sem arquivo associado"})),
      hoursByBm: data.hours.map((row) => ({ label: row.bm_code, value: numberFromSeconds(row.seconds), displayValue: formatDuration(row.seconds) })),
      financialUniverses: [
        ...(data.cashProject.contract?contractMetrics(data.cashProject.contract).map(item=>({...item,explanation:"Contrato declarado: contratado menos recebimentos ativos. Referência: "+assertReportCell(data.cashProject.contract!.reference)})):[]),
        { name: "Base consolidada de recursos", value: formatBrlDecimal(data.resource.amount), explanation: "Aplicação registrada na planilha vigente. Referência separada; não somar às medições, notas ou pagamentos." },
        { name: "Medição de atividades", value: formatBrlDecimal(data.financial.measurement), explanation: "Valor efetivo medido nas atividades." },
        { name: "NFS-e declaradas", value: formatBrlDecimal(data.financial.invoiced), explanation: "Valor bruto fiscal declarado para o projeto." },
        { name: "Relação auditada", value: formatBrlDecimal(data.financial.related), explanation: "Valor relacionado verificado para o candidato auditado." },
        { name: "Custo manual do projeto", value: formatCents(data.financial.manual_cost), explanation: "Cadastro manual de custo ou valor." },
        { name: "Nota ou cobrança manual", value: formatCents(data.financial.manual_invoice), explanation: "Cadastro manual; não substitui o universo fiscal." },
        { name: "Reembolsos cadastrados (originais)", value: formatCents(data.financial.reimbursements), explanation: "Todos os lançamentos originais, inclusive desconsiderados. O recebido vigente está no resultado de caixa." },
        { name: "Pagamentos cadastrados (originais)", value: formatCents(data.financial.payments), explanation: "Todos os lançamentos originais, inclusive desconsiderados. A saída confirmada está no resultado de caixa." },
        { name: "Valor informado", value: formatCents(data.financial.reported), explanation: "Valor informado por XCON." },
      ],
      evidence: data.evidence.map((row, index) => ({ code: `EVD-${String(index + 1).padStart(3, "0")}`, type: row.file_type ?? "Arquivo", status: row.status })),
      history: (() => {
        const labels = new Map(data.projectLabels.map((item) => [item.id, item.title]));
        return [
          ...data.activityHistory.map((row) => ({ kind: "Atividade", record: row.record_label, revision: row.revision,
            operation: row.operation, reason: row.reason, actor: row.actor, occurredAt: reportDateTime(row.created_at),
            sortAt: row.created_at, before: activityStateText(row.before_state),
            after: activityStateText({ durationSeconds: row.duration_seconds, measuredValue: row.measured_value }) })),
          ...data.fiscalHistory.map((row) => ({ kind: "NFS-e", record: row.note_number, revision: row.revision,
            operation: row.operation, reason: row.reason, actor: row.actor, occurredAt: reportDateTime(row.created_at), sortAt: row.created_at,
            before: fiscalStateText(row.before_state, labels), after: fiscalStateText({ number: row.note_number,
              issueDate: row.issue_date, amount: row.amount, category: row.category, declaredProjectId: row.declared_project_id,
              candidateProjectId: row.candidate_project_id, strength: row.strength, relationState: row.relation_state,
              criterion: row.criterion, fullValueEligible: row.full_value_eligible, verifiedRelatedValue: row.verified_related_value,
              detectedDuplicateFiscalNoteIds: row.detected_duplicate_fiscal_note_ids }, labels) })),
        ].sort((a, b) => b.sortAt.localeCompare(a.sortAt)).map((entry) => ({ kind: entry.kind, record: entry.record,
          revision: entry.revision, operation: entry.operation, reason: entry.reason, actor: entry.actor,
          occurredAt: entry.occurredAt, before: entry.before, after: entry.after }));
      })(),
    };
    enforceReportModelSize(draft);
    const modelHash = hashModel(draft);
    return { ...draft, meta: { code: `TRIA-PROJ-${modelHash.slice(0, 12).toUpperCase()}`, generatedAt: data.project.generated_at, modelHash } };
  } catch (error) {
    if (error instanceof ReportNotFoundError) throw error;
    throw new ReportUnavailableError();
  }
}

export async function readGlobalReport(): Promise<GlobalReportModel> {
  if (!isDatabaseConfigured()) throw new ReportUnavailableError();
  try {
    const data = await getSql().begin("read only isolation level repeatable read", async (tx) => {
      await tx`SELECT set_config('statement_timeout', ${String(REPORT_STATEMENT_TIMEOUT_MS)}, true)`;
      const [meta] = await tx<{ generated_at: string; projects: string; activities: string; notes: string; evidence: string; adjusted: string }[]>`
        SELECT transaction_timestamp()::text generated_at, (SELECT count(*)::text FROM project) projects,
          (SELECT count(*)::text FROM effective_bm_activity) activities, (SELECT count(*)::text FROM effective_fiscal_note) notes,
          (SELECT count(*)::text FROM evidence_asset) evidence,
          ((SELECT count(*) FROM owner_activity_adjustment_history) + (SELECT count(*) FROM owner_fiscal_note_adjustment_history))::text adjusted`;
      const statuses = await tx<{ status: string; count: string }[]>`
        SELECT CASE WHEN EXISTS (SELECT 1 FROM publication pub WHERE pub.project_id = p.id)
            AND d.updated_at > (SELECT max(pub.created_at) FROM publication pub WHERE pub.project_id = p.id)
            THEN 'Publicado com alterações pendentes'
          WHEN EXISTS (SELECT 1 FROM publication pub WHERE pub.project_id = p.id) THEN 'Publicado'
          WHEN coalesce(d.revision, 0) > 0 THEN 'Pronto para revisar' ELSE 'Em trabalho' END status, count(*)::text
        FROM project p LEFT JOIN project_draft d ON d.project_id = p.id GROUP BY status ORDER BY status LIMIT ${REPORT_QUERY_LIMIT}`;
      const trend = await tx<{ month_label: string; seconds: string }[]>`
        SELECT to_char(date_trunc('month', activity_date), 'YYYY-MM') month_label, coalesce(sum(effective_duration_seconds), 0)::text seconds
        FROM effective_bm_activity WHERE activity_date IS NOT NULL GROUP BY date_trunc('month', activity_date) ORDER BY date_trunc('month', activity_date) LIMIT ${REPORT_QUERY_LIMIT}`;
      const portfolio = await tx<{ id: string; title: string; status: string; activities: string; seconds: string; measurement: string | null; invoiced: string | null; related: string | null; payments: string | null }[]>`
        SELECT p.id, p.title,
          CASE WHEN EXISTS (SELECT 1 FROM publication pub WHERE pub.project_id = p.id)
              AND d.updated_at > (SELECT max(pub.created_at) FROM publication pub WHERE pub.project_id = p.id)
              THEN 'Publicado com alterações pendentes'
            WHEN EXISTS (SELECT 1 FROM publication pub WHERE pub.project_id = p.id) THEN 'Publicado'
            WHEN coalesce(d.revision, 0) > 0 THEN 'Pronto para revisar' ELSE 'Em trabalho' END status,
          (SELECT count(*)::text FROM effective_bm_activity a WHERE a.project_id = p.id) activities,
          (SELECT coalesce(sum(effective_duration_seconds), 0)::text FROM effective_bm_activity a WHERE a.project_id = p.id) seconds,
          (SELECT sum(effective_measured_value)::text FROM effective_bm_activity a WHERE a.project_id = p.id) measurement,
          (SELECT sum(amount)::text FROM effective_fiscal_note n WHERE n.declared_project_id = p.id) invoiced,
          (SELECT sum(verified_related_value)::text FROM effective_fiscal_note n WHERE n.candidate_project_id = p.id) related,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry m WHERE m.project_id = p.id AND m.kind = 'Pagamento') payments
        FROM project p LEFT JOIN project_draft d ON d.project_id = p.id ORDER BY p.title LIMIT ${REPORT_QUERY_LIMIT}`;
      const [financial] = await tx<{ measurement: string | null; invoiced: string | null; related: string | null; payments: string | null; reimbursements: string | null; manual_cost: string | null; manual_invoice: string | null; reported: string | null }[]>`
        SELECT (SELECT sum(effective_measured_value)::text FROM effective_bm_activity) measurement,
          (SELECT sum(amount)::text FROM effective_fiscal_note) invoiced,
          (SELECT sum(verified_related_value)::text FROM effective_fiscal_note) related,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Pagamento') payments,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Reembolso') reimbursements,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Custo ou valor do projeto') manual_cost,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Nota ou cobrança') manual_invoice,
          (SELECT sum(amount_cents)::text FROM manual_financial_entry WHERE kind = 'Valor informado') reported`;
      enforceReportRows([statuses, trend, portfolio]);
      const [resource] = await tx`SELECT sum((r->>'amount')::numeric)::text amount FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id CROSS JOIN LATERAL jsonb_array_elements(i.rows) r`;
      const cashProjects=await readCashProjects(tx);
      return { cashProjects, meta, statuses, trend, portfolio, financial, resource };
    });
    const draft = { kind: "global" as const,
      cash: aggregateCash(data.cashProjects.map(p=>p.result)),
      projectCash: data.cashProjects.filter(p=>p.review).map(p=>({title:assertReportCell(p.title),result:p.result.resultCents===null ? "Não calculável" : `${cashResultLabel(p.result)}: ${cashMoney(p.result.resultCents)}`,cutoff:p.review?.cutoffDate ?? "Não conferido"})),
      coverage: [{ label: "Projetos", value: data.meta.projects }, { label: "Atividades", value: data.meta.activities }, { label: "NFS-e", value: data.meta.notes }, { label: "Evidências", value: data.meta.evidence }, { label: "Revisões de ajuste", value: data.meta.adjusted }],
      statuses: data.statuses.map((row) => ({ label: row.status, value: Number(row.count), displayValue: row.count })),
      trend: fillMonthlyTrend(data.trend).map((row) => ({ label: row.month_label, value: numberFromSeconds(row.seconds), displayValue: formatDuration(row.seconds) })),
      portfolio: data.portfolio.map((row) => ({ id: row.id, title: assertReportCell(row.title), status: row.status, activities: row.activities,
        effectiveHours: formatDuration(row.seconds), measurement: formatBrlDecimal(row.measurement), invoiced: formatBrlDecimal(row.invoiced),
        related: formatBrlDecimal(row.related), payments: formatCents(row.payments) })),
      financialUniverses: [
        { name: "Base consolidada de recursos", value: formatBrlDecimal(data.resource.amount), explanation: "Aplicação registrada na planilha vigente. Referência separada; não somar às medições, notas ou pagamentos." },
        { name: "Medição de atividades", value: formatBrlDecimal(data.financial.measurement), explanation: "Soma somente do universo de medição efetiva." },
        { name: "NFS-e brutas", value: formatBrlDecimal(data.financial.invoiced), explanation: "Soma somente do universo fiscal." },
        { name: "Relação auditada", value: formatBrlDecimal(data.financial.related), explanation: "Soma somente dos valores relacionados verificados." },
        { name: "Custo manual do projeto", value: formatCents(data.financial.manual_cost), explanation: "Soma somente dos custos/valores cadastrados manualmente." },
        { name: "Nota ou cobrança manual", value: formatCents(data.financial.manual_invoice), explanation: "Soma somente das notas/cobranças manuais; não substitui NFS-e." },
        { name: "Valor informado", value: formatCents(data.financial.reported), explanation: "Soma somente dos valores informados por XCON." },
        { name: "Reembolsos cadastrados (originais)", value: formatCents(data.financial.reimbursements), explanation: "Todos os lançamentos originais, inclusive desconsiderados. Consulte o caixa confirmado." },
        { name: "Pagamentos cadastrados (originais)", value: formatCents(data.financial.payments), explanation: "Todos os lançamentos originais, inclusive desconsiderados. Consulte o caixa confirmado." },
      ] };
    enforceReportModelSize(draft);
    const modelHash = hashModel(draft);
    return { ...draft, meta: { code: `TRIA-GLOBAL-${modelHash.slice(0, 12).toUpperCase()}`, generatedAt: data.meta.generated_at, modelHash } };
  } catch { throw new ReportUnavailableError(); }
}
