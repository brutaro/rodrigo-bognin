import type { StableRecord } from "../domain/reconciliation";
import { effectiveRecordContent, IGNORED_RECONCILIATION_FIELDS } from "../domain/reconciliation";

/** Functional values that the stable-record picker is allowed to search. */
export const STABLE_RECORD_SEARCH_EFFECTIVE_FIELDS = [
  "codigo",
  "referencia",
  "data",
  "valor",
  "duracao",
] as const;

export function normalizeStableRecordSearchQuery(query: string | undefined) {
  return (query ?? "").trim().toLowerCase();
}

export function escapePostgresLikeLiteral(query: string) {
  return query.replace(/[%_\\]/g, "\\$&");
}

export function stableRecordSearchAttributes(attributes: StableRecord["matchingAttributes"]) {
  return Object.fromEntries(Object.entries(attributes ?? {}).filter(([key]) =>
    !(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase())));
}

export function matchesStableRecordSearch(record: StableRecord, normalizedQuery: string) {
  if (record.state === "disregarded") return false;
  if (!normalizedQuery) return true;
  const effectivePayload = effectiveRecordContent(record).payload;
  const searchable = [
    record.id,
    ...Object.entries(stableRecordSearchAttributes(record.matchingAttributes)).flatMap(([key, value]) => [key, value]),
    ...STABLE_RECORD_SEARCH_EFFECTIVE_FIELDS.flatMap((key) => {
      const value = effectivePayload[key];
      return value === null || value === undefined ? [] : [value];
    }),
  ];
  return searchable.some((value) => String(value).toLowerCase().includes(normalizedQuery));
}
