import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Preview, PreviewConfirmation, PreviewRow } from "../domain/dtos";
import {
  buildRecordMatch,
  createRecordMatchResolver,
  applyReconciliationDecision,
  createSourceObservation,
  createStableRecordId,
  compareExactDecimals,
  compareExactDurations,
  compareCanonicalText,
  compareRfc3339Instants,
  rootRequestHashFor,
  compareOfficialValues,
  eventsForReconciliation,
  effectiveRecordContent,
  orderOfficialLines,
  reconcileConfirmedPreview,
  reduceEffectiveProjection,
  sumExactDecimals,
  sumExactDurations,
  formatExactDurationSeconds,
  type EffectiveRecordEvent,
  type MatchingPolicy,
  type ReconciliationDiagnostics,
  type StableRecord,
  MAX_PUBLIC_CANDIDATE_IDS,
} from "../domain/reconciliation";
import { InMemorySourceReconciliationRepository } from "../adapters/in-memory-reconciliation";
import { SourceReconciliationService } from "../application/reconcile-import";
import { matchesStableRecordSearch, normalizeStableRecordSearchQuery } from "../application/stable-record-search";
import { ReconciliationIntegrityFailure, ReconciliationNotFoundFailure } from "../application/reconciliation-repository";

const TEST_CURSOR_KEY = Buffer.alloc(32, 0x5a);

const policy: MatchingPolicy = { version: "stable-attributes-v1", fields: ["stable_key"], evidence: "explicit-stable-attributes" };
const sourceIds = { sourceFileId: "10000000-0000-4000-8000-000000000001", fileVersionId: "10000000-0000-4000-8000-000000000002", batchId: "10000000-0000-4000-8000-000000000003", previewId: "10000000-0000-4000-8000-000000000004", confirmationId: "10000000-0000-4000-8000-000000000005" };

function row(locator: string, value: string, status: "valid" | "rejected" = "valid"): PreviewRow {
  const sourceScale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return { locator, sourceRowHash: `${locator.padEnd(64, "a")}`.slice(0, 64), normalizedPayload: { stable_key: locator, valor: value, curso: "segredo" }, sourceValues: { stable_key: locator, valor: value, curso: "segredo" }, decimalSources: { valor: { source_text: value, source_scale: sourceScale, normalized_value: value } }, matchingAttributes: { stable_key: locator }, status, fieldErrors: [] };
}

function preview(rows = [row("linha-a", "10.00")]) {
  return { previewId: sourceIds.previewId, batchId: sourceIds.batchId, sourceFileId: sourceIds.sourceFileId, fileVersionId: sourceIds.fileVersionId, sourceSha256: "a".repeat(64), sourceFormat: "CSV", contentHash: "b".repeat(64), rowResultHash: "c".repeat(64), retainUntil: "2099-01-01T00:00:00.000Z", registry: { schemaId: "x", parserProfileId: "x", transformationId: "x", limitsProfileId: "x" }, schemaVersion: "x", parserVersion: "x", transformationVersion: "x", contractHash: "d".repeat(64), transformationHash: "e".repeat(64), previewHash: "f".repeat(64), preparedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "Validado", contract: {} as Preview["contract"], summary: { found: rows.length, valid: rows.filter((r) => r.status === "valid").length, withError: rows.filter((r) => r.status === "rejected").length, rejected: rows.filter((r) => r.status === "rejected").length, inserted: "não avaliadas nesta etapa", updated: "não avaliadas nesta etapa", unchanged: "não avaliadas nesta etapa", conflicts: [], rowResultHash: "c".repeat(64) }, rows, headers: [] } satisfies Preview;
}

function confirmation(p: Preview) {
  return { confirmationId: sourceIds.confirmationId, batchId: p.batchId, previewId: p.previewId, sourceFileId: p.sourceFileId, fileVersionId: p.fileVersionId, sourceFormat: p.sourceFormat, contentHash: p.contentHash, rowResultHash: p.rowResultHash, sourceSha256: p.sourceSha256, contractHash: p.contractHash, transformationHash: p.transformationHash, previewHash: p.previewHash, confirmedAt: "2026-01-01T00:00:01.000Z", actor: "Rodrigo", status: "confirmed", reused: false } satisfies PreviewConfirmation;
}

function record(id: string, value: string, extra: Partial<StableRecord> = {}): StableRecord {
  const sourceScale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return {
    id,
    matchingAttributes: { stable_key: id },
    sourcePayload: { stable_key: id, valor: value },
    decimalSources: { valor: { source_text: value, source_scale: sourceScale, normalized_value: value } },
    ...extra,
  };
}

async function pageRoot(repository: InMemorySourceReconciliationRepository) {
  const p = preview([]);
  const reconciliation = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: await repository.listStableRecords() });
  const saved = await repository.saveReconciliation({ reconciliation, fingerprint: reconciliation.fingerprint, idempotencyKey: `page-root-${reconciliation.id}` });
  return saved.reconciliation.id;
}

