import { createHash, randomUUID } from "node:crypto";
import type { Preview, PreviewConfirmation, PreviewRow } from "./dtos";
import { canonicalStringify, sha256Canonical, sha256ImportCanonical } from "../shared/hash-canonical";

/** Campos removidos pela transformação da Story 3.2. Nunca participam do hash funcional. */
export const IGNORED_RECONCILIATION_FIELDS = ["curso", "trilha"] as const;
/** Version emitted by the server-owned preview registry. */
export const SERVER_OWNED_RECONCILIATION_POLICY_VERSION = "server-owned-preview-matching-v1";

export type ReconciliationCategory = "inserted" | "updated" | "unchanged" | "rejected" | "conflict";
export type ReconciliationStatus = "draft" | "needs-decision" | "ready-to-apply" | "applied";
export type DecisionOutcome = "link" | "create" | "keep-current" | "reject";
export type MatchOutcome = "unique" | "none" | "multiple";

export type StableRecord = {
  /** Opaque identifier allocated by the application, never derived from source data. */
  id: string;
  state?: "active" | "disregarded";
  /** Attributes explicitly approved by a matching policy. They are not source IDs. */
  matchingAttributes?: Record<string, string>;
  sourcePayload?: Record<string, string | null>;
  adjustmentPayload?: Record<string, string | null>;
  auditedDecisionPayload?: Record<string, string | null>;
  sourceObservationId?: string;
  adjustmentEventId?: string;
  decisionEventId?: string;
  adjustmentRevision?: string;
  decisionVersion?: string;
  effectiveLayer?: "source" | "adjustment" | "decision";
  effectivePayload?: Record<string, string | null>;
  decimalSources?: Record<string, ExactDecimalSource>;
  durationSources?: Record<string, ExactDurationSource>;
  effectiveVersion?: string;
};

export type SourceObservation = {
  id: string;
  batchId: string;
  previewId: string;
  sourceFileId: string;
  locator: string;
  sourceRowHash: string;
  functionalHash: string;
  normalizedPayload: Record<string, string | null>;
  sourceValues: Record<string, string>;
  decimalSources: Record<string, { source_text: string; source_scale: number; normalized_value: string | null }>;
  durationSources?: Record<string, { source_text: string; unit: "minutes" | "clock" }>;
  observedAt: string;
  matchingAttributes?: Record<string, string>;
  stableRecordId?: string;
};

export type MatchingPolicy = {
  version: string;
  /** Only immutable, explicitly supplied attributes may be used. */
  fields: string[];
  evidence: "explicit-stable-attributes";
};

export type RecordMatch = {
  id: string;
  observationId: string;
  policyVersion: string;
  candidateIds: string[];
  /** Total candidates, kept separately so the public graph never carries an unbounded catalog. */
  candidateCount?: number;
  outcome: MatchOutcome;
  matchedRecordId?: string;
  reason: string;
};

export type ImportConflict = {
  id: string;
  observationId: string;
  code: "NO_CANDIDATE" | "MULTIPLE_CANDIDATES" | "PROTECTED_LAYER" | "DISREGARDED_RECORD" | "DUPLICATE_TARGET";
  candidateIds: string[];
  currentLayer?: "source" | "adjustment" | "decision";
  message: string;
  resolution?: DecisionOutcome;
};

export type ReconciliationDecision = {
  id: string;
  observationId: string;
  locator?: string;
  stableRecordId?: string;
  outcome: DecisionOutcome;
  actor: "Rodrigo";
  decidedAt: string;
  policyVersion: string;
  rationale: string;
  version: string;
  revisionNo?: number;
};

export type ReconciliationLine = {
  observation: SourceObservation;
  category: ReconciliationCategory;
  match: RecordMatch;
  stableRecordId?: string;
  fieldDiffs: Array<{ field: string; original: string | null; proposed: string | null; originalPresent?: boolean; proposedPresent?: boolean; provenanceKind?: "decimal-source" | "duration-source"; layer: "source" | "adjustment" | "decision" | "none"; cause: string }>;
  conflict?: ImportConflict;
  decision?: ReconciliationDecision;
  consequence: string;
};

export type AbsenceCoverage = {
  stableRecordId: string;
  status: "not_observed_this_batch";
  label: "Não observado neste lote";
  effectivePayload?: Record<string, string | null>;
  effectiveVersion?: string;
};

export type AbsenceCommitment = { rootHash: string; count: string; min: string | null; max: string | null; commitment: string };

export type ReconciliationSummary = Record<ReconciliationCategory, number> & {
  total: number;
  absent: number;
  pendingDecisions: number;
};

export type ReconciliationMetrics = {
  /** Totals keep the source scale and are serialized as decimal text. */
  decimalSums: Record<string, string>;
  /** Totals are exact integer seconds serialized as decimal text. */
  durationSums: Record<string, string>;
};

export type Reconciliation = {
  id: string;
  confirmationId: string;
  batchId: string;
  previewId: string;
  sourceFileId: string;
  sourceSha256: string;
  contractHash: string;
  transformationHash: string;
  previewHash: string;
  /** Exact immutable identity of confirmation + ordered preview + policy. */
  rootRequestHash: string;
  absenceCommitment: AbsenceCommitment;
  policy: MatchingPolicy;
  baseProjectionVersion: string;
  /** Frozen projection version when this reconciliation was applied. */
  projectionVersion?: string;
  status: ReconciliationStatus;
  lines: ReconciliationLine[];
  absences: AbsenceCoverage[];
  conflicts: ImportConflict[];
  decisions: ReconciliationDecision[];
  /** Opaque active IDs available for an explicit human link when matching is inconclusive. */
  availableStableRecordIds: string[];
  /** Safe, reproducible context for the explicit link selector. */
  availableStableRecords?: Array<{ id: string; matchingAttributes: Record<string, string>; effectiveLayer: "source" | "adjustment" | "decision"; effectivePayload: Record<string, string | null>; decimalSources?: Record<string, ExactDecimalSource>; durationSources?: Record<string, ExactDurationSource>; effectiveVersion?: string }>;
  parentReconciliationId?: string;
  revisionNo?: string;
  metrics?: ReconciliationMetrics;
  summary: ReconciliationSummary;
  fingerprint: string;
  createdAt: string;
  actor: "Rodrigo";
};

/** Public reconciliation graph. Absences and stable catalogs are always paged through dedicated endpoints. */
export type PublicReconciliation = Omit<Reconciliation, "absences" | "availableStableRecordIds" | "availableStableRecords" | "rootRequestHash" | "absenceCommitment">;

/** Ordering used by every consumer of the official reconciliation result. */
export type OfficialOrdering = { field: string; kind: "decimal" | "duration" | "text"; direction?: "asc" | "desc" };
export type OfficialComparableValue = string | ExactDecimalSource | ExactDurationSource | undefined;

/** Locale-independent lexical order used by hashes, tie-breakers and public reads. */
export function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rfc3339EpochNanoseconds(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("Timestamp RFC3339 inválido.");
  const [,year,month,day,hour,minute,second,fraction = "",zone] = match;
  const y=Number(year),mo=Number(month),d=Number(day),h=Number(hour),mi=Number(minute),s=Number(second),zoneHour=zone==="Z"?0:Number(zone.slice(1,3)),zoneMinute=zone==="Z"?0:Number(zone.slice(4,6));
  if(y<100||mo<1||mo>12||d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()||h>23||mi>59||s>59||zoneHour>23||zoneMinute>59)throw new Error("Timestamp RFC3339 inválido.");
  const millis = Date.UTC(y,mo-1,d,h,mi,s);
  const offsetMinutes = zone === "Z" ? 0 : (zone.startsWith("-") ? -1 : 1) * (zoneHour*60 + zoneMinute);
  return BigInt(millis - offsetMinutes*60_000)*1_000_000n + BigInt(fraction.padEnd(9,"0"));
}

