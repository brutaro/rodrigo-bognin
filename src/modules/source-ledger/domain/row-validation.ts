import type { HeaderMapping, SourceSchemaVersion } from "./import-contract";

export type FieldError = {
  code: "REQUIRED_FIELD" | "INVALID_DATE" | "INVALID_DECIMAL" | "INVALID_DURATION" | "FIELD_TOO_LONG" | "FIELD_COUNT";
  fieldId: string;
  locator: string;
  message: string;
  action: string;
  originalValue?: string;
};

export type ValidatedRow = {
  locator: string;
  sourceRowHash: string;
  normalizedPayload: Record<string, string | null>;
  sourceValues: Record<string, string>;
  decimalSources: Record<string, { source_text: string; source_scale: number; normalized_value: string | null }>;
  durationSources: Record<string, { source_text: string; unit: "minutes" | "clock" }>;
  status: "valid" | "rejected";
  fieldErrors: FieldError[];
};

function normalizeDecimal(value: string) {
  const source = value.trim();
  if (!/^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(source) || (source.includes(",") && source.includes("."))) return undefined;
  const normalized = source.replace(",", ".");
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  const canonicalInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  return `${negative ? "-" : ""}${canonicalInteger}${fraction === undefined ? "" : `.${fraction}`}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeDuration(value: string) {
  const source = value.trim();
  if (/^\d+$/.test(source)) return source;
  const match = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(source);
  return match ? `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}` : undefined;
}

export function validateRows(input: {
  rows: string[][];
  locators?: string[];
  headers: HeaderMapping[];
  schema: SourceSchemaVersion;
  rowHash: (row: {locator:string;sourceValues:Record<string,string>}) => string;
}) {
  const fields = new Map(input.schema.fields.map((field) => [field.id, field]));
  return input.rows.map((row, index) => {
    const locator = input.locators?.[index] ?? `row:${index + 2}`;
    const errors: FieldError[] = [];
    const normalizedPayload: Record<string, string | null> = {};
    const sourceValues: Record<string, string> = {};
    const decimalSources: Record<string, { source_text: string; source_scale: number; normalized_value: string | null }> = {};
    const durationSources: Record<string, { source_text: string; unit: "minutes" | "clock" }> = {};
    if (row.length !== input.headers.length) errors.push({ code: "FIELD_COUNT", fieldId: "_row", locator, message: "A quantidade de campos desta linha diverge do cabeçalho.", action: "Corrija a quantidade de colunas e tente novamente." });
    for (const mapping of input.headers) {
      const field = fields.get(mapping.logicalFieldId);
      if (!field) continue;
      const raw = row[mapping.sourceOrdinal] ?? "";
      const value = raw.trim();
      sourceValues[field.id] = raw;
      if (field.type === "decimal") decimalSources[field.id] = { source_text: raw, source_scale: value.split(/[.,]/)[1]?.length ?? 0, normalized_value: normalizeDecimal(value) ?? null };
      if (!value) {
        normalizedPayload[field.id] = null;
        if (field.required) errors.push({ code: "REQUIRED_FIELD", fieldId: field.id, locator, message: "O campo obrigatório está vazio.", action: "Preencha o campo e envie novamente." });
        continue;
      }
      if (field.maxCharacters && value.length > field.maxCharacters) {
        errors.push({ code: "FIELD_TOO_LONG", fieldId: field.id, locator, message: "O campo excede o limite do schema.", action: "Reduza o conteúdo do campo." });
        normalizedPayload[field.id] = null;
        continue;
      }
      if (field.type === "date") {
        if (!validDate(value)) errors.push({ code: "INVALID_DATE", fieldId: field.id, locator, message: "A data não está no formato válido.", action: "Use AAAA-MM-DD." });
        normalizedPayload[field.id] = validDate(value) ? value : null;
      } else if (field.type === "decimal") {
        const decimal = normalizeDecimal(value);
        if (decimal === undefined) errors.push({ code: "INVALID_DECIMAL", fieldId: field.id, locator, message: "O decimal não está no formato válido.", action: "Informe um número decimal sem símbolo de moeda." });
        normalizedPayload[field.id] = decimal ?? null;
        decimalSources[field.id] = { source_text: raw, source_scale: value.split(/[.,]/)[1]?.length ?? 0, normalized_value: decimal ?? null };
      } else if (field.type === "duration") {
        const duration = normalizeDuration(value);
        if (duration === undefined) errors.push({ code: "INVALID_DURATION", fieldId: field.id, locator, message: "A duração não está no formato válido.", action: "Use minutos ou HH:MM[:SS]." });
        else durationSources[field.id] = { source_text: raw, unit: value.includes(":") ? "clock" : "minutes" };
        normalizedPayload[field.id] = duration ?? null;
      } else {
        normalizedPayload[field.id] = value;
      }
    }
    return {
      locator,
      sourceRowHash: input.rowHash({locator,sourceValues}),
      normalizedPayload,
      sourceValues,
      decimalSources,
      durationSources,
      status: errors.length ? "rejected" as const : "valid" as const,
      fieldErrors: errors.map((error) => ({ ...error, originalValue: sourceValues[error.fieldId] ?? "" })),
    };
  });
}
