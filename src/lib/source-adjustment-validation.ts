export function parseDurationToSeconds(mode: string, value: string): string | null {
  if (mode === "missing") return null;
  if (mode !== "present") throw new Error("Informe se as horas estão presentes.");
  const match = /^(\d{1,12}):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error("Use horas no formato H:MM, inclusive acima de 24 horas.");
  const seconds = BigInt(match[1]) * 3600n + BigInt(match[2]) * 60n;
  if (seconds > 9_223_372_036_854_775_807n) throw new Error("A quantidade de horas é muito grande.");
  return seconds.toString();
}

function normalizeBrl(input: string, signed: boolean, integerDigits: number): string {
  let clean = input.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const negative = clean.startsWith("-");
  if (negative) clean = clean.slice(1);
  if ((!signed && negative) || !clean || !/^[0-9.,]+$/.test(clean)) throw new Error("Informe um valor BRL válido.");
  let integer: string;
  let fraction: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean)) {
    const parts = clean.split(","); integer = parts[0].replace(/\./g, ""); fraction = parts[1] ?? "";
  } else if (/^\d+(?:,\d{1,2})?$/.test(clean)) {
    const parts = clean.split(","); integer = parts[0]; fraction = parts[1] ?? "";
  } else if (/^\d+\.\d{1,2}$/.test(clean)) {
    [integer, fraction] = clean.split(".");
  } else throw new Error("Informe um valor BRL válido.");
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length > integerDigits) throw new Error("O valor é muito grande.");
  return `${negative ? "-" : ""}${integer}.${fraction.padEnd(2, "0") || "00"}`;
}

export function parseSignedBrlDecimal(mode: string, value: string): string | null {
  if (mode === "missing") return null;
  if (mode !== "present") throw new Error("Informe se a medição está presente.");
  return normalizeBrl(value, true, 14);
}

export function parseFiscalBrlDecimal(value: string): string {
  return normalizeBrl(value, false, 18);
}

export function parseOptionalFiscalBrlDecimal(value: string): string | null {
  return value.trim() ? normalizeBrl(value, false, 18) : null;
}

export function assertAdjustmentReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Informe um motivo entre 3 e 500 caracteres.");
  return reason;
}

export function assertRevision(value: string) {
  if (!/^\d+$/.test(value) || value.length > 19 || BigInt(value) > 9_223_372_036_854_775_807n) throw new Error("A revisão esperada é inválida.");
  return value;
}

export function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("A data de emissão é inválida.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("A data de emissão é inválida.");
  return value;
}

export function assertRequestId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("A identificação da tentativa é inválida.");
  }
  return value;
}

export function parseNullableText(value: string, maximum: number) {
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error("O texto informado é muito longo.");
  return normalized || null;
}

export function parseNullableProject(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 200) throw new Error("Projeto inválido.");
  return normalized;
}

export function parseTriState(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  if (value === "unknown") return null;
  throw new Error("Elegibilidade inválida.");
}