export function compareRfc3339Instants(left: string, right: string) {
  const a=rfc3339EpochNanoseconds(left), b=rfc3339EpochNanoseconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isExactDecimalSource(value: OfficialComparableValue): value is ExactDecimalSource {
  return typeof value === "object" && value !== null && "normalized_value" in value && "source_scale" in value;
}

function isExactDurationSource(value: OfficialComparableValue): value is ExactDurationSource {
  return typeof value === "object" && value !== null && "source_text" in value && "unit" in value;
}

export function compareOfficialValues(left: OfficialComparableValue, right: OfficialComparableValue, kind: OfficialOrdering["kind"]) {
  const isAbsent = (value: OfficialComparableValue) => value === undefined || (isExactDecimalSource(value) && value.normalized_value === null);
  if (isAbsent(left) && isAbsent(right)) return 0;
  if (isAbsent(left)) return -1;
  if (isAbsent(right)) return 1;
  if (kind === "decimal") return compareExactDecimals(left as ExactDecimalSource | string, right as ExactDecimalSource | string);
  if (kind === "duration") {
    const a = isExactDurationSource(left) ? durationSourceToSeconds(left) : durationToSeconds(left as string);
    const b = isExactDurationSource(right) ? durationSourceToSeconds(right) : durationToSeconds(right as string);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return compareCanonicalText(String(left), String(right));
}

export function orderOfficialLines(lines: ReconciliationLine[], ordering?: OfficialOrdering, records?: StableRecord[]) {
  if (!ordering) return structuredClone(lines);
  const byId = new Map((records ?? []).map((record) => [record.id, record]));
  return [...lines].sort((left, right) => {
    const valueFor = (line: ReconciliationLine): OfficialComparableValue => {
      if (line.decision?.outcome === "keep-current" && line.stableRecordId) {
        const record = byId.get(line.stableRecordId);
        if (!record) return undefined;
        const content = effectiveRecordContent(record);
        if (ordering.kind === "decimal") return content.decimalSources?.[ordering.field];
        if (ordering.kind === "duration") return content.durationSources?.[ordering.field];
        return content.payload[ordering.field] ?? undefined;
      }
      if (ordering.kind === "decimal") return line.observation.decimalSources[ordering.field];
      if (ordering.kind === "duration") return line.observation.durationSources?.[ordering.field];
      return line.observation.normalizedPayload[ordering.field] ?? undefined;
    };
    const result = compareOfficialValues(valueFor(left), valueFor(right), ordering.kind);
    return (ordering.direction === "desc" ? -result : result) || compareCanonicalText(left.observation.locator, right.observation.locator);
  });
}

export type EffectiveRecordEvent = {
  id: string;
  reconciliationId?: string;
  batchId?: string;
  recordId: string;
  type: "record.inserted" | "observation.accepted" | "adjustment.revised" | "decision.audit";
  layer: "source" | "adjustment" | "decision";
  observationId?: string;
  payload: Record<string, string | null>;
  decimalSources?: Record<string, ExactDecimalSource>;
  durationSources?: Record<string, ExactDurationSource>;
  state?: "active" | "disregarded";
  actor: "Rodrigo";
  occurredAt: string;
  version: string;
  decisionId?: string;
  decisionRationale?: string;
  decisionVersion?: string;
  decisionDecidedAt?: string;
};

export type EffectiveRecordProjection = {
  recordId: string;
  payload: Record<string, string | null>;
  decimalSources?: Record<string, ExactDecimalSource>;
  durationSources?: Record<string, ExactDurationSource>;
  sourceObservationId?: string;
  adjustmentEventId?: string;
  decisionEventId?: string;
  observedBatchId?: string;
  state: "active" | "disregarded";
  version: string;
};

export type EffectiveSnapshot = {
  id: string;
  reconciliationId: string;
  batchId: string;
  projectionVersion: string;
  projection: EffectiveRecordProjection[];
  createdAt: string;
};

export type ExactDecimalSource = { source_text: string; source_scale: number; normalized_value: string | null };
export type ExactDurationSource = { source_text: string; unit: "minutes" | "clock" };

/** Normaliza o instante na mesma representação usada por timestamptz no PostgreSQL. */
export function canonicalTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Timestamp de decisão inválido.");
  return date.toISOString();
}

function decimalUnits(value: string, scale: number) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 100 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("Decimal de origem inválido.");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) throw new Error("A escala do decimal é menor que o valor de origem.");
  const units = BigInt(integer) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  return negative ? -units : units;
}

function decimalString(units: bigint, scale: number) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const factor = 10n ** BigInt(scale);
  const integer = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

/** Soma decimais usando BigInt e a maior escala original, sem conversão para number. */
export function sumExactDecimals(sources: ExactDecimalSource[]) {
  const present = sources.filter((source) => source.normalized_value !== null);
  const scale = present.reduce((maximum, source) => Math.max(maximum, source.source_scale), 0);
  const total = present.reduce((sum, source) => {
    if (source.normalized_value === null) return sum;
    const sourceUnits = decimalUnits(source.normalized_value, source.source_scale);
    return sum + sourceUnits * 10n ** BigInt(scale - source.source_scale);
  }, 0n);
  return decimalString(total, scale);
}

