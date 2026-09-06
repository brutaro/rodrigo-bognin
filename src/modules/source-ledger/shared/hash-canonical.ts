import { createHash } from "node:crypto";

/** RFC 8785 / JSON Canonicalization Scheme. Arrays are never silently sorted. */
export const canonicalHashVersion = "rfc8785-jcs-v1" as const;

export type CanonicalArrayComparator = (left: unknown, right: unknown) => number;
export type CanonicalOptions = {
  arrayComparatorForPath?: (path: string) => CanonicalArrayComparator | undefined;
};

function compareUtf16(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalNumber(value: number) {
  if (!Number.isFinite(value)) throw new TypeError("JCS não aceita NaN ou infinito.");
  if (Object.is(value, -0)) return "0";
  const rendered = JSON.stringify(value);
  if (rendered === undefined) throw new TypeError("Número não serializável em JCS.");
  return rendered;
}

function canonicalize(value: unknown, path: string, options: CanonicalOptions): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new TypeError("JCS exige Unicode válido.");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "bigint") throw new TypeError("JCS não aceita BigInt.");
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("JCS não aceita valores indefinidos ou executáveis.");
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    const comparator = options.arrayComparatorForPath?.(path);
    if (!comparator) return `[${value.map((item,index)=>canonicalize(item, `${path}[${index}]`, options)).join(",")}]`;
    const sorted = value.slice().sort((left, right) => {
      const result = comparator(left, right);
      if (!Number.isFinite(result)) throw new TypeError(`Comparador inválido em ${path}.`);
      if (result !== 0) return result;
      const leftText = canonicalize(left, `${path}[]`, options);
      const rightText = canonicalize(right, `${path}[]`, options);
      if (leftText !== rightText) throw new TypeError(`Comparador não total em ${path}.`);
      return 0;
    });
    return `[${sorted.map((item, index) => canonicalize(item, `${path}[${index}]`, options)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort(compareUtf16);
  return `{${keys.map((key) => `${canonicalize(key, path, options)}:${canonicalize(object[key], `${path}.${key}`, options)}`).join(",")}}`;
}

export function canonicalStringify(value: unknown, options: CanonicalOptions = {}) {
  return canonicalize(value, "$", options);
}

export function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Canonical(value: unknown, options: CanonicalOptions = {}) {
  return sha256Text(canonicalStringify(value, options));
}

function importArrayComparator(path: string): CanonicalArrayComparator | undefined {
  const leaf = path.slice(path.lastIndexOf(".") + 1);
  if (leaf === "ignoredColumns") return (left, right) => compareUtf16(String(left), String(right));
  if (leaf === "ignored_columns") return (left, right) => compareUtf16(String(left), String(right));
  if (leaf === "headers") return (left, right) => Number((left as { ordinal?: number }).ordinal) - Number((right as { ordinal?: number }).ordinal);
  if (leaf === "headerMapping") return (left, right) => Number((left as { sourceOrdinal?: number }).sourceOrdinal) - Number((right as { sourceOrdinal?: number }).sourceOrdinal);
  if (leaf === "header_mapping") return (left, right) => Number((left as { sourceOrdinal?: number }).sourceOrdinal) - Number((right as { sourceOrdinal?: number }).sourceOrdinal);
  if (leaf === "mapping_selections") return (left, right) => Number((left as { sourceOrdinal?: number }).sourceOrdinal) - Number((right as { sourceOrdinal?: number }).sourceOrdinal);
  if (leaf === "rows") return (left, right) => compareUtf16(String((left as { locator?: string }).locator), String((right as { locator?: string }).locator));
  if (leaf === "fieldErrors") return (left, right) => compareUtf16(`${(left as { locator?: string }).locator ?? ""}:${(left as { fieldId?: string }).fieldId ?? ""}:${(left as { code?: string }).code ?? ""}`, `${(right as { locator?: string }).locator ?? ""}:${(right as { fieldId?: string }).fieldId ?? ""}:${(right as { code?: string }).code ?? ""}`);
  if (leaf === "conflicts") return (left, right) => compareUtf16(`${(left as { code?: string }).code}:${(left as { locator?: string }).locator ?? ""}`, `${(right as { code?: string }).code}:${(right as { locator?: string }).locator ?? ""}`);
  return undefined;
}

export function sha256ImportCanonical(value: unknown) {
  return sha256Canonical(value, { arrayComparatorForPath: importArrayComparator });
}
