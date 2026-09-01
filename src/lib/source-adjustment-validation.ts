export function durationSecondsToInput(seconds: string | null) {
  if (seconds === null) return "";
  const total = BigInt(seconds); if (total < 0n) throw new Error("A duração é inválida.");
  const hours = total / 3600n; const minutes = total % 3600n / 60n; const rest = total % 60n;
  const base = `${hours}:${minutes.toString().padStart(2, "0")}`;
  return rest === 0n ? base : `${base}:${rest.toString().padStart(2, "0")}`;
}

export function parseDurationToSeconds(mode: string, value: string): string | null {
  if (mode === "missing") return null;
  if (mode !== "present") throw new Error("Informe se as horas estão presentes.");
  const match = /^(\d{1,12}):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) throw new Error("Use horas no formato H:MM ou H:MM:SS, inclusive acima de 24 horas.");
  const seconds = BigInt(match[1]) * 3600n + BigInt(match[2]) * 60n + BigInt(match[3] ?? "0");
  if (seconds > 9_223_372_036_854_775_807n) throw new Error("A quantidade de horas é muito grande.");
  return seconds.toString();
}

function normalizeBrl(input: string, signed: boolean, integerDigits: number, fractionDigits: number): string {
  let clean = input.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const negative = clean.startsWith("-");
  if (negative) clean = clean.slice(1);
  if ((!signed && negative) || !clean || !/^[0-9.,]+$/.test(clean)) throw new Error("Informe um valor BRL válido.");
  let integer: string;
  let fraction: string;
  const grouped = new RegExp(`^\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,${fractionDigits}})?$`);
  const plainComma = new RegExp(`^\\d+(?:,\\d{1,${fractionDigits}})?$`);
  const plainDot = new RegExp(`^\\d+\\.\\d{1,${fractionDigits}}$`);
  if (grouped.test(clean)) {
    const parts = clean.split(","); integer = parts[0].replace(/\./g, ""); fraction = parts[1] ?? "";
  } else if (plainComma.test(clean)) {
    const parts = clean.split(","); integer = parts[0]; fraction = parts[1] ?? "";
  } else if (plainDot.test(clean)) {
    [integer, fraction] = clean.split(".");
  } else throw new Error(`Informe um valor BRL válido com até ${fractionDigits} casas decimais.`);
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length > integerDigits) throw new Error("O valor é muito grande.");
  return `${negative ? "-" : ""}${integer}.${fraction || "0"}`;
}

export function parseSignedBrlDecimal(mode: string, value: string): string | null {
  if (mode === "missing") return null;
  if (mode !== "present") throw new Error("Informe se a medição está presente.");
  return normalizeBrl(value, true, 14, 16);
}

export function parseFiscalBrlDecimal(value: string): string {
  const normalized = normalizeBrl(value, false, 18, 2);
  const [integer, fraction] = normalized.split(".");
  return `${integer}.${fraction.padEnd(2, "0")}`;
}

export function parseOptionalFiscalBrlDecimal(value: string): string | null {
  return value.trim() ? parseFiscalBrlDecimal(value) : null;
}

function decimalUnits(value: string) {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(integer) * 10n ** 16n + BigInt(fraction.padEnd(16, "0"));
  return negative ? -units : units;
}

export function assertFiscalRelationTuple(input: {
  amount: string; candidateProjectId: string | null; relationStrength: string; relationState: string;
  criterion: string | null; fullValueEligible: boolean | null; verifiedRelatedValue: string | null;
}) {
  const amount = decimalUnits(input.amount);
  const related = input.verifiedRelatedValue === null ? null : decimalUnits(input.verifiedRelatedValue);
  if (!input.candidateProjectId && (input.relationStrength !== "Sem relação verificável" || input.relationState !== "Não informado" ||
      input.criterion !== null || input.fullValueEligible !== null || related !== null)) {
    throw new Error("Informe um projeto candidato antes dos dados de relação.");
  }
  if (related !== null && (related < 0n || related > amount)) throw new Error("O valor relacionado deve ficar entre zero e o valor da nota.");
  if (input.fullValueEligible === null && related !== null) throw new Error("Informe a elegibilidade do valor relacionado.");
  if (input.fullValueEligible === true && related !== amount) throw new Error("Elegibilidade integral exige o valor total da nota.");
  if (input.fullValueEligible === false && related === amount) throw new Error("Valor integral exige elegibilidade integral.");
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