/** Compara dois decimais textuais exatamente, sem converter para ponto flutuante. */
export function compareExactDecimals(left: ExactDecimalSource | string, right: ExactDecimalSource | string) {
  const leftValue = typeof left === "string" ? { normalized_value: left, source_scale: left.includes(".") ? left.length - left.indexOf(".") - 1 : 0 } : left;
  const rightValue = typeof right === "string" ? { normalized_value: right, source_scale: right.includes(".") ? right.length - right.indexOf(".") - 1 : 0 } : right;
  if (leftValue.normalized_value === null || rightValue.normalized_value === null) throw new Error("Decimal nulo não pode ser ordenado.");
  const scale = Math.max(leftValue.source_scale, rightValue.source_scale);
  const a = decimalUnits(leftValue.normalized_value, leftValue.source_scale) * 10n ** BigInt(scale - leftValue.source_scale);
  const b = decimalUnits(rightValue.normalized_value, rightValue.source_scale) * 10n ** BigInt(scale - rightValue.source_scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

function durationToSeconds(value: string) {
  const source = value.trim();
  if (/^\d+$/.test(source)) return BigInt(source) * 60n;
  const match = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(source);
  if (!match) throw new Error("Duração de origem inválida.");
  // A two-part clock is MM:SS; a three-part clock is HH:MM:SS. This keeps
  // the official ordering unambiguous at the 59:59/1:00:01 boundary.
  return match[3] === undefined
    ? BigInt(match[1]) * 60n + BigInt(match[2])
    : BigInt(match[1]) * 3600n + BigInt(match[2]) * 60n + BigInt(match[3]);
}

/** Soma durações como segundos inteiros; entrada sem dois-pontos representa minutos. */
export function sumExactDurations(values: string[]) {
  return values.reduce((sum, value) => sum + durationToSeconds(value), 0n).toString();
}

function durationSourceToSeconds(value: ExactDurationSource) {
  const source = value.source_text.trim();
  if (value.unit === "minutes") {
    if (!/^\d+$/.test(source)) throw new Error("Duração em minutos inválida.");
    return BigInt(source) * 60n;
  }
  return durationToSeconds(source);
}

export function sumTypedDurations(values: ExactDurationSource[]) {
  return values.reduce((sum, value) => sum + durationSourceToSeconds(value), 0n).toString();
}

/** Compara durações textuais sem perder segundos nem aceitar arredondamento implícito. */
export function compareExactDurations(left: string, right: string) {
  const a = durationToSeconds(left);
  const b = durationToSeconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatExactDurationSeconds(seconds: string) {
  const total = BigInt(seconds);
  if (total < 0n) throw new Error("Duração negativa não é permitida.");
  const hours = total / 3600n;
  const minutes = total % 3600n / 60n;
  const rest = total % 60n;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

const prohibitedFieldPattern = /(?:^|[_-])(?:id|source.?id|locator|position|ordinal|row.?hash|hash|valor|value|horas|hours|texto|text|descricao|description|codigo|code|data|date)(?:$|[_-])/i;

function clonePayload(payload: Record<string, string | null> | undefined) {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase())) result[key] = value;
  }
  return result;
}

function cloneTypedSources<T>(sources: Record<string, T> | undefined) {
  if (sources === undefined) return undefined;
  return Object.fromEntries(Object.entries(sources).filter(([key]) => !(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase()))) as Record<string, T>;
}

function validateStableAttributes(attributes: Record<string, string> | undefined) {
  for (const key of Object.keys(attributes ?? {})) {
    if ((IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase())) throw new Error(`O atributo ${key} é reservado e não pode definir identidade.`);
  }
}

function equalPayload(left: Record<string, string | null> | undefined, right: Record<string, string | null> | undefined) {
  return sha256ImportCanonical(clonePayload(left)) === sha256ImportCanonical(clonePayload(right));
}

function equalMetadata<T extends object>(left: T | undefined, right: T | undefined) {
  // Undefined is legacy/unknown provenance. It is not the same assertion as an
  // explicitly empty object, which means that the accepted source cleared all
  // typed provenance for this payload.
  if (left === undefined || right === undefined) return left === right;
  return sha256ImportCanonical(left) === sha256ImportCanonical(right);
}

export type EffectiveRecordContent = {
  payload: Record<string, string | null>;
  decimalSources?: Record<string, ExactDecimalSource>;
  durationSources?: Record<string, ExactDurationSource>;
  layer: "source" | "adjustment" | "decision";
  version?: string;
};

/** Canonical effective state used by classification, metrics, ordering and adapters. */
export function effectiveRecordContent(record: StableRecord): EffectiveRecordContent {
  const selected = record.auditedDecisionPayload !== undefined
    ? { payload: record.auditedDecisionPayload, layer: "decision" as const }
    : record.adjustmentPayload !== undefined
      ? { payload: record.adjustmentPayload, layer: "adjustment" as const }
      : record.effectivePayload !== undefined
        ? { payload: record.effectivePayload, layer: record.effectiveLayer ?? "source" }
        : { payload: record.sourcePayload, layer: "source" as const };
  return {
    payload: clonePayload(selected.payload),
    ...(record.decimalSources !== undefined ? { decimalSources: structuredClone(cloneTypedSources(record.decimalSources)!) } : {}),
    ...(record.durationSources !== undefined ? { durationSources: structuredClone(cloneTypedSources(record.durationSources)!) } : {}),
    layer: selected.layer,
    ...(record.effectiveVersion !== undefined ? { version: String(record.effectiveVersion) } : {}),
  };
}

function equalRecordContent(observation: SourceObservation, record: StableRecord) {
  const current = effectiveRecordContent(record);
  return equalPayload(current.payload, observation.normalizedPayload) &&
    equalMetadata(current.decimalSources, observation.decimalSources) &&
    equalMetadata(current.durationSources, observation.durationSources);
}

function effectivePayload(record: StableRecord) {
  const current = effectiveRecordContent(record);
  return { payload: current.payload, layer: current.layer };
}

function validatePolicy(policy: MatchingPolicy) {
  if (!policy.version || policy.evidence !== "explicit-stable-attributes") {
    throw new Error("A política de correspondência precisa declarar sua versão e evidência.");
  }
  if (new Set(policy.fields).size !== policy.fields.length) throw new Error("A política de correspondência não pode repetir atributos.");
  for (const field of policy.fields) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(field) || prohibitedFieldPattern.test(field) || (IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(field.toLowerCase())) {
      throw new Error(`O campo ${field} não pode definir identidade permanente.`);
    }
  }
}

function matchingAttributes(observation: SourceObservation, fieldNames: string[]) {
  if (fieldNames.length === 0) return undefined;
  const attributes = observation.matchingAttributes;
  if (!attributes) return undefined;
  const selected = Object.fromEntries(fieldNames.map((field) => [field, attributes[field]]));
  return Object.values(selected).every((value) => typeof value === "string" && value.length > 0) ? selected : undefined;
}

export function createStableRecordId() {
  return randomUUID();
}

