import "server-only";

import { getSql, isDatabaseConfigured } from "./database";
import { formatBrlDecimal, formatDuration } from "./project-repository";

export class AdjustmentConflictError extends Error {
  constructor(public readonly current: { revision: string; hours?: string; measuredValue?: string; summary?: string }) {
    super("O registro mudou depois que o editor foi aberto."); this.name = "AdjustmentConflictError";
  }
}
export class DuplicateFiscalNoteError extends Error {
  constructor() { super("Já existe outra NFS-e com o mesmo ano e número."); this.name = "DuplicateFiscalNoteError"; }
}
export class AdjustmentUnavailableError extends Error {
  constructor() { super("A gravação está indisponível."); this.name = "AdjustmentUnavailableError"; }
}

type ActivityInput = { id: string; projectId: string; expectedRevision: string; requestId: string; reason: string; durationSeconds: string | null; measuredValue: string | null };
type FiscalInput = {
  id: string; expectedRevision: string; requestId: string; reason: string; issueYear: number; number: string; issueDate: string;
  amount: string; category: string | null; declaredProjectId: string | null; candidateProjectId: string | null;
  strength: string; relationState: string; criterion: string | null; fullValueEligible: boolean | null;
  verifiedRelatedValue: string | null; confirmDuplicate: boolean;
};

async function currentActivity(id: string) {
  const [row] = await getSql()<{ adjustment_revision: string; duration_seconds: string | null; measured_value: string | null }[]>`
    SELECT adjustment_revision::text, effective_duration_seconds::text duration_seconds,
      effective_measured_value::text measured_value FROM effective_bm_activity WHERE id = ${id}`;
  return row ? { revision: row.adjustment_revision, hours: formatDuration(row.duration_seconds), measuredValue: formatBrlDecimal(row.measured_value) } : { revision: "desconhecida" };
}

function databaseRequired() {
  if (!isDatabaseConfigured()) throw new AdjustmentUnavailableError();
}

export async function adjustActivity(input: ActivityInput) {
  databaseRequired();
  try {
    await getSql().begin(async (tx) => {
      const [activity] = await tx`SELECT project_id FROM effective_bm_activity WHERE id = ${input.id}`;
      if (!activity || activity.project_id !== input.projectId) throw new Error("A atividade não pertence a este projeto.");
      await tx`SELECT * FROM apply_owner_activity_adjustment(${input.id}, ${input.expectedRevision}, ${input.requestId},
        ${input.reason}, ${input.durationSeconds}, ${input.measuredValue})`;
    });
  } catch (error) {
    if (["40001", "23505"].includes((error as { code?: string }).code ?? "")) throw new AdjustmentConflictError(await currentActivity(input.id));
    if (["P0002", "22003", "22007", "22023", "23503"].includes((error as { code?: string }).code ?? "")) throw new Error("Os dados da atividade são inválidos.");
    throw error;
  }
}

export async function restoreActivity(input: Pick<ActivityInput, "id" | "projectId" | "expectedRevision" | "requestId" | "reason">) {
  databaseRequired();
  try {
    await getSql().begin(async (tx) => {
      const [activity] = await tx`SELECT project_id FROM effective_bm_activity WHERE id = ${input.id}`;
      if (!activity || activity.project_id !== input.projectId) throw new Error("A atividade não pertence a este projeto.");
      await tx`SELECT * FROM restore_owner_activity(${input.id}, ${input.expectedRevision}, ${input.requestId}, ${input.reason})`;
    });
  } catch (error) {
    if (["40001", "23505"].includes((error as { code?: string }).code ?? "")) throw new AdjustmentConflictError(await currentActivity(input.id));
    if (["P0002", "22003", "22007", "22023"].includes((error as { code?: string }).code ?? "")) throw new Error("Não foi possível restaurar a atividade.");
    throw error;
  }
}