describe("reconciliação — identidade, precedência e ausência", () => {
  it("trata registro estável ainda sem projeção como fonte vazia", () => {
    const record: StableRecord = {id:createStableRecordId(),state:"active",matchingAttributes:{stable_key:"unprojected"}};
    expect(effectiveRecordContent(record)).toEqual({payload:{},layer:"source"});
  });

  it("liga a raiz a todos os bytes funcionais e à ordem, mas não a clocks de transporte", () => {
    const first=preview([row("linha-a","1"),row("linha-b","2")]);
    const confirmed=confirmation(first);
    const hash=rootRequestHashFor({confirmation:confirmed,preview:first,policy});
    const reordered={...first,rows:[first.rows[1],first.rows[0]]};
    expect(rootRequestHashFor({confirmation:confirmed,preview:reordered,policy})).not.toBe(hash);
    expect(rootRequestHashFor({confirmation:{...confirmed,confirmedAt:"2099-02-03T01:02:03.123Z",reused:true},preview:{...first,preparedAt:"2099-01-01T00:00:00.000Z",retainUntil:"2100-01-01T00:00:00.000Z"},policy})).toBe(hash);
    expect(rootRequestHashFor({confirmation:confirmed,preview:{...first,rows:[{...first.rows[0],sourceValues:{...first.rows[0].sourceValues,valor:"1.0"}},first.rows[1]]},policy})).not.toBe(hash);
    expect(rootRequestHashFor({confirmation:confirmed,preview:{...first,rows:[{...first.rows[0],sourceValues:{...first.rows[0].sourceValues,createdAt:"business-value"}},first.rows[1]]},policy})).not.toBe(hash);
  });

  it("ordena instantes RFC3339 por nanossegundo e normaliza offsets", () => {
    expect(compareRfc3339Instants("2026-01-01T14:00:00+14:00","2025-12-31T13:00:00-11:00")).toBe(0);
    expect(compareRfc3339Instants("2026-01-01T00:00:00.000000001Z","2026-01-01T00:00:00.000000002Z")).toBe(-1);
  });
  it("soma decimais e durações com a representação original", () => {
    expect(sumExactDecimals([
      { source_text: "1.20", source_scale: 2, normalized_value: "1.20" },
      { source_text: "0.005", source_scale: 3, normalized_value: "0.005" },
    ])).toBe("1.205");
    expect(sumExactDurations(["1:00:30", "30", "0:29:30"])).toBe("7200");
    expect(formatExactDurationSeconds("7200")).toBe("2:00:00");
    expect(sumExactDurations([formatExactDurationSeconds("7200")])).toBe("7200");;
    expect(sumExactDecimals([
      { source_text: "não informado", source_scale: 18, normalized_value: null },
      { source_text: "1.20", source_scale: 2, normalized_value: "1.20" },
    ])).toBe("1.20");
    expect(compareExactDecimals("10.0000000000000001", "10.0000000000000000")).toBe(1);
    expect(compareExactDurations("1:00:01", "60")).toBe(1);
  });

  it("entrega ordenação oficial com comparadores exatos para decimal e duração", () => {
    expect(compareOfficialValues("2", "10", "decimal")).toBe(-1);
    expect(compareOfficialValues("59:59", "1:00:01", "duration")).toBe(-1);
    const p = preview([row("dez", "10"), row("dois", "2")]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [], now: "2026-01-01T00:00:00.000Z" });
    expect(orderOfficialLines(result.lines, { field: "valor", kind: "decimal" }).map((line) => line.observation.locator)).toEqual(["dois", "dez"]);
  });

  it("ordena pelas fontes tipadas e usa desempate canônico independente de locale", () => {
    expect(compareOfficialValues(
      { source_text: "60", unit: "minutes" },
      { source_text: "59:59", unit: "clock" },
      "duration",
    )).toBe(1);
    expect(compareOfficialValues(
      { source_text: "2,00", source_scale: 2, normalized_value: "2.00" },
      { source_text: "10", source_scale: 0, normalized_value: "10" },
      "decimal",
    )).toBe(-1);
    expect(compareCanonicalText("z", "á")).toBe(-1);

    const p = preview([
      { ...row("á", "999"), decimalSources: { valor: { source_text: "2,00", source_scale: 2, normalized_value: "2.00" } } },
      { ...row("z", "1"), decimalSources: { valor: { source_text: "10", source_scale: 0, normalized_value: "10" } } },
    ]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [], now: "2026-01-01T00:00:00.000Z" });
    expect(orderOfficialLines(result.lines, { field: "valor", kind: "decimal" }).map((line) => line.observation.locator)).toEqual(["á", "z"]);
  });

  it("ordena keep-current pelo estado efetivo, não pela observação rejeitada", () => {
    const currentA = record("current-a", "10", { adjustmentPayload: { stable_key: "current-a", valor: "10" } });
    const currentB = record("current-b", "2", { adjustmentPayload: { stable_key: "current-b", valor: "2" } });
    const p = preview([row("current-a", "1"), row("current-b", "100")]);
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [currentA, currentB], now: "2026-01-01T00:00:00.000Z" });
    const first = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000051", observationId: initial.lines[0].observation.id, locator: "current-a", stableRecordId: currentA.id, outcome: "keep-current", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar o primeiro ajuste vigente.", version: "1" });
    const second = applyReconciliationDecision(first, { id: "20000000-0000-4000-8000-000000000052", observationId: first.lines[1].observation.id, locator: "current-b", stableRecordId: currentB.id, outcome: "keep-current", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:02.000Z", policyVersion: policy.version, rationale: "Preservar o segundo ajuste vigente.", version: "1" });
    expect(orderOfficialLines(second.lines, { field: "valor", kind: "decimal" }, [currentA, currentB]).map((line) => line.observation.locator)).toEqual(["current-b", "current-a"]);
  });

  it("trata payload e proveniência tipada como uma unidade e distingue undefined de objeto vazio", () => {
    const payload = { stable_key: "metadata-only", valor: "2" };
    const p = preview([{
      ...row("metadata-only", "2"),
      normalizedPayload: payload,
      sourceValues: payload,
      decimalSources: {},
      durationSources: {},
    }]);
    const legacy = record("metadata-only", "2", { sourcePayload: payload, decimalSources: undefined, durationSources: undefined });
    const legacyResult = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [legacy], now: "2026-01-01T00:00:00.000Z" });
    expect(legacyResult.lines[0].category).toBe("updated");
    expect(legacyResult.lines[0].fieldDiffs).toEqual([
      { field: "*", original: null, proposed: "{}", originalPresent: false, proposedPresent: true, provenanceKind: "decimal-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
      { field: "*", original: null, proposed: "{}", originalPresent: false, proposedPresent: true, provenanceKind: "duration-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
    ]);

    const explicitEmptyRecord = record("metadata-only", "2", { sourcePayload: payload, decimalSources: {}, durationSources: {} });
    const unknownDurationPreview = preview([{ ...row("metadata-only", "2"), normalizedPayload: payload, sourceValues: payload, decimalSources: {}, durationSources: undefined }]);
    const reverseResult = reconcileConfirmedPreview({ confirmation: confirmation(unknownDurationPreview), preview: unknownDurationPreview, policy, records: [explicitEmptyRecord], now: "2026-01-01T00:00:00.000Z" });
    expect(reverseResult.lines[0].category).toBe("updated");
    expect(reverseResult.lines[0].fieldDiffs).toEqual([
      { field: "*", original: "{}", proposed: null, originalPresent: true, proposedPresent: false, provenanceKind: "duration-source", layer: "source", cause: "A observação aceita atualiza a projeção vigente." },
    ]);

    const protectedUnknown = { ...legacy, adjustmentPayload: payload };
    const protectedUnknownResult = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [protectedUnknown], now: "2026-01-01T00:00:00.000Z" });
    expect(protectedUnknownResult.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "PROTECTED_LAYER" } });
    expect(protectedUnknownResult.lines[0].fieldDiffs).toEqual([
      expect.objectContaining({ field: "*", provenanceKind: "decimal-source", original: null, proposed: "{}" }),
      expect.objectContaining({ field: "*", provenanceKind: "duration-source", original: null, proposed: "{}" }),
    ]);

    const changedProvenance = record("metadata-only", "2", {
      sourcePayload: payload,
      decimalSources: { valor: { source_text: "2,0", source_scale: 1, normalized_value: "2" } },
    });
    const pWithMetadata = preview([{
      ...row("metadata-only", "2"),
      normalizedPayload: payload,
      sourceValues: payload,
      decimalSources: { valor: { source_text: "2.00", source_scale: 2, normalized_value: "2" } },
    }]);
    const sourceResult = reconcileConfirmedPreview({ confirmation: confirmation(pWithMetadata), preview: pWithMetadata, policy, records: [changedProvenance], now: "2026-01-01T00:00:00.000Z" });
    expect(sourceResult.lines[0].category).toBe("updated");
    expect(sourceResult.lines[0].fieldDiffs).toEqual([{
      field: "valor",
      original: '{"normalized_value":"2","source_scale":1,"source_text":"2,0"}',
      proposed: '{"normalized_value":"2","source_scale":2,"source_text":"2.00"}',
      originalPresent: true,
      proposedPresent: true,
      provenanceKind: "decimal-source",
      layer: "source",
      cause: "A observação aceita atualiza a projeção vigente.",
    }]);

    const literalStarRecord = record("metadata-only", "2", {
      sourcePayload: payload,
      decimalSources: { "*": { source_text: "1.0", source_scale: 1, normalized_value: "1.0" } },
      durationSources: undefined,
    });
    const literalStarPreview = preview([{
      ...row("metadata-only", "2"),
      normalizedPayload: payload,
      sourceValues: payload,
      decimalSources: { "*": { source_text: "2.00", source_scale: 2, normalized_value: "2.00" } },
      durationSources: undefined,
    }]);
    const literalStarResult = reconcileConfirmedPreview({ confirmation: confirmation(literalStarPreview), preview: literalStarPreview, policy, records: [literalStarRecord], now: "2026-01-01T00:00:00.000Z" });
    expect(literalStarResult.lines[0].fieldDiffs).toEqual([expect.objectContaining({
      field: "*",
      provenanceKind: "decimal-source",
      original: '{"normalized_value":"1.0","source_scale":1,"source_text":"1.0"}',
      proposed: '{"normalized_value":"2.00","source_scale":2,"source_text":"2.00"}',
      originalPresent: true,
      proposedPresent: true,
    })]);

    const protectedResult = reconcileConfirmedPreview({ confirmation: confirmation(pWithMetadata), preview: pWithMetadata, policy, records: [{ ...changedProvenance, adjustmentPayload: payload }], now: "2026-01-01T00:00:00.000Z" });
    expect(protectedResult.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "PROTECTED_LAYER" } });
  });

  it("sanitiza eventos, reducer e keep-current contra curso e trilha hostis", () => {
    const target = record("sanitized", "1", {
      adjustmentPayload: { stable_key: "sanitized", valor: "1", curso: "não pode sair" },
      decimalSources: {
        valor: { source_text: "1", source_scale: 0, normalized_value: "1" },
        curso: { source_text: "99", source_scale: 0, normalized_value: "99" },
      },
      durationSources: { trilha: { source_text: "60", unit: "minutes" } },
    });
    const p = preview([row("sanitized", "2")]);
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [target] });
    const kept = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000061", observationId: initial.lines[0].observation.id, locator: "sanitized", stableRecordId: target.id, outcome: "keep-current", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar somente conteúdo permitido.", version: "1" });
    kept.lines[0].observation.normalizedPayload.curso = "injeção";
    kept.lines[0].observation.decimalSources.curso = { source_text: "100", source_scale: 0, normalized_value: "100" };
    kept.lines[0].observation.durationSources = { trilha: { source_text: "1", unit: "minutes" } };
    const events = eventsForReconciliation(kept, [target]);
    for (const event of events) {
      expect(event.payload).not.toHaveProperty("curso");
      expect(event.payload).not.toHaveProperty("trilha");
      expect(event.decimalSources).not.toHaveProperty("curso");
      expect(event.durationSources ?? {}).not.toHaveProperty("trilha");
    }
    const reduced = reduceEffectiveProjection(events, [{
      recordId: target.id,
      payload: { valor: "0", curso: "hostil", trilha: "hostil" },
      decimalSources: { curso: { source_text: "1", source_scale: 0, normalized_value: "1" } },
      durationSources: { trilha: { source_text: "1", unit: "minutes" } },
      state: "active",
      version: "0",
    }]);
    expect(reduced[0].payload).toEqual({ stable_key: "sanitized", valor: "1" });
    expect(reduced[0].decimalSources).toEqual({ valor: { source_text: "1", source_scale: 0, normalized_value: "1" } });
    expect(reduced[0].durationSources).toEqual({});
  });

  it("preserva durationSources ausente em evento, projeção e nova classificação", () => {
    const current = record("duration-absent", "1", { durationSources: undefined });
    const p = preview([row("duration-absent", "1")]);
    const first = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [current] });
    expect(first.lines[0].category).toBe("unchanged");
    const [event] = eventsForReconciliation(first, [current]);
    expect(event).not.toHaveProperty("durationSources");
    const previousProjection = { recordId: current.id, payload: current.sourcePayload!, decimalSources: current.decimalSources, durationSources: { duracao: { source_text: "60", unit: "minutes" as const } }, state: "active" as const, version: "0" };
    const [projection] = reduceEffectiveProjection([event], [previousProjection]);
    expect(projection).not.toHaveProperty("durationSources");
    const [fullyUnknownProjection] = reduceEffectiveProjection([{ ...event, decimalSources: undefined }], [previousProjection]);
    expect(fullyUnknownProjection).not.toHaveProperty("decimalSources");
    expect(fullyUnknownProjection).not.toHaveProperty("durationSources");
    const roundTrip: StableRecord = { id: current.id, matchingAttributes: current.matchingAttributes, effectivePayload: projection.payload, effectiveLayer: "source", decimalSources: projection.decimalSources, effectiveVersion: projection.version };
    const second = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [roundTrip] });
    expect(second.lines[0].category).toBe("unchanged");

    const protectedRecordWithoutDuration = record("duration-absent", "1", { adjustmentPayload: current.sourcePayload, durationSources: undefined });
    const changedPreview = preview([row("duration-absent", "2")]);
    const conflict = reconcileConfirmedPreview({ confirmation: confirmation(changedPreview), preview: changedPreview, policy, records: [protectedRecordWithoutDuration] });
    const kept = applyReconciliationDecision(conflict, { id: "20000000-0000-4000-8000-000000000062", observationId: conflict.lines[0].observation.id, locator: "duration-absent", stableRecordId: current.id, outcome: "keep-current", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar duração ausente.", version: "1" });
    const keepEvents = eventsForReconciliation(kept, [protectedRecordWithoutDuration]);
    expect(keepEvents).toHaveLength(2);
    expect(keepEvents[0]).not.toHaveProperty("durationSources");
    expect(keepEvents[1]).not.toHaveProperty("durationSources");
  });

  it.each([10_000, 20_000])("agrupa %i targets duplicados com cardinalidade linear", (count) => {
    const targetCount = count === 10_000 ? count / 2 : 1;
    const records = Array.from({ length: targetCount }, (_, index) => {
      const stableKey = `bulk-key-${index}`;
      return record(`bulk-target-${index}`, "0", { matchingAttributes: { stable_key: stableKey }, sourcePayload: { stable_key: stableKey, valor: "0" } });
    });
    const rows = Array.from({ length: count }, (_, index) => {
      const targetIndex = count === 10_000 ? Math.floor(index / 2) : 0;
      const stableKey = `bulk-key-${targetIndex}`;
      return {
        ...row(`bulk-${String(index).padStart(5, "0")}`, String(index)),
        normalizedPayload: { stable_key: stableKey, valor: String(index) },
        sourceValues: { stable_key: stableKey, valor: String(index) },
        matchingAttributes: { stable_key: stableKey },
      };
    });
    const p = preview(rows);
    const diagnostics: ReconciliationDiagnostics = { targetBucketAppends: 0, targetBucketAllocations: 0, targetRecordLookups: 0 };
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records, diagnostics });
    expect(result.summary).toMatchObject({ total: count, conflict: count });
    expect(diagnostics).toEqual({ targetBucketAppends: count, targetBucketAllocations: targetCount, targetRecordLookups: targetCount });
  });

  it("limita candidatos públicos sem perder a cardinalidade do matching", () => {
    const records = Array.from({ length: 10_000 }, (_, index) => record(`candidate-${String(index).padStart(5, "0")}`, "10", { matchingAttributes: { stable_key: "massive" } }));
    const observation = createSourceObservation({ batchId: sourceIds.batchId, previewId: sourceIds.previewId, sourceFileId: sourceIds.sourceFileId, locator: "massive", sourceRowHash: "a".repeat(64), normalizedPayload: { valor: "10" }, sourceValues: { valor: "10" }, decimalSources: {}, observedAt: "2026-01-01T00:00:00Z", matchingAttributes: { stable_key: "massive" } });
    const match = createRecordMatchResolver(records, policy)(observation);
    expect(match).toMatchObject({ outcome: "multiple", candidateCount: 10_000 });
    expect(match.candidateIds).toHaveLength(MAX_PUBLIC_CANDIDATE_IDS);
  });

  it("trata metadata vazia como clear em source/link e preserva keep-current inclusive missing", () => {
    const oldDecimal = { valor: { source_text: "1.00", source_scale: 2, normalized_value: "1.00" } };
    const oldDuration = { duracao: { source_text: "1:00", unit: "clock" as const } };

    const automaticTarget = record("automatic-target", "1.00", { matchingAttributes: { stable_key: "automatic-target" }, decimalSources: oldDecimal, durationSources: oldDuration });
    const automaticPreview = preview([{ ...row("automatic-target", "2.00"), decimalSources: {}, durationSources: {} }]);
    const automatic = reconcileConfirmedPreview({ confirmation: confirmation(automaticPreview), preview: automaticPreview, policy, records: [automaticTarget], now: "2026-01-01T00:00:00.000Z" });
    expect(automatic.lines[0].category).toBe("updated");
    expect(automatic.metrics).toEqual({ decimalSums: {}, durationSums: {} });
    const automaticEvents = eventsForReconciliation(automatic, [automaticTarget]);
    expect(automaticEvents).toHaveLength(1);
    expect(automaticEvents[0]).toMatchObject({ layer: "source", decimalSources: {}, durationSources: {} });
    expect(reduceEffectiveProjection(automaticEvents, [{ recordId: automaticTarget.id, payload: automaticTarget.sourcePayload!, decimalSources: oldDecimal, durationSources: oldDuration, sourceObservationId: "old", state: "active", version: "old" }])[0])
      .toMatchObject({ decimalSources: {}, durationSources: {} });

    const linkTarget = record("metadata-target", "1.00", { matchingAttributes: { stable_key: "target" }, decimalSources: oldDecimal, durationSources: oldDuration });
    const linkPreview = preview([{ ...row("metadata", "2.00"), matchingAttributes: { stable_key: "missing-target" }, decimalSources: {}, durationSources: {} }]);
    const initialLink = reconcileConfirmedPreview({ confirmation: confirmation(linkPreview), preview: linkPreview, policy, records: [linkTarget], now: "2026-01-01T00:00:00.000Z" });
    expect(initialLink.metrics).toEqual({ decimalSums: { valor: "1.00" }, durationSums: { duracao: "60" } });
    const linked = applyReconciliationDecision(initialLink, { id: "20000000-0000-4000-8000-000000000031", observationId: initialLink.lines[0].observation.id, locator: "metadata", outcome: "link", stableRecordId: linkTarget.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Vínculo explícito para limpar a proveniência.", version: "1" });
    expect(linked.metrics).toEqual({ decimalSums: {}, durationSums: {} });
    const linkEvents = eventsForReconciliation(linked, [linkTarget]);
    expect(linkEvents.map((event) => ({ layer: event.layer, decimalSources: event.decimalSources, durationSources: event.durationSources })))
      .toEqual([{ layer: "source", decimalSources: {}, durationSources: {} }, { layer: "decision", decimalSources: {}, durationSources: {} }]);
    expect(reduceEffectiveProjection(linkEvents, [{ recordId: linkTarget.id, payload: linkTarget.sourcePayload!, decimalSources: oldDecimal, durationSources: oldDuration, sourceObservationId: "old", state: "active", version: "old" }])[0])
      .toMatchObject({ decimalSources: {}, durationSources: {} });

    const protectedTarget = record("protected-target", "1.00", { matchingAttributes: { stable_key: "protected-target" }, adjustmentPayload: { stable_key: "protected-target", valor: "1.00" }, decimalSources: oldDecimal, durationSources: oldDuration });
    const keepPreview = preview([{ ...row("protected-target", "2.00"), decimalSources: {}, durationSources: {} }]);
    const initialKeep = reconcileConfirmedPreview({ confirmation: confirmation(keepPreview), preview: keepPreview, policy, records: [protectedTarget], now: "2026-01-01T00:00:00.000Z" });
    expect(initialKeep.metrics).toEqual({ decimalSums: { valor: "1.00" }, durationSums: { duracao: "60" } });
    const kept = applyReconciliationDecision(initialKeep, { id: "20000000-0000-4000-8000-000000000032", observationId: initialKeep.lines[0].observation.id, locator: "protected-target", outcome: "keep-current", stableRecordId: protectedTarget.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar metadata vigente.", version: "1" });
    expect(kept.metrics).toEqual({ decimalSums: { valor: "1.00" }, durationSums: { duracao: "60" } });
    const keepEvents = eventsForReconciliation(kept, [protectedTarget]);
    expect(keepEvents[0]).toMatchObject({ layer: "source", decimalSources: {}, durationSources: {} });
    expect(keepEvents[1]).toMatchObject({ layer: "decision", decimalSources: oldDecimal, durationSources: oldDuration });
    expect(reduceEffectiveProjection(keepEvents, [{ recordId: protectedTarget.id, payload: protectedTarget.adjustmentPayload!, decimalSources: oldDecimal, durationSources: oldDuration, adjustmentEventId: "adjustment", state: "active", version: "old" }])[0])
      .toMatchObject({ decimalSources: oldDecimal, durationSources: oldDuration });

    const missingTarget = record("missing-target", "1.00", { matchingAttributes: { stable_key: "missing-target" }, adjustmentPayload: { stable_key: "missing-target", valor: "1.00" }, decimalSources: undefined, durationSources: undefined });
    const missingPreview = preview([{ ...row("missing-target", "2.00"), durationSources: { duracao: { source_text: "2:00", unit: "clock" } } }]);
    const initialMissing = reconcileConfirmedPreview({ confirmation: confirmation(missingPreview), preview: missingPreview, policy, records: [missingTarget], now: "2026-01-01T00:00:00.000Z" });
    expect(initialMissing.metrics).toEqual({ decimalSums: {}, durationSums: {} });
    const keptMissing = applyReconciliationDecision(initialMissing, { id: "20000000-0000-4000-8000-000000000033", observationId: initialMissing.lines[0].observation.id, locator: "missing-target", outcome: "keep-current", stableRecordId: missingTarget.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar metadata ausente.", version: "1" });
    expect(keptMissing.metrics).toEqual({ decimalSums: {}, durationSums: {} });
    const missingEvents = eventsForReconciliation(keptMissing, [missingTarget]);
    expect(missingEvents[1]).not.toHaveProperty("decimalSources");
    expect(missingEvents[1]).not.toHaveProperty("durationSources");
    const reducedMissing = reduceEffectiveProjection(missingEvents, [{ recordId: missingTarget.id, payload: missingTarget.adjustmentPayload!, adjustmentEventId: "adjustment", state: "active", version: "old" }])[0];
    expect(reducedMissing).not.toHaveProperty("decimalSources");
    expect(reducedMissing).not.toHaveProperty("durationSources");
  });

  it("preserva missing separado de null no diff", () => {
    const p = preview([{ ...row("presence", "2"), normalizedPayload: { stable_key: "presence", valor: "2", optional: null }, sourceValues: { stable_key: "presence", valor: "2", optional: "" } }]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [record("presence", "2", { sourcePayload: { stable_key: "presence", valor: "2" } })], now: "2026-01-01T00:00:00.000Z" });
    expect(result.lines[0].fieldDiffs).toEqual(expect.arrayContaining([expect.objectContaining({ field: "optional", original: null, proposed: null, originalPresent: false, proposedPresent: true })]));
  });

  it("inclui as métricas exatas no resultado oficial da reconciliação", () => {
    const p = preview([{ ...row("metricas", "1.20"), normalizedPayload: { stable_key: "metricas", valor: "1.20", duracao: "1:00:30" }, sourceValues: { stable_key: "metricas", valor: "1.20", duracao: "1:00:30" }, durationSources: { duracao: { source_text: "1:00:30", unit: "clock" } } }]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [record("metricas", "1.20", { sourcePayload: { stable_key: "metricas", valor: "1.20", duracao: "1:00:30" }, durationSources: { duracao: { source_text: "1:00:30", unit: "clock" } } })], now: "2026-01-01T00:00:00.000Z" });
    expect(result.lines[0].category).toBe("unchanged");
    expect(result.metrics).toEqual({ decimalSums: { valor: "1.20" }, durationSums: { duracao: "3630" } });
  });

  it("inclui ausências e keep-current nas métricas a partir do conteúdo efetivo", () => {
    const observed = record("observed", "10.50", {
      sourcePayload: { stable_key: "observed", valor: "10.50", duracao: "59:59" },
      durationSources: { duracao: { source_text: "59:59", unit: "clock" } },
    });
    const absent = record("absent", "2.5", {
      sourcePayload: { stable_key: "absent", valor: "2.5", duracao: "1:00:01" },
      durationSources: { duracao: { source_text: "1:00:01", unit: "clock" } },
      effectiveVersion: "7",
    });
    const p = preview([{
      ...row("observed", "10.50"),
      normalizedPayload: { stable_key: "observed", valor: "10.50", duracao: "59:59" },
      sourceValues: { stable_key: "observed", valor: "10.50", duracao: "59:59" },
      durationSources: { duracao: { source_text: "59:59", unit: "clock" } },
    }]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [observed, absent], now: "2026-01-01T00:00:00.000Z" });
    expect(result.metrics).toEqual({ decimalSums: { valor: "13.00" }, durationSums: { duracao: "7200" } });
    expect(result.absences).toEqual([expect.objectContaining({ stableRecordId: "absent", effectivePayload: absent.sourcePayload, effectiveVersion: "7" })]);

    const protectedRecordForMetrics = { ...observed, adjustmentPayload: observed.sourcePayload };
    const changed = preview([{
      ...p.rows[0],
      normalizedPayload: { stable_key: "observed", valor: "999.00", duracao: "1" },
      sourceValues: { stable_key: "observed", valor: "999.00", duracao: "1" },
      decimalSources: { valor: { source_text: "999.00", source_scale: 2, normalized_value: "999.00" } },
      durationSources: { duracao: { source_text: "1", unit: "minutes" } },
    }]);
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(changed), preview: changed, policy, records: [protectedRecordForMetrics, absent], now: "2026-01-01T00:00:00.000Z" });
    const kept = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000041", observationId: initial.lines[0].observation.id, locator: "observed", outcome: "keep-current", stableRecordId: observed.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Preservar o conteúdo efetivo e sua proveniência.", version: "1" });
    expect(kept.metrics).toEqual({ decimalSums: { valor: "13.00" }, durationSums: { duracao: "7200" } });
    expect(orderOfficialLines(kept.lines, { field: "valor", kind: "decimal" }, [protectedRecordForMetrics])[0].observation.locator).toBe("observed");
  });

  it("só faz matching com atributos estáveis explicitamente fornecidos", () => {
    const observation = createSourceObservation({ batchId: sourceIds.batchId, previewId: sourceIds.previewId, sourceFileId: sourceIds.sourceFileId, locator: "row:explicit", sourceRowHash: "a".repeat(64), normalizedPayload: { stable_key: "r1", valor: "9.00" }, sourceValues: { stable_key: "r1", valor: "9.00" }, decimalSources: {}, observedAt: "2026-01-01T00:00:00Z" });
    expect(buildRecordMatch(observation, [record("r1", "9")], policy).outcome).toBe("none");
    expect(buildRecordMatch({ ...observation, matchingAttributes: { stable_key: "r1" } }, [record("r1", "9")], policy).outcome).toBe("unique");
  });

  it("mantém link igual como unchanged e ainda audita o ato manual", () => {
    const p = preview([row("manual-igual", "3.00")]);
    const target = record("target", "3.00", { matchingAttributes: { stable_key: "outro" }, sourcePayload: { stable_key: "manual-igual", valor: "3.00" } });
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [target], now: "2026-01-01T00:00:00.000Z" });
    const linked = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000001", observationId: initial.lines[0].observation.id, locator: "manual-igual", outcome: "link", stableRecordId: target.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Vínculo explícito para alvo comprovado.", version: "1" });
    expect(linked.lines[0]).toMatchObject({ category: "unchanged", fieldDiffs: [], decision: { outcome: "link", stableRecordId: target.id } });
    expect(eventsForReconciliation(linked, [target])).toEqual(expect.arrayContaining([expect.objectContaining({ type: "observation.accepted" }), expect.objectContaining({ type: "decision.audit", decisionId: "20000000-0000-4000-8000-000000000001" })]));
  });

  it("não usa ID renumerável, linha, hash ou valor como identidade", () => {
    const observation = createSourceObservation({ batchId: sourceIds.batchId, previewId: sourceIds.previewId, sourceFileId: sourceIds.sourceFileId, locator: "row:2", sourceRowHash: "a".repeat(64), normalizedPayload: { codigo: "7", valor: "10" }, sourceValues: { codigo: "7", valor: "10" }, decimalSources: {}, observedAt: "2026-01-01T00:00:00Z" });
    expect(() => buildRecordMatch(observation, [record("r1", "10")], { ...policy, fields: ["codigo"] })).toThrow();
    expect(() => buildRecordMatch(observation, [record("r1", "10")], { ...policy, fields: ["valor"] })).toThrow();
  });

  it("classifica inserção, atualização, inalteração, rejeição e conflitos sem fundir ambiguidade", () => {
    const p = preview([row("novo", "1"), row("atual", "2"), row("igual", "3"), row("ruim", "4", "rejected"), row("ambigua", "5")]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [record("atual", "1"), record("igual", "3"), record("ambigua-1", "4"), record("ambigua-2", "4")], now: "2026-01-01T00:00:00.000Z" });
    expect(result.lines.map((line) => line.category)).toEqual(["conflict", "updated", "unchanged", "rejected", "conflict"]);
    expect(result.summary).toMatchObject({ conflict: 2, updated: 1, unchanged: 1, rejected: 1, inserted: 0, pendingDecisions: 2 });
  });

  it("preserva ausência e abre conflito para ajuste, decisão e desconsideração", () => {
    const p = preview([row("ajustado", "2"), row("decidido", "3"), row("desconsiderado", "4")]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [record("ajustado", "1", { adjustmentPayload: { stable_key: "ajustado", valor: "1.5" }, adjustmentRevision: "2" }), record("decidido", "1", { auditedDecisionPayload: { stable_key: "decidido", valor: "1.5" }, decisionVersion: "4" }), record("desconsiderado", "1", { state: "disregarded" }), record("ausente", "8")], now: "2026-01-01T00:00:00.000Z" });
    expect(result.lines.every((line) => line.category === "conflict")).toBe(true);
    expect(result.absences.map((absence) => absence.stableRecordId)).toEqual(["ausente"]);
    expect(result.lines.map((line) => line.conflict?.code)).toEqual(["PROTECTED_LAYER", "PROTECTED_LAYER", "DISREGARDED_RECORD"]);
  });

  it("calcula ausência pela observação do alvo, inclusive conflito, reject, redirect e keep-current", () => {
    const protectedTarget = record("protected", "1", { adjustmentPayload: { stable_key: "protected", valor: "1" } });
    const redirectTarget = record("redirect", "8");
    const keepTarget = record("keep", "2", { auditedDecisionPayload: { stable_key: "keep", valor: "2" } });
    const duplicateTarget = record("duplicate", "3", { matchingAttributes: { stable_key: "duplicate-key" }, sourcePayload: { stable_key: "duplicate-key", valor: "3" } });
    const absentTarget = record("absent-only", "9");
    const p = preview([
      row("protected", "10"),
      row("keep", "20"),
      { ...row("duplicate-a", "30"), normalizedPayload: { stable_key: "duplicate-key", valor: "30" }, sourceValues: { stable_key: "duplicate-key", valor: "30" }, matchingAttributes: { stable_key: "duplicate-key" } },
      { ...row("duplicate-b", "31"), normalizedPayload: { stable_key: "duplicate-key", valor: "31" }, sourceValues: { stable_key: "duplicate-key", valor: "31" }, matchingAttributes: { stable_key: "duplicate-key" } },
    ]);
    const records = [protectedTarget, redirectTarget, keepTarget, duplicateTarget, absentTarget];
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records });
    expect(initial.lines.map((line) => line.conflict?.code)).toEqual(["PROTECTED_LAYER", "PROTECTED_LAYER", "DUPLICATE_TARGET", "DUPLICATE_TARGET"]);
    expect(initial.absences.map((item) => item.stableRecordId)).toEqual(["absent-only", "redirect"]);

    const rejected = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000081", observationId: initial.lines[0].observation.id, locator: "protected", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Rejeitar sem apagar a cobertura observada.", version: "1" });
    expect(rejected.lines[0].stableRecordId).toBeUndefined();
    expect(rejected.absences.map((item) => item.stableRecordId)).toEqual(["absent-only", "redirect"]);

    const redirected = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000082", observationId: initial.lines[0].observation.id, locator: "protected", stableRecordId: redirectTarget.id, outcome: "link", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Redirecionar somente para o alvo escolhido.", version: "1" });
    expect(redirected.absences.map((item) => item.stableRecordId)).toEqual(["absent-only", "protected"]);

    const kept = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000083", observationId: initial.lines[1].observation.id, locator: "keep", stableRecordId: keepTarget.id, outcome: "keep-current", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Manter a camada protegida observada.", version: "1" });
    expect(kept.absences.map((item) => item.stableRecordId)).toEqual(["absent-only", "redirect"]);
    expect(kept.absences.some((item) => item.stableRecordId === duplicateTarget.id)).toBe(false);
  });

  it("mantém camada protegida igual e não funde linhas iguais distintas", () => {
    const protectedRecord = record("igual-protegido", "3", { matchingAttributes: { stable_key: "igual" }, auditedDecisionPayload: { stable_key: "igual", valor: "3" }, decisionEventId: "decision-1" });
    const p = preview([row("igual", "3"), { ...row("igual-2", "3"), normalizedPayload: { stable_key: "igual", valor: "3", curso: "segredo" }, sourceValues: { stable_key: "igual", valor: "3", curso: "segredo" }, matchingAttributes: { stable_key: "igual" } }]);
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [protectedRecord], now: "2026-01-01T00:00:00.000Z" });
    expect(result.lines.map((line) => line.category)).toEqual(["conflict", "conflict"]);
    expect(result.lines.every((line) => line.conflict?.code === "DUPLICATE_TARGET")).toBe(true);
    expect(result.lines.every((line) => line.consequence.includes("mesmo registro estável"))).toBe(true);
    expect(result.lines.every((line) => line.fieldDiffs.every((diff) => diff.cause.includes("mesmo registro estável")))).toBe(true);
  });

  it("resolve DUPLICATE_TARGET com uma decisão por linha e produz efeito para um único alvo", () => {
    const target = record("duplicate-target", "2", { matchingAttributes: { stable_key: "duplicate" }, sourcePayload: { stable_key: "duplicate", valor: "2" } });
    const p = preview([
      { ...row("duplicate-a", "2"), normalizedPayload: { stable_key: "duplicate", valor: "2", curso: "segredo" }, sourceValues: { stable_key: "duplicate", valor: "2", curso: "segredo" }, matchingAttributes: { stable_key: "duplicate" } },
      { ...row("duplicate-b", "3"), normalizedPayload: { stable_key: "duplicate", valor: "3", curso: "segredo" }, sourceValues: { stable_key: "duplicate", valor: "3", curso: "segredo" }, matchingAttributes: { stable_key: "duplicate" } },
    ]);
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [target], now: "2026-01-01T00:00:00.000Z" });
    expect(initial.lines.map((line) => line.conflict?.code)).toEqual(["DUPLICATE_TARGET", "DUPLICATE_TARGET"]);
    const rejected = applyReconciliationDecision(initial, { id: "20000000-0000-4000-000000000010", observationId: initial.lines[0].observation.id, locator: "duplicate-a", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "A primeira linha não deve gerar efeito.", version: "1" });
    const resolved = applyReconciliationDecision(rejected, { id: "20000000-0000-4000-000000000011", observationId: rejected.lines[1].observation.id, locator: "duplicate-b", outcome: "link", stableRecordId: target.id, actor: "Rodrigo", decidedAt: "2026-01-01T00:00:02.000Z", policyVersion: policy.version, rationale: "A segunda linha é o vínculo escolhido para o alvo.", version: "1" });
    expect(resolved.status).toBe("ready-to-apply");
    expect(resolved.lines.map((line) => line.category)).toEqual(["rejected", "updated"]);
    expect(resolved.conflicts.every((conflict) => conflict.resolution)).toBe(true);
    expect(eventsForReconciliation(resolved, [target])).toHaveLength(2);
  });

  it("aplica decisão explícita e o reducer deriva a projeção somente de eventos", () => {
    const p = preview([row("novo", "1")]);
    const observationId = "10000000-0000-4000-8000-000000000006";
    expect(() => reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [], decisions: [{ id: "10000000-0000-4000-8000-000000000007", observationId, locator: "novo", outcome: "create", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:00.000Z", policyVersion: policy.version, rationale: "Novo registro confirmado", version: "1" }] })).toThrow("Decisões devem ser registradas pelo comando de decisão separado");
    const result = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [] });
    expect(result.status).toBe("needs-decision");
    const event: EffectiveRecordEvent = { id: "10000000-0000-4000-8000-000000000008", reconciliationId: result.id, recordId: createStableRecordId(), type: "record.inserted", layer: "source", observationId: result.lines[0].observation.id, payload: result.lines[0].observation.normalizedPayload, actor: "Rodrigo", occurredAt: "2026-01-01T00:00:00.000Z", version: "1" };
    expect(reduceEffectiveProjection([event])[0]).toMatchObject({ payload: { stable_key: "novo", valor: "1" }, sourceObservationId: result.lines[0].observation.id });
  });

  it("mantém a precedência quando um evento de camada inferior chega depois", () => {
    const recordId = createStableRecordId();
    const adjustment: EffectiveRecordEvent = { id: createStableRecordId(), recordId, type: "adjustment.revised", layer: "adjustment", payload: { valor: "2" }, actor: "Rodrigo", occurredAt: "2026-01-02T00:00:00.000Z", version: "2" };
    const source: EffectiveRecordEvent = { id: createStableRecordId(), recordId, type: "observation.accepted", layer: "source", payload: { valor: "1" }, actor: "Rodrigo", occurredAt: "2026-01-03T00:00:00.000Z", version: "3" };
    expect(reduceEffectiveProjection([adjustment, source])[0]).toMatchObject({ payload: { valor: "2" }, adjustmentEventId: adjustment.id, version: "2" });
  });

  it("reduz eventos do mesmo instante de modo determinístico e preserva a origem", () => {
    const recordId = createStableRecordId();
    // The decision UUID sorts before the source UUID. Layer precedence, not
    // UUID order or input order, must still reduce source before decision.
    const source: EffectiveRecordEvent = { id: "10000000-0000-4000-8000-000000000029", recordId, type: "observation.accepted", layer: "source", observationId: "10000000-0000-4000-8000-000000000022", payload: { valor: "10" }, actor: "Rodrigo", occurredAt: "2026-01-01T00:00:00.000Z", version: "source-version" };
    const decision: EffectiveRecordEvent = { id: "10000000-0000-4000-8000-000000000020", recordId, type: "decision.audit", layer: "decision", observationId: source.observationId, payload: { valor: "30" }, actor: "Rodrigo", occurredAt: source.occurredAt, version: "decision-version" };
    expect(reduceEffectiveProjection([decision, source])).toEqual(reduceEffectiveProjection([source, decision]));
    expect(reduceEffectiveProjection([decision, source])[0]).toMatchObject({ payload: { valor: "30" }, sourceObservationId: source.observationId, decisionEventId: decision.id, version: "decision-version" });
  });

  it("retusa uma confirmação divergente e exclui campos ignorados do hash e payload", () => {
    const p = preview();
    expect(() => reconcileConfirmedPreview({ confirmation: { ...confirmation(p), previewHash: "0".repeat(64) }, preview: p, policy, records: [] })).toThrow();
    const observation = createSourceObservation({ batchId: sourceIds.batchId, previewId: sourceIds.previewId, sourceFileId: sourceIds.sourceFileId, locator: "row:2", sourceRowHash: "a".repeat(64), normalizedPayload: { stable_key: "x", curso: "um" }, sourceValues: { stable_key: "x", curso: "um" }, decimalSources: { curso: { source_text: "um", source_scale: 0, normalized_value: null } }, observedAt: "2026-01-01T00:00:00Z" });
    const copy = createSourceObservation({ ...observation, normalizedPayload: { stable_key: "x", curso: "dois" }, sourceValues: { stable_key: "x", curso: "dois" } });
    expect(observation.normalizedPayload).toEqual({ stable_key: "x" });
    expect(observation.functionalHash).toBe(copy.functionalHash);

    const ignoredMetadataPreview = preview([row("igual-ignorado", "1")]);
    const ignoredMetadataRecord = record("igual-ignorado", "1", { decimalSources: {
      valor: { source_text: "1", source_scale: 0, normalized_value: "1" },
      curso: { source_text: "99", source_scale: 0, normalized_value: "99" },
    } });
    const ignoredMetadataResult = reconcileConfirmedPreview({ confirmation: confirmation(ignoredMetadataPreview), preview: ignoredMetadataPreview, policy, records: [ignoredMetadataRecord] });
    expect(ignoredMetadataResult.lines[0].category).toBe("unchanged");
    expect(ignoredMetadataResult.metrics?.decimalSums).toEqual({ valor: "1" });
  });

  it("persiste decisões, aplica atomicamente e repete sem duplicar efeitos", async () => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const p = preview([row("novo", "1")]);
      const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
      const service = new SourceReconciliationService(repository);
      const initial = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000009", idempotencyKey: "reconcile-1", confirmation: confirmation(p), preview: p, policy });
      expect(initial.reconciliation.status).toBe("needs-decision");
      const decided = await service.recordDecision({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000010", reconciliationId: initial.reconciliation.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "novo", outcome: "create", policyVersion: policy.version, rationale: "Criar o novo registro", version: "1" } });
      expect(decided.status).toBe("ready-to-apply");
      expect(decided.decision.stableRecordId).toEqual(expect.any(String));
      const rootKeyReplay = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-000000000010", idempotencyKey: "reconcile-1", confirmation: confirmation(p), preview: p, policy });
      expect(rootKeyReplay.reused).toBe(true);
      expect(rootKeyReplay.reconciliation.id).toBe(decided.id);
      expect(rootKeyReplay.reconciliation.decisions).toHaveLength(1);
      const repeatedDecision = await service.recordDecision({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000010", reconciliationId: decided.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "novo", outcome: "create", policyVersion: policy.version, rationale: "Criar o novo registro", version: "1" } });
      expect(repeatedDecision.id).toBe(decided.id);
      const applied = await service.applyReconciliation({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000011", reconciliationId: decided.id, idempotencyKey: "apply-1" });
      expect(applied).toMatchObject({ reused: false, eventCount: 1 }); expect(applied).not.toHaveProperty("events"); expect(applied).not.toHaveProperty("projections"); expect(applied).not.toHaveProperty("snapshot"); expect(applied).not.toHaveProperty("audit"); expect(repository.eventCount).toBe(1); expect(repository.projectionCount).toBe(1);
      const replay = await service.applyReconciliation({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000012", reconciliationId: decided.id, idempotencyKey: "apply-1" });
      expect(replay.reused).toBe(true); expect(repository.eventCount).toBe(1); expect(repository.projectionCount).toBe(1);
      const confirmationReplay = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000016", idempotencyKey: "reconcile-new-transport-key", confirmation: confirmation(p), preview: p, policy, decisions: [decided.decision] });
      expect(confirmationReplay.reused).toBe(true);
      expect(confirmationReplay.reconciliation.id).toBe(decided.id);
      expect(repository.eventCount).toBe(1);
      await expect(service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000017", idempotencyKey: "reconcile-divergent-replay", confirmation: confirmation(p), preview: p, policy, decisions: [{ ...decided.decision, rationale: "Decisão divergente" }] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("mantém projeção inicial, aliases e snapshots históricos no adapter em memória", async () => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const observed = record("observed", "10.00", { effectiveVersion: "old-observed" });
      const absent = record("absent", "2.50", { sourcePayload: { stable_key: "absent", valor: "1.00", note: "obsolete-source" }, adjustmentPayload: { stable_key: "absent", valor: "2.50", note: "preserve-me" }, effectiveVersion: "old-absent" });
      const repository = new InMemorySourceReconciliationRepository([observed, absent], TEST_CURSOR_KEY);
      const service = new SourceReconciliationService(repository);
      expect(repository.projectionCount).toBe(2);

      const firstPreview = preview([row("observed", "10.00")]);
      const first = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "memory-initial", idempotencyKey: "memory-reconcile-1", confirmation: confirmation(firstPreview), preview: firstPreview, policy });
      expect(first.reconciliation.status).toBe("ready-to-apply");
      const applied = await service.applyReconciliation({ actor: "Rodrigo", requestId: "memory-apply-1", reconciliationId: first.reconciliation.id, idempotencyKey: "memory-apply-key-1" });
      expect(applied).not.toHaveProperty("snapshot");
      const firstSnapshot = await repository.findSnapshotByReconciliation(first.reconciliation.id);
      expect(firstSnapshot?.projection.map((item) => item.recordId)).toEqual(["absent", "observed"]);
      expect(firstSnapshot?.projection.find((item) => item.recordId === "absent")).toMatchObject({ payload: absent.adjustmentPayload, adjustmentEventId: expect.any(String), version: "old-absent" });
      expect(await repository.listAbsences(first.reconciliation.id, { page: 0, pageSize: 50 })).toMatchObject({ total: "1", absences: [expect.objectContaining({ stableRecordId: "absent", effectivePayload: absent.adjustmentPayload, effectiveVersion: "old-absent" })] });

      await service.applyReconciliation({ actor: "Rodrigo", requestId: "memory-apply-alias", reconciliationId: first.reconciliation.id, idempotencyKey: "memory-apply-key-2" });
      expect(repository.appliedCount).toBe(1);
      expect(repository.auditEventCount).toBe(1);
      expect(repository.eventCount).toBe(1);

      const secondPreview = {
        ...preview([row("observed", "11.00")]),
        previewId: "10000000-0000-4000-8000-000000000044",
        batchId: "10000000-0000-4000-8000-000000000043",
        previewHash: "1".repeat(64),
      } satisfies Preview;
      const secondConfirmation = { ...confirmation(secondPreview), confirmationId: "10000000-0000-4000-8000-000000000045" } satisfies PreviewConfirmation;
      const second = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "memory-reconcile-2", idempotencyKey: "memory-reconcile-key-2", confirmation: secondConfirmation, preview: secondPreview, policy });
      await service.applyReconciliation({ actor: "Rodrigo", requestId: "memory-apply-2", reconciliationId: second.reconciliation.id, idempotencyKey: "memory-apply-key-3" });
      expect(await repository.findSnapshotByReconciliation(first.reconciliation.id)).toEqual(firstSnapshot);
      expect((await repository.listAbsences(first.reconciliation.id, { page: 0, pageSize: 50 })).absences[0]).toMatchObject({ stableRecordId: "absent", effectivePayload: absent.adjustmentPayload, effectiveVersion: "old-absent" });

      const stalePreview = {
        ...preview([row("observed", "12.00")]),
        previewId: "10000000-0000-4000-8000-000000000054",
        batchId: "10000000-0000-4000-8000-000000000053",
        previewHash: "2".repeat(64),
      } satisfies Preview;
      const staleConfirmation = { ...confirmation(stalePreview), confirmationId: "10000000-0000-4000-8000-000000000055" } satisfies PreviewConfirmation;
      const stale = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "memory-stale", idempotencyKey: "memory-reconcile-stale", confirmation: staleConfirmation, preview: stalePreview, policy, baseProjectionVersion: "0" });
      await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: "memory-stale-apply", reconciliationId: stale.reconciliation.id, idempotencyKey: "memory-stale-apply-key" })).rejects.toMatchObject({ code: "PROJECTION_VERSION_CONFLICT" });
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("aplica o contrato explícito de busca sobre identidade, atributos e payload efetivo allowlisted", async () => {
    const adjusted = record("10000000-0000-4000-8000-000000000010", "1", {
      matchingAttributes: { Search_Key: "MiXeD-Value" },
      adjustmentPayload: { valor: "Adjustment-Search", note: "private-adjustment", arbitrary: "hidden" }, effectiveVersion: "2",
    });
    const decided = record("20000000-0000-4000-8000-000000000010", "1", {
      auditedDecisionPayload: { codigo: "Decision_Search", note: "private-decision" }, effectiveVersion: "3",
    });
    const disregarded = record("30000000-0000-4000-8000-000000000010", "1", {
      state: "disregarded", matchingAttributes: { reason: "must-not-match" }, sourcePayload: { valor: "must-not-match" },
    });
    const literal = record("40000000-0000-4000-8000-000000000010", "1", { sourcePayload: { valor: "literal-%_\\-value" } });
    const reserved = record("50000000-0000-4000-8000-000000000010", "1", {
      matchingAttributes: { Curso: "opaque-course", TrIlHa: "opaque-track", safe_key: "public-safe" }, sourcePayload: { valor: "ordinary" },
    });
    const repository = new InMemorySourceReconciliationRepository([adjusted, decided, disregarded, literal, reserved], TEST_CURSOR_KEY);
    const reconciliationId = await pageRoot(repository);
    for (const [query, id] of [
      ["10000000-0000", adjusted.id], ["search_key", adjusted.id], ["  mixed-value  ", adjusted.id],
      ["adjustment-search", adjusted.id], ["decision_search", decided.id], ["%_\\", literal.id],
    ]) {
      await expect(repository.searchStableRecords({ reconciliationId, query })).resolves.toMatchObject({ total: "1", records: [expect.objectContaining({ id })] });
    }
    for (const query of ["private-adjustment", "private-decision", "hidden", "must-not-match", "note", "valor=adjustment", "{\"", "curso", "trilha", "opaque-course", "opaque-track"]) {
      await expect(repository.searchStableRecords({ reconciliationId, query })).resolves.toMatchObject({ total: "0", records: [] });
    }
    await expect(repository.searchStableRecords({ reconciliationId, query: "public-safe" })).resolves.toMatchObject({
      total: "1", records: [{ id: reserved.id, matchingAttributes: { safe_key: "public-safe" } }],
    });
    expect(matchesStableRecordSearch(adjusted, normalizeStableRecordSearchQuery(" MIXED-VALUE "))).toBe(true);
    expect(matchesStableRecordSearch(disregarded, "must-not-match")).toBe(false);
    await expect(repository.listStableRecords()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: adjusted.id, effectiveLayer: "adjustment", effectivePayload: expect.objectContaining({ note: "private-adjustment" }) }),
      expect.objectContaining({ id: decided.id, effectiveLayer: "decision", effectivePayload: expect.objectContaining({ note: "private-decision" }) }),
    ]));
    expect(reduceEffectiveProjection(repository.allEvents)).toEqual(repository.allProjections);
    expect(repository.eventCount).toBe(0);
  });

  it.each([
    [new ReconciliationIntegrityFailure(), "RECONCILIATION_INTEGRITY_FAILURE"],
    [new ReconciliationNotFoundFailure(), "RECONCILIATION_NOT_FOUND"],
  ])("expõe o código público exato de falhas da página de ausências", async (failure, code) => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE, runtime: process.env.TRIA_RUNTIME };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-adjustments-absence-error-test";
    delete process.env.TRIA_RUNTIME;
    try {
      const repository = new InMemorySourceReconciliationRepository([record("10000000-0000-4000-8000-000000000019", "1")], TEST_CURSOR_KEY);
      const reconciliationId = await pageRoot(repository);
      vi.spyOn(repository, "listAbsences").mockRejectedValueOnce(failure);
      const service = new SourceReconciliationService(repository);
      await expect(service.listAbsences({ actor: "Rodrigo", requestId: "absence-error-code", reconciliationId, page: 0, pageSize: 1 })).rejects.toMatchObject({ code });
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace, TRIA_RUNTIME: previous.runtime })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it("recusa continuação quando a projeção ou o catálogo muda", async () => {
    const id1 = "10000000-0000-4000-8000-000000000001";
    const id2 = "30000000-0000-4000-8000-000000000001";
    const repository = new InMemorySourceReconciliationRepository([record(id1, "1"), record(id2, "2")], TEST_CURSOR_KEY);
    const reconciliationId = await pageRoot(repository);
    const first = await repository.searchStableRecords({ reconciliationId, page: 0, pageSize: 1 });
    expect(first).toMatchObject({ total: "2", records: [{ id: id1 }] });
    const internal = repository as unknown as { records: Map<string, StableRecord>; version: bigint };
    internal.records.set("20000000-0000-4000-8000-000000000001", record("20000000-0000-4000-8000-000000000001", "1.5"));
    internal.version = 1n;
    await expect(repository.searchStableRecords({ reconciliationId, page: 1, pageSize: 1, cursor: first.nextCursor })).rejects.toThrow(/projeção vigente/);
  });

  it("mantém cursor de ausências da leaf imutável após projeção global posterior", async () => {
    const ids = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"];
    const repository = new InMemorySourceReconciliationRepository(ids.map((id, index) => record(id, String(index + 1))), TEST_CURSOR_KEY);
    const reconciliationId = await pageRoot(repository);
    const first = await repository.listAbsences(reconciliationId, { page: 0, pageSize: 1 });
    expect(first).toMatchObject({ absences: [{ stableRecordId: ids[0] }] });
    (repository as unknown as { version: bigint }).version = 9n;
    const second = await repository.listAbsences(reconciliationId, { page: 1, pageSize: 1, cursor: first.nextCursor });
    expect(second).toMatchObject({ absences: [{ stableRecordId: ids[1] }] });
  });

  it("restringe ausência interativa à leaf e preserva leitura histórica do repository", async () => {
    const previous={upload:process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD,isolated:process.env.TRIA_INTEGRATION_ISOLATED,namespace:process.env.TRIA_INTEGRATION_NAMESPACE};
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD="synthetic-fixtures-only";process.env.TRIA_INTEGRATION_ISOLATED="confirmed";process.env.TRIA_INTEGRATION_NAMESPACE="tria-evidence-absence-history";
    try {
      const stableId="90000000-0000-4000-8000-000000000301",repository=new InMemorySourceReconciliationRepository([record(stableId,"9")],TEST_CURSOR_KEY),service=new SourceReconciliationService(repository),p=preview([row("absence-stale","1")]);
      const root=await service.reconcileConfirmedPreview({actor:"Rodrigo",requestId:"absence-root",idempotencyKey:"absence-root",confirmation:confirmation(p),preview:p,policy});
      await service.recordDecision({actor:"Rodrigo",requestId:"absence-decision",reconciliationId:root.reconciliation.id,decision:{observationId:root.reconciliation.lines[0].observation.id,locator:"absence-stale",outcome:"create",policyVersion:policy.version,rationale:"Criar identidade separada.",version:"1"}});
      await expect(service.listAbsences({actor:"Rodrigo",requestId:"absence-public",reconciliationId:root.reconciliation.id,page:0,pageSize:10})).rejects.toMatchObject({code:"REVISION_CONFLICT"});
      await expect(repository.listAbsences(root.reconciliation.id,{page:0,pageSize:10})).resolves.toMatchObject({absences:[expect.objectContaining({stableRecordId:stableId})]});
    } finally {for(const [key,value] of Object.entries({TRIA_CONSOLIDATED_SOURCE_UPLOAD:previous.upload,TRIA_INTEGRATION_ISOLATED:previous.isolated,TRIA_INTEGRATION_NAMESPACE:previous.namespace})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  });

  it("vincula cursores opacos a leaf, query, página e page size no adapter em memória", async () => {
    const records = [record("10000000-0000-4000-8000-000000000001", "1"), record("20000000-0000-4000-8000-000000000001", "2")];
    const repository = new InMemorySourceReconciliationRepository(records, TEST_CURSOR_KEY);
    const reconciliationId = await pageRoot(repository);
    const first = await repository.searchStableRecords({ reconciliationId, query: "", page: 0, pageSize: 1 });
    const cursor = first.nextCursor;
    expect(cursor).toBeTruthy();
    expect(cursor).not.toContain(records[0].id);
    await expect(repository.searchStableRecords({ reconciliationId, query: "outra", page: 1, pageSize: 1, cursor })).rejects.toThrow(/Cursor/);
    await expect(repository.searchStableRecords({ reconciliationId, page: 2, pageSize: 1, cursor })).rejects.toThrow(/Cursor/);
    await expect(repository.searchStableRecords({ reconciliationId, page: 1, pageSize: 2, cursor })).rejects.toThrow(/Cursor/);
    await expect(repository.searchStableRecords({ reconciliationId, page: 1, pageSize: 1, cursor: `${cursor}x` })).rejects.toThrow(/Cursor/);
    await expect(repository.searchStableRecords({ reconciliationId, page: 0, pageSize: 1, cursor })).rejects.toThrow(/primeira página/);
    await expect(repository.searchStableRecords({ reconciliationId, page: 1, pageSize: 1 })).rejects.toThrow(/cursor da página anterior/);
    await expect(repository.listAbsences(reconciliationId, { page: 1, pageSize: 1, cursor })).rejects.toThrow(/Cursor/);
    const otherRepository = new InMemorySourceReconciliationRepository(records, TEST_CURSOR_KEY);
    const otherLeaf = await pageRoot(otherRepository);
    await expect(otherRepository.searchStableRecords({ reconciliationId: otherLeaf, page: 1, pageSize: 1, cursor })).rejects.toThrow(/Cursor/);
    const encoded = cursor!.split(".")[0]!;
    const publicKnownCodeSignature = createHmac("sha256", Buffer.alloc(32, 0x11)).update(encoded).digest("base64url");
    await expect(repository.searchStableRecords({ reconciliationId, page: 1, pageSize: 1, cursor: `${encoded}.${publicKnownCodeSignature}` })).rejects.toThrow(/Cursor/);
  });

  it("falha fechada sem chave server-side de cursor", () => {
    expect(() => new InMemorySourceReconciliationRepository([], undefined)).toThrow(/Chave server-side de cursor indisponível/);
  });

  it("deriva seeds desconsiderados e nunca os reativa na reimportação", () => {
    const disregardedSource = record("disregarded-source", "1", { state: "disregarded" });
    const disregardedAdjustment = record("disregarded-adjustment", "2", { state: "disregarded", adjustmentPayload: { stable_key: "disregarded-adjustment", valor: "2" } });
    const disregardedDecision = record("disregarded-decision", "3", { state: "disregarded", auditedDecisionPayload: { stable_key: "disregarded-decision", valor: "3" } });
    const repository = new InMemorySourceReconciliationRepository([disregardedSource, disregardedAdjustment, disregardedDecision], TEST_CURSOR_KEY);
    expect(reduceEffectiveProjection(repository.allEvents)).toEqual(repository.allProjections);
    expect(repository.allEvents.every((event) => event.state === "disregarded")).toBe(true);
    expect(repository.allProjections.every((projection) => projection.state === "disregarded")).toBe(true);
    expect(repository.eventCount).toBe(0);

    const p = preview([row("disregarded-source", "9")]);
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [disregardedSource] });
    expect(initial.lines[0]).toMatchObject({ category: "conflict", conflict: { code: "DISREGARDED_RECORD" } });
    const rejected = applyReconciliationDecision(initial, { id: "20000000-0000-4000-8000-000000000071", observationId: initial.lines[0].observation.id, locator: "disregarded-source", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Não reativar o registro desconsiderado.", version: "1" });
    expect(eventsForReconciliation(rejected, [disregardedSource])).toEqual([]);
    expect(reduceEffectiveProjection([], repository.allProjections).find((projection) => projection.recordId === disregardedSource.id)?.state).toBe("disregarded");
  });

  it("mantém target rejeitado fora das ausências após aplicação in-memory", async () => {
    const target = record("reject-covered", "1", { adjustmentPayload: { stable_key: "reject-covered", valor: "1" } });
    const p = preview([row("reject-covered", "2")]);
    const root = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [target] });
    const repository = new InMemorySourceReconciliationRepository([target], TEST_CURSOR_KEY);
    await repository.saveReconciliation({ reconciliation: root, fingerprint: root.fingerprint, idempotencyKey: "reject-covered-root" });
    const decision = { id: "20000000-0000-4000-8000-000000000091", observationId: root.lines[0].observation.id, locator: "reject-covered", outcome: "reject" as const, actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: "Rejeitar a observação sem apagar sua cobertura.", version: "1" };
    const decided = await repository.saveDecision(root.id, decision);
    await repository.applyReconciliation({ actor: "Rodrigo", requestId: "reject-covered-apply", reconciliationId: decided.reconciliation.id, idempotencyKey: "reject-covered-apply-key" });
    await expect(repository.listAbsences(decided.reconciliation.id, { page: 0, pageSize: 50 })).resolves.toEqual({ page: 0, pageSize: 50, total: "0", absences: [] });
  });

  it("indexa linhas e eventos fonte uma vez na aplicação de N creates", async () => {
    const count = 1_000;
    const p = preview(Array.from({ length: count }, (_, index) => row(`create-${index}`, String(index))));
    const initial = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [] });
    const lines = initial.lines.map((line, index) => ({ ...line, category: "inserted" as const, stableRecordId: `created-record-${index}`, conflict: undefined, consequence: "Identidade alocada para o teste linear." }));
    const ready = { ...initial, lines, conflicts: [], status: "ready-to-apply" as const, summary: { inserted: count, updated: 0, unchanged: 0, rejected: 0, conflict: 0, total: count, absent: 0, pendingDecisions: 0 } };
    const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
    await repository.saveReconciliation({ reconciliation: ready, fingerprint: ready.fingerprint, idempotencyKey: "linear-create-root" });
    const result = await repository.applyReconciliation({ actor: "Rodrigo", requestId: "linear-create-apply", reconciliationId: ready.id, idempotencyKey: "linear-create-apply-key" });
    expect(result.events).toHaveLength(count);
    expect(repository.diagnostics.applyLineLookups).toBe(count);
    expect(repository.diagnostics.applySourceEventLookups).toBe(count);
  });

  it("mantém leaf O(1) por índice em 1.000 revisões e escolhe a maior base por preview", async () => {
    const p = preview([row("indexed-leaf", "1")]);
    const root = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [], baseProjectionVersion: "0", reconciliationId: "indexed-root" });
    const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
    await repository.saveReconciliation({ reconciliation: root, fingerprint: root.fingerprint, idempotencyKey: "indexed-root-key" });
    let currentId = root.id;
    for (let index = 1; index <= 1_000; index += 1) {
      const stored = await repository.saveDecision(currentId, { id: `indexed-decision-${index}`, observationId: root.lines[0].observation.id, locator: "indexed-leaf", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: policy.version, rationale: `Revisão indexada ${index}.`, version: String(index) });
      currentId = stored.reconciliation.id;
    }
    expect(repository.diagnostics.leafIndexUpdates).toBe(1_000);
    expect(repository.diagnostics.leafLookups).toBe(1_000);
    await expect(repository.findReconciliationLeaf(root.id)).resolves.toMatchObject({ reconciliation: { id: currentId, revisionNo: "1001" } });
    expect(repository.diagnostics.leafLookups).toBe(1_001);

    const newerBase = reconcileConfirmedPreview({ confirmation: confirmation(p), preview: p, policy, records: [], baseProjectionVersion: "5", reconciliationId: "indexed-newer-base" });
    await repository.saveReconciliation({ reconciliation: newerBase, fingerprint: newerBase.fingerprint, idempotencyKey: "indexed-newer-base-key" });
    await expect(repository.findReconciliationByPreview(p.previewId)).resolves.toMatchObject({ reconciliation: { id: newerBase.id, baseProjectionVersion: "5" } });
    expect(repository.diagnostics.previewRootScans).toBe(2);
  }, 20_000);

  it("converge retry concorrente e tipa divergência com a leaf atual", async () => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const p = preview([row("retry", "1")]);
      const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
      const service = new SourceReconciliationService(repository);
      const initial = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000016", idempotencyKey: "reconcile-retry", confirmation: confirmation(p), preview: p, policy });
      const command = { actor: "Rodrigo" as const, requestId: "10000000-0000-4000-8000-000000000017", reconciliationId: initial.reconciliation.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "retry", outcome: "create" as const, policyVersion: policy.version, rationale: "Criar a identidade após retry concorrente", version: "1" } };
      const results = await Promise.all([service.recordDecision(command), service.recordDecision({ ...command, requestId: "10000000-0000-4000-8000-000000000018" })]);
      expect(results[0].id).toBe(results[1].id);
      expect(results[0].decisionCount).toBe(1);
      await expect(service.recordDecision({ ...command, requestId: "10000000-0000-4000-8000-000000000019", decision: { ...command.decision, outcome: "reject", rationale: "Rejeitar em vez de criar" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT", leafReconciliationId: results[0].id });
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("fallback replay A após B retorna delta requested-parent→leaf e exige reopen canônico, inclusive applied", async () => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const rows = [row("fallback-a", "1"), row("fallback-b", "2")].map((item) => ({ ...item, matchingAttributes: { stable_key: "fallback-target" } }));
      const p = preview(rows);
      const target = record("90000000-0000-4000-8000-000000000101", "0", { matchingAttributes: { stable_key: "fallback-target" } });
      const redirect = record("90000000-0000-4000-8000-000000000102", "3", { matchingAttributes: { stable_key: "fallback-redirect" } });
      const repository = new InMemorySourceReconciliationRepository([target, redirect], TEST_CURSOR_KEY);
      const service = new SourceReconciliationService(repository);
      const root = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "fallback-root", idempotencyKey: "fallback-root", confirmation: confirmation(p), preview: p, policy });
      const [lineA,lineB] = root.reconciliation.lines;
      const intentA = { observationId: lineA.observation.id, locator: lineA.observation.locator, outcome: "reject" as const, policyVersion: policy.version, rationale: "Rejeitar A no fallback.", version: "1" };
      const l1 = await service.recordDecision({ actor: "Rodrigo", requestId: "fallback-a", reconciliationId: root.reconciliation.id, decision: intentA });
      const intentB = { observationId: lineB.observation.id, locator: lineB.observation.locator, outcome: "link" as const, stableRecordId: redirect.id, policyVersion: policy.version, rationale: "Redirecionar B no fallback.", version: "1" };
      const l2 = await service.recordDecision({ actor: "Rodrigo", requestId: "fallback-b", reconciliationId: l1.id, decision: intentB });
      await service.applyReconciliation({ actor: "Rodrigo", requestId: "fallback-apply", reconciliationId: l2.id, idempotencyKey: "fallback-apply" });
      const replay = await service.recordDecision({ actor: "Rodrigo", requestId: "fallback-replay", reconciliationId: root.reconciliation.id, decision: intentA });
      expect(replay).toMatchObject({ reused: true, reconciliationId: l2.id, status: "applied", canonicalReopenRequired: true });
      expect(replay.changedLines).toEqual([]);
      expect(replay.absenceChanges).toEqual([]);
      const reopened = await service.reopenReconciliation({ actor: "Rodrigo", requestId: "fallback-reopen", reconciliationId: replay.reconciliationId });
      expect(reopened).toMatchObject({ id: l2.id, status: "applied" });
      expect(reopened.decisions).toHaveLength(2);
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("reabre a leaf e recusa uma decisão baseada em projeção vencida", async () => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
      const service = new SourceReconciliationService(repository);
      const p = preview([row("leaf", "1")]);
      const initial = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "rf89-initial", idempotencyKey: "reconcile-leaf", confirmation: confirmation(p), preview: p, policy });
      const decided = await service.recordDecision({ actor: "Rodrigo", requestId: "rf89-decision", reconciliationId: initial.reconciliation.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "leaf", outcome: "create", policyVersion: policy.version, rationale: "Criar uma identidade para a revisão atual.", version: "1" } });
      expect(await service.reopenReconciliation({ actor: "Rodrigo", requestId: "rf89-reopen", reconciliationId: initial.reconciliation.id })).toMatchObject({ id: decided.id, parentReconciliationId: initial.reconciliation.id });

      const fresh = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "rf89-fresh", idempotencyKey: "reconcile-fresh", confirmation: confirmation(p), preview: p, policy: { ...policy, version: "stable-attributes-fresh-v1" } });
      const freshDecided = await service.recordDecision({ actor: "Rodrigo", requestId: "rf89-fresh-decision", reconciliationId: fresh.reconciliation.id, decision: { observationId: fresh.reconciliation.lines[0].observation.id, locator: "leaf", outcome: "create", policyVersion: "stable-attributes-fresh-v1", rationale: "Criar a identidade que atualiza a projeção.", version: "1" } });
      await service.applyReconciliation({ actor: "Rodrigo", requestId: "rf89-fresh-apply", reconciliationId: freshDecided.id, idempotencyKey: "apply-fresh" });
      await expect(service.recordDecision({ actor: "Rodrigo", requestId: "rf89-stale", reconciliationId: initial.reconciliation.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "leaf", outcome: "reject", policyVersion: policy.version, rationale: "Recusar depois que a projeção mudou.", version: "1" } })).rejects.toMatchObject({ code: "PROJECTION_VERSION_CONFLICT" });
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("aloca tentativas de recovery monotônicas fora do processo", async () => {
    const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
    await expect(repository.nextRecoveryAttempt(sourceIds.confirmationId, "0")).resolves.toBe("1");
    await expect(repository.nextRecoveryAttempt(sourceIds.confirmationId, "1")).resolves.toBe("2");
    await expect(repository.nextRecoveryAttempt(sourceIds.confirmationId, "1")).resolves.toBe("3");
  });

  it("não consome tentativa quando a recuperação atômica falha", async () => {
    const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY);
    const candidate = preview([row("recovery-atomic", "1")]);
    const save = vi.spyOn(repository, "saveReconciliation");
    save.mockRejectedValueOnce(new Error("falha antes do commit"));
    const input = { actor: "Rodrigo" as const, requestId: "10000000-0000-4000-8000-000000000098", confirmation: confirmation(candidate), preview: candidate, policy };
    await expect(repository.recoverConfirmedPreviewAtomically(input)).rejects.toThrow("falha antes do commit");
    const recovered = await repository.recoverConfirmedPreviewAtomically({ ...input, requestId: "10000000-0000-4000-8000-000000000099" });
    expect(recovered.reconciliation).toBeDefined();
    expect(save.mock.calls[1]?.[0].idempotencyKey).toMatch(/-0-1$/);
  });

  it.each(["before-observation", "after-event", "after-projection", "after-audit"] as const)("reverte a aplicação quando falha em %s", async (stage) => {
    const previous = { upload: process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD, isolated: process.env.TRIA_INTEGRATION_ISOLATED, namespace: process.env.TRIA_INTEGRATION_NAMESPACE };
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only"; process.env.TRIA_INTEGRATION_ISOLATED = "confirmed"; process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-reconciliation";
    try {
      const p = preview([row("novo", "1")]); const repository = new InMemorySourceReconciliationRepository([], TEST_CURSOR_KEY); const service = new SourceReconciliationService(repository);
      const initial = await service.reconcileConfirmedPreview({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000013", idempotencyKey: `reconcile-${stage}`, confirmation: confirmation(p), preview: p, policy });
      const decided = await service.recordDecision({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000014", reconciliationId: initial.reconciliation.id, decision: { observationId: initial.reconciliation.lines[0].observation.id, locator: "novo", outcome: "create", policyVersion: policy.version, rationale: "Criar o novo registro", version: "1" } });
      repository.failureStage = stage;
      await expect(service.applyReconciliation({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000015", reconciliationId: decided.id, idempotencyKey: `apply-${stage}` })).rejects.toThrow();
      expect(repository.eventCount).toBe(0); expect(repository.projectionCount).toBe(0); expect(repository.stableRecordCount).toBe(0);
      const recovered = await service.applyReconciliation({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000016", reconciliationId: decided.id, idempotencyKey: `apply-${stage}` });
      expect(recovered).toMatchObject({ reused: false, eventCount: 1, projectionVersion: "1" });
      const snapshot = await repository.findSnapshotByReconciliation(decided.id);
      expect(snapshot?.projectionVersion).toBe("1");
      expect(snapshot?.projection.every((item) => item.version === "1")).toBe(true);
      expect(repository.allEvents.some((event) => event.version !== "1")).toBe(true);
      const replay = await service.applyReconciliation({ actor: "Rodrigo", requestId: "10000000-0000-4000-8000-000000000017", reconciliationId: decided.id, idempotencyKey: `apply-${stage}` });
      expect(replay.reused).toBe(true); expect(repository.eventCount).toBe(1); expect(repository.projectionCount).toBe(1);
    } finally {
      for (const [key, value] of Object.entries({ TRIA_CONSOLIDATED_SOURCE_UPLOAD: previous.upload, TRIA_INTEGRATION_ISOLATED: previous.isolated, TRIA_INTEGRATION_NAMESPACE: previous.namespace })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