function deterministicUuid(seed: unknown) {
  const digest = sha256ImportCanonical(seed);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function createSourceObservation(input: Omit<SourceObservation, "id" | "functionalHash">) {
  validateStableAttributes(input.matchingAttributes);
  const normalizedPayload = clonePayload(input.normalizedPayload);
  return {
    ...structuredClone(input),
    id: randomUUID(),
    normalizedPayload,
    sourceValues: Object.fromEntries(Object.entries(input.sourceValues).filter(([key]) => !(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase()))),
    decimalSources: Object.fromEntries(Object.entries(input.decimalSources).filter(([key]) => !(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase()))),
    ...(input.durationSources ? { durationSources: Object.fromEntries(Object.entries(input.durationSources).filter(([key]) => !(IGNORED_RECONCILIATION_FIELDS as readonly string[]).includes(key.toLowerCase()))) } : {}),
    functionalHash: sha256ImportCanonical({ normalized_payload: normalizedPayload }),
  } satisfies SourceObservation;
}

export const MAX_PUBLIC_CANDIDATE_IDS = 50;

function matchingIndex(records: StableRecord[], policy: MatchingPolicy) {
  const index = new Map<string, StableRecord[]>();
  for (const record of records) {
    const key = policy.fields.map((field) => record.matchingAttributes?.[field] ?? "").join("\u0000");
    const bucket = index.get(key);
    if (bucket) bucket.push(record);
    else index.set(key, [record]);
  }
  return index;
}

export function createRecordMatchResolver(records: StableRecord[], policy: MatchingPolicy) {
  validatePolicy(policy);
  const index = matchingIndex(records, policy);
  return (observation: SourceObservation): RecordMatch => {
    const attributes = matchingAttributes(observation, policy.fields);
    const candidates = attributes ? (index.get(policy.fields.map((field) => attributes[field]).join("\u0000")) ?? []) : [];
    const sortedIds = candidates.map((record) => record.id).sort();
    const outcome: MatchOutcome = candidates.length === 1 ? "unique" : candidates.length === 0 ? "none" : "multiple";
    return {
      id: randomUUID(), observationId: observation.id, policyVersion: policy.version,
      candidateIds: sortedIds.slice(0, MAX_PUBLIC_CANDIDATE_IDS), candidateCount: sortedIds.length, outcome,
      ...(candidates.length === 1 ? { matchedRecordId: candidates[0].id } : {}),
      reason: attributes ? outcome === "unique" ? "Atributos estáveis comprovam um candidato único." : outcome === "multiple" ? "Mais de um registro possui os atributos estáveis." : "Nenhum registro possui os atributos estáveis." : "A observação não trouxe evidência estável suficiente.",
    };
  };
}

export function buildRecordMatch(observation: SourceObservation, records: StableRecord[], policy: MatchingPolicy): RecordMatch {
  return createRecordMatchResolver(records, policy)(observation);
}

function makeConflict(observation: SourceObservation, match: RecordMatch, code: ImportConflict["code"], message: string, currentLayer?: ImportConflict["currentLayer"]): ImportConflict {
  return { id: randomUUID(), observationId: observation.id, code, candidateIds: [...match.candidateIds], ...(currentLayer ? { currentLayer } : {}), message };
}

function sha256Bytes(...parts: Uint8Array[]) { const hash=createHash("sha256"); for (const part of parts) hash.update(part); return hash.digest(); }
function uuidBytes(value: string) { return Buffer.from(value.replaceAll("-",""),"hex"); }
function int16Bytes(value: number) { const b=Buffer.alloc(2);b.writeInt16BE(value);return b; }
function int64Bytes(value: bigint) { const b=Buffer.alloc(8);b.writeBigInt64BE(value);return b; }
const ABSENCE_EMPTY_HASH=sha256Bytes(Buffer.from("TRIA/source-reconciliation/absence-avl/empty/v1","utf8"));
type AuthenticatedAbsenceNode={ key:string;item:AbsenceCoverage;left?:AuthenticatedAbsenceNode;right?:AuthenticatedAbsenceNode;height:number;count:bigint;min:string;max:string;hash:Buffer };
function balancedAbsenceNode(items: AbsenceCoverage[],lo=0,hi=items.length-1):AuthenticatedAbsenceNode|undefined {
  if(lo>hi)return undefined;const mid=Math.floor((lo+hi)/2),item=items[mid],left=balancedAbsenceNode(items,lo,mid-1),right=balancedAbsenceNode(items,mid+1,hi);
  const height=Math.max(left?.height??0,right?.height??0)+1,count=(left?.count??0n)+(right?.count??0n)+1n,min=left?.min??item.stableRecordId,max=right?.max??item.stableRecordId;
  const normalized=JSON.parse(JSON.stringify(item)) as AbsenceCoverage;
  const hash=sha256Bytes(Buffer.from("TRIA/source-reconciliation/absence-avl/node/v1","utf8"),uuidBytes(item.stableRecordId),sha256Bytes(Buffer.from(canonicalStringify(normalized),"utf8")),left?.hash??ABSENCE_EMPTY_HASH,right?.hash??ABSENCE_EMPTY_HASH,int16Bytes(height),int64Bytes(count),uuidBytes(min),uuidBytes(max));
  return {key:item.stableRecordId,item:normalized,left,right,height,count,min,max,hash};
}
export function absenceCommitmentFor(absences: AbsenceCoverage[]):AbsenceCommitment {
  const ordered=[...absences].sort((a,b)=>compareCanonicalText(a.stableRecordId,b.stableRecordId));
  const root=balancedAbsenceNode(ordered),count=root?.count??0n,min=root?.min??null,max=root?.max??null,rootHash=root?.hash??ABSENCE_EMPTY_HASH;
  const commitment=sha256Bytes(Buffer.from("TRIA/source-reconciliation/absence-avl/root/v1","utf8"),rootHash,int64Bytes(count),min?Buffer.concat([Buffer.from([1]),uuidBytes(min)]):Buffer.from([0]),max?Buffer.concat([Buffer.from([1]),uuidBytes(max)]):Buffer.from([0]));
  return {rootHash:rootHash.toString("hex"),count:count.toString(),min,max,commitment:commitment.toString("hex")};
}

function fingerprintFor(input: { confirmation: Pick<PreviewConfirmation, "confirmationId" | "previewId" | "batchId" | "sourceSha256" | "contractHash" | "transformationHash" | "previewHash">; rootRequestHash: string; absenceCommitment: AbsenceCommitment; policy: MatchingPolicy; baseProjectionVersion: string; decisions: ReconciliationDecision[] }) {
  // The database issues decidedAt as audit metadata. Keep it out of the
  // immutable replay identity so the server can replace a caller value.
  return sha256ImportCanonical({ version: "reconciliation-fingerprint-v4", rootRequestHash: input.rootRequestHash, absenceCommitment: input.absenceCommitment, confirmation: { confirmationId: input.confirmation.confirmationId, previewId: input.confirmation.previewId, batchId: input.confirmation.batchId, sourceSha256: input.confirmation.sourceSha256, contractHash: input.confirmation.contractHash, transformationHash: input.confirmation.transformationHash, previewHash: input.confirmation.previewHash }, policy: { version: input.policy.version, evidence: input.policy.evidence, fields: Object.fromEntries([...input.policy.fields].sort(compareCanonicalText).map((field) => [field, true])) }, baseProjectionVersion: input.baseProjectionVersion, decisions: Object.fromEntries([...input.decisions].sort((left, right) => compareCanonicalText(`${left.observationId}:${left.locator ?? ""}:${left.id}`, `${right.observationId}:${right.locator ?? ""}:${right.id}`)).map((decision) => [`${decision.observationId}:${decision.locator ?? ""}:${decision.id}`, { id: decision.id, observationId: decision.observationId, locator: decision.locator ?? null, stableRecordId: decision.stableRecordId ?? null, outcome: decision.outcome, policyVersion: decision.policyVersion, rationale: decision.rationale, version: decision.version, actor: decision.actor }])) });
}

function summaryFor(lines: ReconciliationLine[], absences: AbsenceCoverage[], conflicts: ImportConflict[]) {
  return {
    inserted: lines.filter((line) => line.category === "inserted").length,
    updated: lines.filter((line) => line.category === "updated").length,
    unchanged: lines.filter((line) => line.category === "unchanged").length,
    rejected: lines.filter((line) => line.category === "rejected").length,
    conflict: lines.filter((line) => line.category === "conflict").length,
    total: lines.length, absent: absences.length, pendingDecisions: conflicts.filter((conflict) => !conflict.resolution).length,
  } satisfies ReconciliationSummary;
}

function metricsFor(lines: ReconciliationLine[], records: StableRecord[]): ReconciliationMetrics {
  const decimals = new Map<string, ExactDecimalSource[]>();
  const durations = new Map<string, ExactDurationSource[]>();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const acceptedByRecord = new Map<string, ReconciliationLine>();
  for (const line of lines) {
    if (["inserted", "updated", "unchanged"].includes(line.category) && line.stableRecordId && !acceptedByRecord.has(line.stableRecordId)) {
      acceptedByRecord.set(line.stableRecordId, line);
    }
  }
  const metricInputs: Array<{ decimalSources?: Record<string, ExactDecimalSource>; durationSources?: Record<string, ExactDurationSource> }> = [];
  for (const record of records.filter((candidate) => candidate.state !== "disregarded")) {
    const line = acceptedByRecord.get(record.id);
    if (line && line.decision?.outcome !== "keep-current") {
      metricInputs.push({ decimalSources: line.observation.decimalSources, durationSources: line.observation.durationSources });
    } else {
      const current = effectiveRecordContent(record);
      metricInputs.push({ decimalSources: current.decimalSources, durationSources: current.durationSources });
    }
  }
  for (const line of lines) {
    if (["inserted", "updated", "unchanged"].includes(line.category) && (!line.stableRecordId || !recordsById.has(line.stableRecordId))) {
      metricInputs.push({ decimalSources: line.observation.decimalSources, durationSources: line.observation.durationSources });
    }
  }
  for (const input of metricInputs) {
    for (const [field, source] of Object.entries(input.decimalSources ?? {})) {
      const bucket = decimals.get(field);
      if (bucket) bucket.push(source);
      else decimals.set(field, [source]);
    }
    for (const [field, source] of Object.entries(input.durationSources ?? {})) {
      const bucket = durations.get(field);
      if (bucket) bucket.push(source);
      else durations.set(field, [source]);
    }
  }
  return {
    decimalSums: Object.fromEntries([...decimals.entries()].sort(([left], [right]) => compareCanonicalText(left, right)).map(([field, values]) => [field, sumExactDecimals(values)])),
    durationSums: Object.fromEntries([...durations.entries()].sort(([left], [right]) => compareCanonicalText(left, right)).map(([field, values]) => [field, sumTypedDurations(values)])),
  };
}

function stableRecordContext(record: StableRecord) {
  const effective = effectiveRecordContent(record);
  return {
    id: record.id,
    matchingAttributes: structuredClone(record.matchingAttributes ?? {}),
    effectiveLayer: effective.layer,
    effectivePayload: structuredClone(effective.payload),
    ...(effective.decimalSources !== undefined ? { decimalSources: structuredClone(effective.decimalSources) } : {}),
    ...(effective.durationSources !== undefined ? { durationSources: structuredClone(effective.durationSources) } : {}),
    ...(effective.version !== undefined ? { effectiveVersion: effective.version } : {}),
  };
}

export type ReconciliationDiagnostics = {
  targetBucketAppends: number;
  targetBucketAllocations: number;
  targetRecordLookups: number;
};

export function observedTargetForAbsence(line: ReconciliationLine) {
  // A redirect owns only its final target. A reject still proves that the
  // unique original target was observed, even though the observation has no effect.
  if (line.decision?.outcome === "link") return line.stableRecordId;
  return line.stableRecordId ?? (line.decision?.outcome === "reject" ? line.match.matchedRecordId : undefined);
}

function refreshDerivedState(reconciliation: Reconciliation, lines: ReconciliationLine[], records: StableRecord[], diagnostics?: ReconciliationDiagnostics) {
  const accepted = lines.filter((line) => ["inserted", "updated", "unchanged"].includes(line.category) && line.stableRecordId);
  const targets = new Map<string, ReconciliationLine[]>();
  for (const line of accepted) {
    const target = line.stableRecordId!;
    const bucket = targets.get(target);
    if (bucket) bucket.push(line);
    else {
      targets.set(target, [line]);
      if (diagnostics) diagnostics.targetBucketAllocations += 1;
    }
    if (diagnostics) diagnostics.targetBucketAppends += 1;
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const [target, duplicateLines] of targets) {
    if (duplicateLines.length < 2) continue;
    if (diagnostics) diagnostics.targetRecordLookups += 1;
    const targetRecord = recordsById.get(target);
    const duplicateMessage = "Duas observações aceitas apontam para o mesmo registro estável; resolva explicitamente.";
    for (const line of duplicateLines) {
      line.category = "conflict";
      line.consequence = duplicateMessage;
      line.fieldDiffs = fieldsDiff(line.observation, targetRecord, duplicateMessage);
      line.conflict = { id: line.conflict?.code === "DUPLICATE_TARGET" ? line.conflict.id : randomUUID(), observationId: line.observation.id, code: "DUPLICATE_TARGET", candidateIds: [target], message: duplicateMessage };
    }
  }
  const observedRecordIds = new Set(lines.map(observedTargetForAbsence).filter((target): target is string => target !== undefined));
  const absences = records.filter((record) => record.state !== "disregarded" && !observedRecordIds.has(record.id)).map((record) => {
    const current = effectiveRecordContent(record);
    return { stableRecordId: record.id, status: "not_observed_this_batch" as const, label: "Não observado neste lote" as const, effectivePayload: structuredClone(current.payload), ...(current.version !== undefined ? { effectiveVersion: current.version } : {}) };
  }).sort((left, right) => compareCanonicalText(left.stableRecordId, right.stableRecordId));
  const conflicts = lines.flatMap((line) => line.conflict ? [line.conflict] : []);
  const summary = summaryFor(lines, absences, conflicts);
  return { ...reconciliation, lines, conflicts, absences, summary, metrics: metricsFor(lines, records), status: conflicts.some((conflict) => !conflict.resolution) ? "needs-decision" as const : "ready-to-apply" as const };
}

type LineDecisionResult = { category: ReconciliationCategory; stableRecordId?: string; consequence: string };

function lineDecision(input: { observation: SourceObservation; match: RecordMatch; recordsById: Map<string, StableRecord>; decision?: ReconciliationDecision }): LineDecisionResult | undefined {
  const decision = input.decision;
  if (decision?.outcome === "reject") return { category: "rejected" as const, stableRecordId: decision.stableRecordId, consequence: "A decisão registrada rejeita esta observação." };
  if (decision?.outcome === "keep-current" && decision.stableRecordId) return { category: "unchanged" as const, stableRecordId: decision.stableRecordId, consequence: "A decisão mantém a camada vigente." };
  if (decision?.outcome === "create") return { category: "inserted" as const, stableRecordId: decision.stableRecordId, consequence: "A decisão cria uma identidade interna opaca durante a aplicação." };
  const targetId = decision?.stableRecordId ?? input.match.matchedRecordId;
  if (!targetId) return undefined;
  const record = input.recordsById.get(targetId);
  if (!record) return undefined;
  if (record.state === "disregarded") return { category: "conflict" as const, stableRecordId: targetId, consequence: "Registro desconsiderado não é reativado automaticamente." };
  const effective = effectivePayload(record);
  const sameContent = equalRecordContent(input.observation, record);
  if (effective.layer !== "source" && !decision && !sameContent) return { category: "conflict" as const, stableRecordId: targetId, consequence: "A observação diverge de uma camada protegida e exige decisão." };
  return { category: sameContent ? "unchanged" as const : "updated" as const, stableRecordId: targetId, consequence: effective.layer === "source" ? "A observação aceita atualiza a projeção vigente." : "A decisão auditada autoriza o novo resultado." };
}

/**
 * Rebuilds the derived reconciliation view from its immutable manifest and
 * decision chain. The persisted manifest is the source of lineage; records
 * only provide the current effective context needed for diffs, duplicates,
 * absences and metrics.
 */
export function rehydrateReconciliationState(reconciliation: Reconciliation, decisions: ReconciliationDecision[], records: StableRecord[]) {
  const base = structuredClone(reconciliation);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const latestByLine = new Map<string, ReconciliationDecision>();
  const latestByObservation = new Map<string, ReconciliationDecision>();
  for (const decision of decisions) {
    const key = `${decision.observationId}:${decision.locator ?? ""}`;
    const current = latestByLine.get(key);
    if (!current || (decision.revisionNo ?? 0) >= (current.revisionNo ?? 0)) latestByLine.set(key, decision);
    const byObservation = latestByObservation.get(decision.observationId);
    if (!byObservation || (decision.revisionNo ?? 0) >= (byObservation.revisionNo ?? 0)) latestByObservation.set(decision.observationId, decision);
  }
  const lines = base.lines.map((line) => {
    const decision = latestByLine.get(`${line.observation.id}:${line.observation.locator}`)
      ?? latestByObservation.get(line.observation.id);
    if (!decision) return line;
    const result = lineDecision({ observation: line.observation, match: line.match, recordsById, decision });
    if (!result) return line;
    return {
      ...line,
      decision: structuredClone(decision),
      category: result.category,
      ...(result.stableRecordId ? { stableRecordId: result.stableRecordId } : { stableRecordId: undefined }),
      fieldDiffs: fieldsDiff(line.observation, result.stableRecordId ? recordsById.get(result.stableRecordId) : undefined, result.consequence),
      consequence: result.consequence,
      ...(line.conflict ? { conflict: { ...line.conflict, resolution: decision.outcome } } : {}),
    };
  });
  const activeRecords = records.filter((record) => record.state !== "disregarded").map(stableRecordContext).sort((left, right) => compareCanonicalText(left.id, right.id));
  const derived = refreshDerivedState({
    ...base,
    lines,
    decisions: structuredClone(decisions),
    availableStableRecordIds: activeRecords.map((record) => record.id),
    availableStableRecords: activeRecords,
  }, lines, records);
  return { ...derived, status: reconciliation.status === "applied" ? "applied" as const : derived.status };
}

function fieldsDiff(observation: SourceObservation, record: StableRecord | undefined, cause: string) {
  const current = record ? effectiveRecordContent(record) : undefined;
  const currentPayload: Record<string, string | null> = current?.payload ?? {};
  const currentLayer: "source" | "adjustment" | "decision" | "none" = current?.layer ?? "none";
  const fields = new Set([...Object.keys(currentPayload), ...Object.keys(observation.normalizedPayload)]);
  const payloadDiffs: ReconciliationLine["fieldDiffs"] = [...fields]
    .sort(compareCanonicalText)
    .filter((field) => currentPayload[field] !== observation.normalizedPayload[field] || (field in currentPayload) !== (field in observation.normalizedPayload))
    .map((field) => ({
      field,
      original: currentPayload[field] ?? null,
      proposed: observation.normalizedPayload[field] ?? null,
      originalPresent: field in currentPayload,
      proposedPresent: field in observation.normalizedPayload,
      layer: currentLayer,
      cause,
    }));
  const provenanceDiffs = <T extends object>(kind: "decimal-source" | "duration-source", original: Record<string, T> | undefined, proposed: Record<string, T> | undefined) => {
    const originalSources = cloneTypedSources(original);
    const proposedSources = cloneTypedSources(proposed);
    const provenanceFields = new Set([...Object.keys(originalSources ?? {}), ...Object.keys(proposedSources ?? {})]);
    const mapPresenceChanged = (originalSources === undefined) !== (proposedSources === undefined);
    const mapLevelOnly = provenanceFields.size === 0 && mapPresenceChanged;
    if (mapLevelOnly) provenanceFields.add("*");
    return [...provenanceFields]
      .sort(compareCanonicalText)
      .filter((field) => {
        if (mapLevelOnly) return true;
        const originalPresent = originalSources !== undefined && field in originalSources;
        const proposedPresent = proposedSources !== undefined && field in proposedSources;
        return originalPresent !== proposedPresent || (originalPresent && proposedPresent && canonicalStringify(originalSources[field]) !== canonicalStringify(proposedSources[field]));
      })
      .map((field) => {
        const mapLevel = mapLevelOnly;
        const originalPresent = mapLevel ? originalSources !== undefined : originalSources !== undefined && field in originalSources;
        const proposedPresent = mapLevel ? proposedSources !== undefined : proposedSources !== undefined && field in proposedSources;
        return {
          field,
          original: originalPresent ? canonicalStringify(mapLevel ? originalSources : originalSources![field]) : null,
          proposed: proposedPresent ? canonicalStringify(mapLevel ? proposedSources : proposedSources![field]) : null,
          originalPresent,
          proposedPresent,
          provenanceKind: kind,
          layer: currentLayer,
          cause,
        } satisfies ReconciliationLine["fieldDiffs"][number];
      });
  };
  const result = [
    ...payloadDiffs,
    ...provenanceDiffs("decimal-source", current?.decimalSources, observation.decimalSources),
    ...provenanceDiffs("duration-source", current?.durationSources, observation.durationSources),
  ];
  const kindOrder = { payload: 0, "decimal-source": 1, "duration-source": 2 } as const;
  return result.sort((left, right) => compareCanonicalText(left.field, right.field) || kindOrder[left.provenanceKind ?? "payload"] - kindOrder[right.provenanceKind ?? "payload"]);
}

function observationFromRow(input: { preview: Preview; row: PreviewRow; observedAt: string }) {
  const observation = createSourceObservation({ batchId: input.preview.batchId, previewId: input.preview.previewId, sourceFileId: input.preview.sourceFileId,
    locator: input.row.locator, sourceRowHash: input.row.sourceRowHash, normalizedPayload: input.row.normalizedPayload,
    sourceValues: input.row.sourceValues, decimalSources: input.row.decimalSources, durationSources: input.row.durationSources, matchingAttributes: input.row.matchingAttributes, observedAt: input.observedAt });
  // The observation ID identifies this immutable preview line. It is deliberately
  // separate from StableRecord.id and remains stable when a policy is rerun.
  const digest = sha256ImportCanonical({ previewId: input.preview.previewId, locator: input.row.locator });
  return { ...observation, id: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}` };
}

const IGNORED_ROOT_REQUEST_KEYS = new Set(["curso", "trilha"]);

/** Type-tagged ordered tree. It preserves every array ordinal without relying on a sorting comparator. */
function orderedRootTree(value: unknown): unknown {
  if (Array.isArray(value)) return { t: "a", v: Object.fromEntries(value.map((item,index) => [String(index).padStart(12,"0"),orderedRootTree(item)])) };
  if (value && typeof value === "object") return { t: "o", v: Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED_ROOT_REQUEST_KEYS.has(key.toLowerCase())).map(([key,item]) => [key,orderedRootTree(item)])) };
  return value;
}

export function validateConfirmedPreviewRequest(input: { confirmation: PreviewConfirmation; preview: Preview; policy: MatchingPolicy; decisions?: ReconciliationDecision[] }) {
  const { confirmation, preview, policy } = input;
  if (confirmation.status !== "confirmed" || confirmation.actor !== "Rodrigo" || confirmation.previewId !== preview.previewId || confirmation.batchId !== preview.batchId || confirmation.sourceFileId !== preview.sourceFileId || confirmation.fileVersionId !== preview.fileVersionId || confirmation.sourceFormat !== preview.sourceFormat || confirmation.sourceSha256 !== preview.sourceSha256 || confirmation.previewHash !== preview.previewHash || confirmation.contentHash !== preview.contentHash || confirmation.rowResultHash !== preview.rowResultHash || confirmation.contractHash !== preview.contractHash || confirmation.transformationHash !== preview.transformationHash) {
    throw new Error("A prévia confirmada não corresponde exatamente ao recorte preparado.");
  }
  validatePolicy(policy);
}

export function rootRequestHashFor(input: { confirmation: PreviewConfirmation; preview: Preview; policy: MatchingPolicy }) {
  validateConfirmedPreviewRequest(input);
  const confirmation=structuredClone(input.confirmation) as Record<string,unknown>;
  delete confirmation.confirmedAt;delete confirmation.reused;
  const preview=structuredClone(input.preview) as unknown as Record<string,unknown>;
  delete preview.preparedAt;delete preview.retainUntil;
  const transportFree=JSON.parse(JSON.stringify({confirmation,preview,policy:input.policy})) as unknown;
  return sha256Canonical(orderedRootTree(transportFree));
}

export function reconcileConfirmedPreview(input: {
  confirmation: PreviewConfirmation;
  preview: Preview;
  records: StableRecord[];
  decisions?: ReconciliationDecision[];
  policy: MatchingPolicy;
  baseProjectionVersion?: string;
  now?: string;
  reconciliationId?: string;
  diagnostics?: ReconciliationDiagnostics;
}): Reconciliation {
  const { confirmation, preview, records, policy } = input;
  validateConfirmedPreviewRequest(input);
  if (input.decisions && input.decisions.length>0) throw new Error("Decisões devem ser registradas pelo comando de decisão separado.");
  const rootRequestHash = rootRequestHashFor({ confirmation, preview, policy });
  const now = input.now ?? new Date().toISOString();
  const decisions: ReconciliationDecision[] = [];
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const resolveMatch = createRecordMatchResolver(records, policy);
  // An observation is immutable evidence of the confirmed preview line. Its
  // timestamp therefore comes from the retained preparation, rather than from
  // the wall clock of each reconciliation retry.
  const rows = preview.rows.map((row) => {
    const observation = observationFromRow({ preview, row, observedAt: preview.preparedAt });
    return observation;
  });
  const lines: ReconciliationLine[] = [];
  const conflicts: ImportConflict[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const observation = rows[index];
    const originalRow = preview.rows[index];
    const decision = undefined;
    if (originalRow.status === "rejected") {
      lines.push({ observation, category: "rejected", match: { id: randomUUID(), observationId: observation.id, policyVersion: policy.version, candidateIds: [], candidateCount: 0, outcome: "none", reason: "A linha foi rejeitada na validação da prévia." }, fieldDiffs: [], ...(decision ? { decision } : {}), consequence: "Esta linha não será incluída." });
      continue;
    }
    const match = resolveMatch(observation);
    let result = lineDecision({ observation, match, recordsById, decision });
    let conflict: ImportConflict | undefined;
    if (!result) {
      conflict = makeConflict(observation, match, match.outcome === "multiple" ? "MULTIPLE_CANDIDATES" : "NO_CANDIDATE", match.outcome === "multiple" ? "Há múltiplos candidatos; escolha explicitamente um registro." : "Não há candidato comprovado; escolha explicitamente criar ou vincular um registro.");
      conflicts.push(conflict);
      result = { category: "conflict", consequence: "Esta observação aguarda uma decisão explícita." };
    } else if (result.category === "conflict") {
      const record = result.stableRecordId ? recordsById.get(result.stableRecordId) : undefined;
      const layer = record ? effectivePayload(record).layer : undefined;
      conflict = makeConflict(observation, match, record?.state === "disregarded" ? "DISREGARDED_RECORD" : "PROTECTED_LAYER", result.consequence, layer);
      conflicts.push(conflict);
    }
    lines.push({ observation, category: result.category, match, stableRecordId: result.stableRecordId, fieldDiffs: fieldsDiff(observation, result.stableRecordId ? recordsById.get(result.stableRecordId) : undefined, result.consequence), ...(conflict ? { conflict } : {}), ...(decision ? { decision } : {}), consequence: result.consequence });
  }
  const emptyAbsenceCommitment=absenceCommitmentFor([]);
  const fingerprint = fingerprintFor({ confirmation, rootRequestHash, absenceCommitment: emptyAbsenceCommitment, policy, baseProjectionVersion: input.baseProjectionVersion ?? "0", decisions });
  const id = input.reconciliationId ?? randomUUID();
  const availableStableRecords = records.filter((record) => record.state !== "disregarded").map(stableRecordContext).sort((left, right) => compareCanonicalText(left.id, right.id));
  const base: Reconciliation = { id, confirmationId: confirmation.confirmationId, batchId: confirmation.batchId, previewId: confirmation.previewId, sourceFileId: confirmation.sourceFileId, sourceSha256: confirmation.sourceSha256, contractHash: confirmation.contractHash, transformationHash: input.confirmation.transformationHash, previewHash: confirmation.previewHash, rootRequestHash, absenceCommitment: emptyAbsenceCommitment, policy: structuredClone(policy), baseProjectionVersion: input.baseProjectionVersion ?? "0", status: "ready-to-apply", lines, absences: [], conflicts, decisions: structuredClone(decisions), availableStableRecordIds: availableStableRecords.map((record) => record.id), availableStableRecords, summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, conflict: 0, total: 0, absent: 0, pendingDecisions: 0 }, fingerprint, createdAt: now, actor: "Rodrigo", revisionNo: "1" };
  const refreshed=refreshDerivedState(base,lines,records,input.diagnostics);
  refreshed.absenceCommitment=absenceCommitmentFor(refreshed.absences);
  refreshed.fingerprint=fingerprintFor({confirmation,rootRequestHash,absenceCommitment:refreshed.absenceCommitment,policy,baseProjectionVersion:refreshed.baseProjectionVersion,decisions});
  return refreshed;
}

/** Creates a new immutable reconciliation revision after a human decision. */
export function applyReconciliationDecision(reconciliation: Reconciliation, decision: ReconciliationDecision, now = new Date().toISOString()) {
  const equivalent = reconciliation.decisions.find((current) => current.observationId === decision.observationId && current.locator === decision.locator && current.outcome === decision.outcome && (decision.outcome === "create" || current.stableRecordId === decision.stableRecordId) && current.policyVersion === decision.policyVersion && current.rationale === decision.rationale && current.version === decision.version);
  if (equivalent) return structuredClone(reconciliation);
  const sameId = reconciliation.decisions.find((current) => current.id === decision.id);
  if (sameId) throw new Error("O ID da decisão já identifica outro ato.");
  const nextDecision = { ...structuredClone(decision), revisionNo: decision.revisionNo ?? Math.max(0, ...reconciliation.decisions.map((current) => current.revisionNo ?? 0)) + 1 };
  const decisions: ReconciliationDecision[] = [...structuredClone(reconciliation.decisions), nextDecision];
  const nextLines = structuredClone(reconciliation.lines);
  const decisionByObservation = new Map(decisions.map((current) => [current.observationId, current]));
  for (const candidate of nextLines) {
    const current = decisionByObservation.get(candidate.observation.id);
    if (current) candidate.decision = structuredClone(current);
  }
  const line = nextLines.find((candidate) => candidate.observation.id === decision.observationId || candidate.observation.locator === decision.locator);
  if (!line) throw new Error("A observação da decisão não foi encontrada.");
  line.decision = nextDecision;
  if (line.conflict) line.conflict.resolution = decision.outcome;
  const context = reconciliation.availableStableRecords?.find((record) => record.id === decision.stableRecordId);
  const selectedRecord: StableRecord | undefined = context ? { id: context.id, matchingAttributes: context.matchingAttributes, effectiveLayer: context.effectiveLayer, effectivePayload: context.effectivePayload, ...(context.decimalSources ? { decimalSources: context.decimalSources } : {}), ...(context.durationSources ? { durationSources: context.durationSources } : {}), ...(context.effectiveVersion !== undefined ? { effectiveVersion: context.effectiveVersion } : {}), ...(context.effectiveLayer === "decision" ? { auditedDecisionPayload: context.effectivePayload } : context.effectiveLayer === "adjustment" ? { adjustmentPayload: context.effectivePayload } : { sourcePayload: context.effectivePayload }) } : undefined;
  const result = lineDecision({ observation: line.observation, match: line.match, recordsById: new Map(selectedRecord ? [[selectedRecord.id, selectedRecord]] : []), decision: nextDecision });
  if (!result) throw new Error("O registro estável selecionado não está disponível.");
  line.category = result.category;
  line.stableRecordId = result.stableRecordId;
  line.fieldDiffs = fieldsDiff(line.observation, selectedRecord, result.consequence);
  line.consequence = result.consequence;
  const updated = refreshDerivedState({ ...structuredClone(reconciliation), id: randomUUID(), decisions, createdAt: now, parentReconciliationId: reconciliation.id, revisionNo: (BigInt(reconciliation.revisionNo ?? "1") + 1n).toString(), fingerprint: fingerprintFor({ confirmation: reconciliation, rootRequestHash: reconciliation.rootRequestHash, absenceCommitment: reconciliation.absenceCommitment, policy: reconciliation.policy, baseProjectionVersion: reconciliation.baseProjectionVersion, decisions }) }, nextLines, (reconciliation.availableStableRecords ?? []).map((record) => ({ id: record.id, matchingAttributes: record.matchingAttributes, effectiveLayer: record.effectiveLayer, effectivePayload: record.effectivePayload, ...(record.decimalSources ? { decimalSources: record.decimalSources } : {}), ...(record.durationSources ? { durationSources: record.durationSources } : {}), ...(record.effectiveVersion !== undefined ? { effectiveVersion: record.effectiveVersion } : {}), ...(record.effectiveLayer === "decision" ? { auditedDecisionPayload: record.effectivePayload } : record.effectiveLayer === "adjustment" ? { adjustmentPayload: record.effectivePayload } : { sourcePayload: record.effectivePayload }) })));
  updated.absenceCommitment=absenceCommitmentFor(updated.absences);
  updated.fingerprint=fingerprintFor({confirmation:reconciliation,rootRequestHash:reconciliation.rootRequestHash,absenceCommitment:updated.absenceCommitment,policy:reconciliation.policy,baseProjectionVersion:reconciliation.baseProjectionVersion,decisions});
  return updated;
}

export function reduceEffectiveProjection(events: EffectiveRecordEvent[], previous: EffectiveRecordProjection[] = []) {
  const projections = new Map(previous.map((projection) => {
    const sanitized: EffectiveRecordProjection = { ...structuredClone(projection), payload: clonePayload(projection.payload) };
    if (projection.decimalSources === undefined) delete sanitized.decimalSources;
    else sanitized.decimalSources = structuredClone(cloneTypedSources(projection.decimalSources)!);
    if (projection.durationSources === undefined) delete sanitized.durationSources;
    else sanitized.durationSources = structuredClone(cloneTypedSources(projection.durationSources)!);
    return [projection.recordId, sanitized] as const;
  }));
  const precedence = { source: 1, adjustment: 2, decision: 3 } as const;
  for (const event of [...events].sort((left, right) => compareRfc3339Instants(left.occurredAt, right.occurredAt) || precedence[left.layer] - precedence[right.layer] || compareCanonicalText(left.id, right.id))) {
    const current = projections.get(event.recordId) ?? { recordId: event.recordId, payload: {}, state: "active" as const, version: "0" };
    const currentLayer = current.decisionEventId ? "decision" : current.adjustmentEventId ? "adjustment" : current.sourceObservationId ? "source" : undefined;
    if (currentLayer && precedence[event.layer] < precedence[currentLayer]) {
      // Even an older layer carries fresh lineage for this batch. Keep it when
      // a same-timestamp higher layer was reduced first.
      if (event.layer === "source") {
        current.sourceObservationId = event.observationId;
        current.observedBatchId = event.batchId ?? event.reconciliationId;
        projections.set(event.recordId, current);
      }
      continue;
    }
    const next: EffectiveRecordProjection = { ...current, payload: clonePayload(event.payload), state: event.state ?? current.state, version: event.version };
    // Events are full-state replacements. Undefined preserves the distinction
    // "provenance unknown" by removing an older value; `{}` is an explicit clear.
    if (event.decimalSources === undefined) delete next.decimalSources;
    else next.decimalSources = structuredClone(cloneTypedSources(event.decimalSources)!);
    if (event.durationSources === undefined) delete next.durationSources;
    else next.durationSources = structuredClone(cloneTypedSources(event.durationSources)!);
    if (event.layer === "source") { next.sourceObservationId = event.observationId; next.observedBatchId = event.batchId ?? event.reconciliationId; }
    if (event.layer === "adjustment") next.adjustmentEventId = event.id;
    if (event.layer === "decision") next.decisionEventId = event.id;
    projections.set(event.recordId, next);
  }
  return [...projections.values()].sort((left, right) => compareCanonicalText(left.recordId, right.recordId));
}

export function eventsForReconciliation(reconciliation: Reconciliation, records: StableRecord[], now = new Date().toISOString()): EffectiveRecordEvent[] {
  if (reconciliation.status !== "ready-to-apply" && reconciliation.status !== "applied") throw new Error("A reconciliação possui decisões pendentes.");
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const known = new Set(recordsById.keys());
  return reconciliation.lines.flatMap((line) => {
    const manualDecision = line.decision?.outcome === "link" || line.decision?.outcome === "keep-current";
    if (!manualDecision && !["inserted", "updated", "unchanged"].includes(line.category)) return [];
    const recordId = line.stableRecordId;
    if (!recordId) throw new Error("A identidade criada deve ser alocada pelo serviço antes da aplicação.");
    const current = recordsById.get(recordId);
    const sourceEvent: EffectiveRecordEvent = {
      id: deterministicUuid({ reconciliationId: reconciliation.id, observationId: line.observation.id, recordId, layer: "source" }),
      reconciliationId: reconciliation.id,
      batchId: reconciliation.batchId,
      recordId,
      type: known.has(recordId) ? "observation.accepted" : "record.inserted",
      layer: "source",
      observationId: line.observation.id,
      payload: clonePayload(line.observation.normalizedPayload),
      decimalSources: structuredClone(cloneTypedSources(line.observation.decimalSources)!),
      ...(line.observation.durationSources !== undefined ? { durationSources: structuredClone(cloneTypedSources(line.observation.durationSources)!) } : {}),
      state: current?.state ?? "active",
      actor: "Rodrigo",
      occurredAt: canonicalTimestamp(now),
      version: `${reconciliation.batchId}:${line.observation.locator}`,
    };
    if (!manualDecision) return [sourceEvent];
    const decision = line.decision;
    if (!decision) return [sourceEvent];
    const auditContent = decision.outcome === "keep-current" && current
      ? effectiveRecordContent(current)
      : { payload: sourceEvent.payload, decimalSources: sourceEvent.decimalSources, durationSources: sourceEvent.durationSources };
    const auditEvent: EffectiveRecordEvent = {
      ...sourceEvent,
      payload: structuredClone(auditContent.payload),
      ...(auditContent.decimalSources !== undefined ? { decimalSources: structuredClone(auditContent.decimalSources) } : {}),
      id: deterministicUuid({ reconciliationId: reconciliation.id, observationId: line.observation.id, recordId, layer: "decision" }),
      type: "decision.audit",
      layer: "decision",
      version: `${reconciliation.batchId}:${line.observation.locator}:decision`,
      decisionId: decision.id,
      decisionRationale: decision.rationale,
      decisionVersion: decision.version,
      decisionDecidedAt: canonicalTimestamp(decision.decidedAt),
    };
    if (auditContent.decimalSources === undefined) delete auditEvent.decimalSources;
    else auditEvent.decimalSources = structuredClone(auditContent.decimalSources);
    if (auditContent.durationSources === undefined) delete auditEvent.durationSources;
    else auditEvent.durationSources = structuredClone(auditContent.durationSources);
    return [sourceEvent, auditEvent];
  });
}