export async function adjustFiscalNote(input: FiscalInput) {
  databaseRequired();
  try {
    await getSql().begin(async (tx) => {
      await tx`SELECT * FROM apply_owner_fiscal_note_adjustment(${input.id}, ${input.expectedRevision}, ${input.requestId},
        ${input.reason}, ${input.issueYear}::smallint, ${input.number}, ${input.issueDate}::date, ${input.amount}::numeric, ${input.category},
        ${input.declaredProjectId}, ${input.candidateProjectId}, ${input.strength}, ${input.relationState}, ${input.criterion},
        ${input.fullValueEligible}, ${input.verifiedRelatedValue}::numeric, ${input.confirmDuplicate})`;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "40001") {
      const [row] = await getSql()<{ adjustment_revision: string; issue_year: number; note_number: string; issue_date: string; amount: string;
        category: string | null; declared_project_id: string | null; candidate_project_id: string | null; strength: string;
        relation_state: string; criterion: string | null; full_value_eligible: boolean | null; verified_related_value: string | null }[]>`
        SELECT adjustment_revision::text, issue_year, note_number, issue_date::text, amount::text, category, declared_project_id,
          candidate_project_id, strength, relation_state, criterion, full_value_eligible, verified_related_value::text
        FROM effective_fiscal_note WHERE id = ${input.id}`;
      throw new AdjustmentConflictError({ revision: row?.adjustment_revision ?? "desconhecida",
        summary: row ? `Ano ${row.issue_year}; NFS-e ${row.note_number}; emissão ${row.issue_date}; valor ${formatBrlDecimal(row.amount)}; ` +
          `categoria ${row.category ?? "não informada"}; declarado ${row.declared_project_id ?? "não informado"}; ` +
          `candidato ${row.candidate_project_id ?? "não informado"}; relação ${row.strength}/${row.relation_state}; ` +
          `critério ${row.criterion ?? "não informado"}; elegibilidade integral ${row.full_value_eligible === true ? "sim" : row.full_value_eligible === false ? "não" : "não informada"}; ` +
          `valor relacionado ${formatBrlDecimal(row.verified_related_value)}` : undefined });
    }
    if (code === "23505" && error instanceof Error && error.message.includes("duplicate fiscal note requires confirmation")) throw new DuplicateFiscalNoteError();
    if (code === "23505") {
      const [row] = await getSql()<{ adjustment_revision: string }[]>`SELECT adjustment_revision::text FROM effective_fiscal_note WHERE id = ${input.id}`;
      throw new AdjustmentConflictError({ revision: row?.adjustment_revision ?? "desconhecida" });
    }
    if (["P0002", "22003", "22007", "22023", "23503", "23514"].includes(code ?? "")) throw new Error("Os dados da NFS-e ou da relação são inválidos.");
    throw error;
  }
}

export async function restoreFiscalNote(input: Pick<FiscalInput, "id" | "expectedRevision" | "requestId" | "reason" | "confirmDuplicate">) {
  databaseRequired();
  try {
    await getSql().begin(async (tx) => {
      await tx`SELECT * FROM restore_owner_fiscal_note(${input.id}, ${input.expectedRevision}, ${input.requestId}, ${input.reason}, ${input.confirmDuplicate})`;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "40001") {
      const [row] = await getSql()<{ adjustment_revision: string; issue_year: number; note_number: string; issue_date: string; amount: string;
        category: string | null; declared_project_id: string | null; candidate_project_id: string | null; strength: string;
        relation_state: string; criterion: string | null; full_value_eligible: boolean | null; verified_related_value: string | null }[]>`
        SELECT adjustment_revision::text, issue_year, note_number, issue_date::text, amount::text, category, declared_project_id,
          candidate_project_id, strength, relation_state, criterion, full_value_eligible, verified_related_value::text
        FROM effective_fiscal_note WHERE id = ${input.id}`;
      throw new AdjustmentConflictError({ revision: row?.adjustment_revision ?? "desconhecida",
        summary: row ? `Ano ${row.issue_year}; NFS-e ${row.note_number}; emissão ${row.issue_date}; valor ${formatBrlDecimal(row.amount)}; ` +
          `categoria ${row.category ?? "não informada"}; declarado ${row.declared_project_id ?? "não informado"}; ` +
          `candidato ${row.candidate_project_id ?? "não informado"}; relação ${row.strength}/${row.relation_state}; ` +
          `critério ${row.criterion ?? "não informado"}; elegibilidade integral ${row.full_value_eligible === true ? "sim" : row.full_value_eligible === false ? "não" : "não informada"}; ` +
          `valor relacionado ${formatBrlDecimal(row.verified_related_value)}` : undefined });
    }
    if (code === "23505" && error instanceof Error && error.message.includes("duplicate fiscal note requires confirmation")) throw new DuplicateFiscalNoteError();
    if (code === "23505") {
      const [row] = await getSql()<{ adjustment_revision: string }[]>`SELECT adjustment_revision::text FROM effective_fiscal_note WHERE id = ${input.id}`;
      throw new AdjustmentConflictError({ revision: row?.adjustment_revision ?? "desconhecida" });
    }
    if (["P0002", "22003", "22007", "22023", "23503", "23514"].includes(code ?? "")) throw new Error("Não foi possível restaurar a NFS-e.");
    throw error;
  }
}
