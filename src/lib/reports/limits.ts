export const REPORT_STATEMENT_TIMEOUT_MS = 10_000;
export const MAX_REPORT_ROWS = 5_000;
export const REPORT_QUERY_LIMIT = MAX_REPORT_ROWS + 1;
export const MAX_TREND_MONTHS = 240;
export const MAX_REPORT_MODEL_BYTES = 8 * 1024 * 1024;
export const MAX_REPORT_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_REPORT_CELL_CHARACTERS = 1_000;

export class ReportLimitExceededError extends Error {
  constructor(message = "O relatório excede o limite operacional.") { super(message); this.name = "ReportLimitExceededError"; }
}

export function enforceReportRows(collections: ReadonlyArray<ReadonlyArray<unknown>>) {
  if (collections.some((rows) => rows.length >= REPORT_QUERY_LIMIT) ||
      collections.reduce((total, rows) => total + rows.length, 0) > MAX_REPORT_ROWS) throw new ReportLimitExceededError();
}

export function enforceReportModelSize(model: unknown) {
  if (Buffer.byteLength(JSON.stringify(model), "utf8") > MAX_REPORT_MODEL_BYTES) throw new ReportLimitExceededError();
}

export function enforceReportPdfSize(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_REPORT_PDF_BYTES) throw new ReportLimitExceededError();
}

export function assertReportCell(value: string) {
  if (value.length > MAX_REPORT_CELL_CHARACTERS) throw new ReportLimitExceededError("Uma célula do relatório excede o limite.");
  return value;
}

type TrendRow = { month_label: string; seconds: string };
export function fillMonthlyTrend(rows: TrendRow[]): TrendRow[] {
  if (!rows.length) return [];
  const parse = (value: string) => { const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value); if (!match) throw new ReportLimitExceededError(); return [Number(match[1]), Number(match[2])] as const; };
  const nonzero = rows.filter((row) => { try { return BigInt(row.seconds) !== 0n; } catch { throw new ReportLimitExceededError(); } });
  if (!nonzero.length) return [];
  const firstLabel = nonzero[0].month_label; const lastLabel = nonzero.at(-1)!.month_label;
  const boundedRows = rows.filter((row) => row.month_label >= firstLabel && row.month_label <= lastLabel);
  const [firstYear, firstMonth] = parse(firstLabel); const [lastYear, lastMonth] = parse(lastLabel);
  const count = (lastYear - firstYear) * 12 + lastMonth - firstMonth + 1;
  if (count < 1 || count > MAX_TREND_MONTHS) throw new ReportLimitExceededError("A tendência excede o intervalo permitido.");
  const values = new Map(boundedRows.map((row) => [row.month_label, row.seconds]));
  return Array.from({ length: count }, (_, index) => {
    const monthIndex = firstMonth - 1 + index; const year = firstYear + Math.floor(monthIndex / 12); const month = monthIndex % 12 + 1;
    const label = `${year}-${String(month).padStart(2, "0")}`;
    return { month_label: label, seconds: values.get(label) ?? "0" };
  });
}

export function chartBarWidth(value: number, maximum: number) {
  if (value === 0) return "0%";
  return `${Math.max(1, Math.abs(value) / Math.max(1, maximum) * 100)}%`;
}
