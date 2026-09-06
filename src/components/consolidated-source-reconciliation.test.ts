import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportConflict, Preview, PreviewConfirmation, PublicReconciliation, PublicReconciliationApplyResult, ReconciliationLine, AbsenceCoverage, StableRecordContext } from "@/modules/source-ledger/public";
import { ConsolidatedSourceReconciliation, allowedDecisionOutcomes, applyReconciliationUiState, exactPageCount, keepCurrentTarget, paginateAbsences, paginateReconciliationLines } from "./consolidated-source-reconciliation";
import { paginatePreviewRows } from "./consolidated-source-preparation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  reopen: vi.fn(),
  reopenByPreview: vi.fn(),
  decide: vi.fn(),
  apply: vi.fn(),
  reconcile: vi.fn(),
  listAbsences: vi.fn(),
  searchStable: vi.fn(),
  recover: vi.fn(),
  inspect: vi.fn(),
  prepare: vi.fn(),
  confirmPreview: vi.fn(),
  reopenPreview: vi.fn(),
}));

vi.mock("@/app/fontes/base-consolidada/actions", () => ({
  reopenConsolidatedReconciliationAction: actions.reopen,
  reopenConsolidatedReconciliationByPreviewAction: actions.reopenByPreview,
  decideConsolidatedReconciliationAction: actions.decide,
  applyConsolidatedReconciliationAction: actions.apply,
  reconcileConsolidatedPreviewAction: actions.reconcile,
  listConsolidatedAbsencesAction: actions.listAbsences,
  searchConsolidatedStableRecordsAction: actions.searchStable,
  recoverConsolidatedPreviewAction: actions.recover,
  inspectConsolidatedSourceAction: actions.inspect,
  prepareConsolidatedSourceAction: actions.prepare,
  confirmConsolidatedPreviewAction: actions.confirmPreview,
  reopenConsolidatedPreviewAction: actions.reopenPreview,
}));

const observationId = "10000000-0000-4000-8000-000000000001";
const stableRecordId = "20000000-0000-4000-8000-000000000001";
type UiReconciliationFixture = PublicReconciliation & { absences: AbsenceCoverage[]; availableStableRecordIds: string[]; availableStableRecords: StableRecordContext[] };

const protectedConflict: ImportConflict = { id: "40000000-0000-4000-8000-000000000001", observationId, code: "PROTECTED_LAYER", candidateIds: [stableRecordId], currentLayer: "decision", message: "A camada protegida diverge." };

function reconciliation(overrides: Partial<UiReconciliationFixture> = {}) {
  const line: ReconciliationLine = {
    observation: { id: observationId, batchId: "70000000-0000-4000-8000-000000000001", previewId: "80000000-0000-4000-8000-000000000001", sourceFileId: "90000000-0000-4000-8000-000000000001", locator: "row:2", sourceRowHash: "f".repeat(64), functionalHash: "1".repeat(64), sourceValues: { valor: "10.00" }, decimalSources: {}, normalizedPayload: { valor: "10.00" }, observedAt: "2026-01-01T00:00:00.000Z", matchingAttributes: { stable_key: "A-1" } },
    category: "conflict",
    stableRecordId,
    match: { id: "30000000-0000-4000-8000-000000000001", observationId, policyVersion: "stable-v1", candidateIds: [stableRecordId], outcome: "unique", matchedRecordId: stableRecordId, reason: "atributo explícito" },
    conflict: protectedConflict,
    fieldDiffs: [{ field: "valor", original: "30.00", proposed: "10.00", layer: "decision" as const, cause: "camada protegida" }],
    consequence: "A observação aguarda decisão.",
  };
  return {
    id: "50000000-0000-4000-8000-000000000001", confirmationId: "60000000-0000-4000-8000-000000000001", batchId: "70000000-0000-4000-8000-000000000001", previewId: "80000000-0000-4000-8000-000000000001", sourceFileId: "90000000-0000-4000-8000-000000000001", sourceSha256: "a".repeat(64), contractHash: "b".repeat(64), transformationHash: "c".repeat(64), previewHash: "d".repeat(64), policy: { version: "stable-v1", fields: ["stable_key"], evidence: "explicit-stable-attributes" }, baseProjectionVersion: "0", status: "needs-decision", lines: [line], absences: [], conflicts: [protectedConflict], decisions: [], availableStableRecordIds: [stableRecordId], availableStableRecords: [{ id: stableRecordId, matchingAttributes: { stable_key: "A-1" }, effectiveLayer: "decision", effectivePayload: { stable_key: "A-1", valor: "30.00" } }], summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, conflict: 1, total: 1, absent: 0, pendingDecisions: 1 }, fingerprint: "e".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", ...overrides,
  } satisfies UiReconciliationFixture;
}

function paginatedReconciliation(count: number) {
  const base = reconciliation();
  const lines = Array.from({ length: count }, (_, index) => {
    const observation = { ...base.lines[0].observation, id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, locator: `row:${index + 2}` };
    return { ...base.lines[0], observation, category: "inserted" as const, conflict: undefined, fieldDiffs: [], consequence: `Linha ${index + 1} disponível.` };
  });
  return reconciliation({ lines, conflicts: [], status: "ready-to-apply", summary: { inserted: count, updated: 0, unchanged: 0, rejected: 0, conflict: 0, total: count, absent: 0, pendingDecisions: 0 } });
}

function confirmedInput(source: PublicReconciliation) {
  const preview: Preview = { previewId: source.previewId, batchId: source.batchId, sourceFileId: source.sourceFileId, fileVersionId: "a0000000-0000-4000-8000-000000000001", sourceSha256: source.sourceSha256, sourceFormat: "CSV", contentHash: "1".repeat(64), rowResultHash: "2".repeat(64), retainUntil: "2027-01-01T00:00:00.000Z", registry: { schemaId: "schema-v1", parserProfileId: "parser-v1", transformationId: "transformation-v1", limitsProfileId: "limits-v1" }, schemaVersion: "schema-v1", parserVersion: "parser-v1", transformationVersion: "transformation-v1", contractHash: source.contractHash, transformationHash: source.transformationHash, previewHash: source.previewHash, preparedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "Validado", contract: {} as Preview["contract"], summary: { found: source.summary.total, valid: source.summary.total, withError: 0, rejected: 0, inserted: "não avaliadas nesta etapa", updated: "não avaliadas nesta etapa", unchanged: "não avaliadas nesta etapa", conflicts: [], rowResultHash: "2".repeat(64) }, rows: [], headers: [] };
  const confirmation: PreviewConfirmation = { sourceFormat: "CSV", contentHash: preview.contentHash, rowResultHash: preview.rowResultHash, confirmationId: source.confirmationId, previewId: source.previewId, batchId: source.batchId, sourceFileId: source.sourceFileId, fileVersionId: preview.fileVersionId, sourceSha256: source.sourceSha256, contractHash: source.contractHash, transformationHash: source.transformationHash, previewHash: source.previewHash, confirmedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "confirmed", reused: false };
  return { preview, confirmation };
}

type EventListener = (event: TestEvent) => void;

class TestEvent {
  target: TestElement | null = null;
  currentTarget: TestNode | null = null;
  defaultPrevented = false;
  constructor(readonly type: string, readonly options: { bubbles?: boolean } = {}) {}
  preventDefault() { this.defaultPrevented = true; }
}

class TestNode {
  readonly childNodes: TestNode[] = [];
  parentNode: TestNode | null = null;
  readonly listeners = new Map<string, EventListener[]>();
  nodeValue: string | null = null;
  constructor(readonly ownerDocument: TestDocument, readonly nodeType: number, readonly nodeName: string) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling(): TestNode | null {
    const index = this.parentNode?.childNodes.indexOf(this) ?? -1;
    return index >= 0 ? this.parentNode?.childNodes[index + 1] ?? null : null;
  }
  get textContent() { return this.nodeType === 3 ? this.nodeValue ?? "" : this.childNodes.map((child) => child.textContent ?? "").join(""); }
  set textContent(value: string | null) {
    this.childNodes.splice(0, this.childNodes.length);
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  appendChild<T extends TestNode>(child: T) { child.parentNode?.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore<T extends TestNode>(child: T, before: TestNode | null) { child.parentNode?.removeChild(child); child.parentNode = this; const index = before ? this.childNodes.indexOf(before) : -1; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child; }
  removeChild<T extends TestNode>(child: T) { const index = this.childNodes.indexOf(child); if (index >= 0) this.childNodes.splice(index, 1); child.parentNode = null; return child; }
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type: string, listener: EventListener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener)); }
  dispatchEvent(event: TestEvent) {
    if (!event.target) event.target = this.nodeType === 1 ? this as unknown as TestElement : null;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    if (event.options.bubbles !== false && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}

class TestText extends TestNode {
  constructor(document: TestDocument, value: string) { super(document, 3, "#text"); this.nodeValue = value; }
}

class TestElement extends TestNode {
  readonly attributes = new Map<string, string>();
  readonly style = { setProperty: () => undefined, removeProperty: () => undefined };
  private currentValue = "";
  get value() { return this.currentValue; }
  set value(value: string) { this.currentValue = String(value); }
  disabled = false;
  className = "";
  constructor(document: TestDocument, readonly tagName: string) { super(document, 1, tagName.toUpperCase()); }
  get options() { return this.tagName.toLowerCase() === "select" ? this.querySelectorAll("option") : undefined; }
  get type() { return this.attributes.get("type") ?? (this.tagName.toLowerCase() === "input" ? "text" : ""); }
  set type(value: string) { this.attributes.set("type", String(value)); }
  setAttribute(name: string, value: unknown) { this.attributes.set(name, String(value)); if (name === "value") this.value = String(value); if (name === "disabled") this.disabled = true; }
  setAttributeNS(_namespace: string | null, name: string, value: unknown) { this.setAttribute(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === "disabled") this.disabled = false; }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  querySelectorAll(selector: string): TestElement[] { const matches: TestElement[] = []; const visit = (node: TestNode) => { for (const child of node.childNodes) { if (child.nodeType === 1) { const element = child as TestElement; if (selector === "*" || element.tagName.toLowerCase() === selector.toLowerCase()) matches.push(element); visit(element); } } }; visit(this); return matches; }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node: TestNode | null): boolean { return node === this || this.childNodes.some((child) => child === node || (child.nodeType === 1 && (child as TestElement).contains(node))); }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatchEvent(new TestEvent("click", { bubbles: true })); }
}

class TestDocument extends TestNode {
  activeElement: TestElement | null = null;
  oninput: null = null;
  readonly documentElement: TestElement;
  readonly body: TestElement;
  readonly defaultView: { document: TestDocument; HTMLIFrameElement: typeof TestElement };
  constructor() {
    super(undefined as unknown as TestDocument, 9, "#document");
    this.documentElement = new TestElement(this, "html");
    this.body = new TestElement(this, "body");
    this.appendChild(this.documentElement).appendChild(this.body);
    this.defaultView = { document: this, HTMLIFrameElement: TestElement };
  }
  createElement(tagName: string) { return new TestElement(this, tagName); }
  createElementNS(_namespace: string, tagName: string) { return this.createElement(tagName); }
  createTextNode(value: string) { return new TestText(this, value); }
  createComment(value: string) { return new TestText(this, value); }
  getElementsByTagName(tagName: string) { return this.documentElement.querySelectorAll(tagName); }
}

function installDom() {
  const document = new TestDocument();
  const window = { document, HTMLElement: TestElement, HTMLIFrameElement: TestElement, Node: TestNode, addEventListener: () => undefined, removeEventListener: () => undefined, getComputedStyle: () => ({}) };
  Object.assign(globalThis, { document, window, HTMLElement: TestElement, HTMLIFrameElement: TestElement, Node: TestNode, SVGElement: TestElement });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } });
  return document;
}

function textOf(container: TestElement) { return container.textContent ?? ""; }

function changeInput(input: TestElement | undefined, value: string) {
  if (!input) throw new Error("O input controlado não foi renderizado.");
  const nativeSetter = Object.getOwnPropertyDescriptor(TestElement.prototype, "value")?.set;
  if (!nativeSetter) throw new Error("O setter nativo do input sintético não está disponível.");
  nativeSetter.call(input, value);
  input.dispatchEvent(new TestEvent("input", { bubbles: true }));
}

function changeSelect(select: TestElement | undefined, value: string) {
  if (!select) throw new Error("O seletor controlado não foi renderizado.");
  const nativeSetter = Object.getOwnPropertyDescriptor(TestElement.prototype, "value")?.set;
  if (!nativeSetter) throw new Error("O setter nativo do seletor sintético não está disponível.");
  nativeSetter.call(select, value);
  select.dispatchEvent(new TestEvent("change", { bubbles: true }));
}

describe("estado da UI de reconciliação", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("mantém totais bigint exatos sem arredondar no contrato visual", () => {
    expect(exactPageCount("9007199254740993", 50)).toBe("180143985094820");
    expect(exactPageCount("0", 50)).toBe("1");
  });

  it("divide as duas listas em páginas de tamanho limitado", () => {
    const rows = Array.from({ length: 101 }, (_, index) => index);
    const lines = Array.from({ length: 101 }, (_, index) => `linha-${index}`);
    expect(paginatePreviewRows(rows, 0)).toEqual(rows.slice(0, 50));
    expect(paginatePreviewRows(rows, 2)).toEqual(rows.slice(100));
    expect(paginateReconciliationLines(lines, 0)).toEqual(lines.slice(0, 50));
    expect(paginateReconciliationLines(lines, 2)).toEqual(lines.slice(100));
    expect(paginatePreviewRows(rows, -1)).toEqual(rows.slice(0, 50));
    expect(paginateAbsences(rows, 0)).toEqual(rows.slice(0, 50));
    expect(paginateAbsences(rows, 2)).toEqual(rows.slice(100));
  });

  it("oferece keep-current somente para conflito protegido com alvo explícito", () => {
    const line = reconciliation().lines[0];
    expect(keepCurrentTarget(line)).toBe("20000000-0000-4000-8000-000000000001");
    expect(keepCurrentTarget({ ...line, conflict: { ...protectedConflict, code: "NO_CANDIDATE" } })).toBeUndefined();
    expect(keepCurrentTarget({ ...line, conflict: { ...protectedConflict, resolution: "reject" } })).toBeUndefined();
    expect(allowedDecisionOutcomes(line)).toEqual(["link", "keep-current", "reject"]);
    expect(allowedDecisionOutcomes({ ...line, conflict: { ...protectedConflict, code: "DISREGARDED_RECORD" } })).toEqual(["reject"]);
  });

  it("renderiza e executa keep-current até aplicação e reload", async () => {
    const pending = reconciliation();
    const pendingLine = pending.lines[0];
    const keepDecision = { id: "a0000000-0000-4000-8000-000000000001", observationId: pendingLine.observation.id, locator: pendingLine.observation.locator, stableRecordId: "20000000-0000-4000-8000-000000000001", outcome: "keep-current" as const, actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:00.000Z", policyVersion: "stable-v1", rationale: "Rodrigo mantém a camada vigente.", version: "1" };
    const decided = reconciliation({ id: "50000000-0000-4000-8000-000000000002", status: "ready-to-apply", lines: [{ ...pendingLine, category: "unchanged", conflict: { ...protectedConflict, resolution: "keep-current" }, decision: keepDecision }], decisions: [keepDecision], summary: { ...pending.summary, unchanged: 1, conflict: 0, pendingDecisions: 0 }});
    const applied = reconciliation({ ...decided, status: "applied" });
    actions.reopenByPreview.mockResolvedValueOnce({ ok: true, data: pending });
    actions.decide.mockResolvedValueOnce({ ok: true, data: { id: decided.id, reconciliationId: decided.id, parentReconciliationId: pending.id, revisionNo: decided.revisionNo ?? "2", fingerprint: decided.fingerprint, status: decided.status, summary: decided.summary, metrics: decided.metrics, decisionCount: 1, reused: false, decision: keepDecision, changedLines: decided.lines, absenceChanges: [] } });
    actions.apply.mockResolvedValueOnce({ ok: true, data: { reconciliation: applied, projectionVersion: "1", reused: false } as unknown as PublicReconciliationApplyResult });
    const preview: Preview = { previewId: pending.previewId, batchId: pending.batchId, sourceFileId: pending.sourceFileId, fileVersionId: "a0000000-0000-4000-8000-000000000001", sourceSha256: pending.sourceSha256, sourceFormat: "CSV", contentHash: "1".repeat(64), rowResultHash: "2".repeat(64), retainUntil: "2027-01-01T00:00:00.000Z", registry: { schemaId: "schema-v1", parserProfileId: "parser-v1", transformationId: "transformation-v1", limitsProfileId: "limits-v1" }, schemaVersion: "schema-v1", parserVersion: "parser-v1", transformationVersion: "transformation-v1", contractHash: pending.contractHash, transformationHash: pending.transformationHash, previewHash: pending.previewHash, preparedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "Validado", contract: { contractSchemaVersion: "import-contract-v1", canonicalHashVersion: "rfc8785-jcs-v1", schemaId: "schema-v1", parserProfileId: "parser-v1", transformationId: "transformation-v1", limitsProfileId: "limits-v1", sourceFormat: "CSV", csvParseOptions: { encoding: "utf-8", delimiter: ",", quote: '"', escape: "double-quote", allowMultilineQuotedField: false }, schemaVersion: "schema-v1", parserVersion: "parser-v1", transformationVersion: "transformation-v1", transformationHash: pending.transformationHash, headerMapping: [{ sourceHeaderId: "stable_key", sourceOrdinal: 0, logicalFieldId: "stable_key", mode: "explicit", coercionProfile: "identity-v1" }], ignoredColumns: ["curso", "trilha"], limits: { version: "limits-v1", maxSourceBytes: 1, maxExpandedBytes: 1, maxZipEntries: 1, maxCompressionRatio: 1, maxSheets: 1, maxRows: 1, maxColumns: 1, maxCellCharacters: 1, maxCsvRecordBytes: 1, maxXmlDepth: 1, maxXmlAttributes: 1, maxMilliseconds: 1 }, contractHash: pending.contractHash }, summary: { found: 1, valid: 1, withError: 0, rejected: 0, inserted: "não avaliadas nesta etapa", updated: "não avaliadas nesta etapa", unchanged: "não avaliadas nesta etapa", conflicts: [], rowResultHash: "2".repeat(64) }, rows: [], headers: [] };
    const confirmation: PreviewConfirmation = { sourceFormat: "CSV", contentHash: preview.contentHash, rowResultHash: preview.rowResultHash, confirmationId: pending.confirmationId, previewId: pending.previewId, batchId: pending.batchId, sourceFileId: pending.sourceFileId, fileVersionId: preview.fileVersionId, sourceSha256: pending.sourceSha256, contractHash: pending.contractHash, transformationHash: pending.transformationHash, previewHash: pending.previewHash, confirmedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "confirmed", reused: false };
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    let root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); });
    const keepButton = container.querySelectorAll("button").find((button) => button.textContent === "Manter camada vigente");
    expect(keepButton).toBeDefined();
    await act(async () => { keepButton?.click(); await Promise.resolve(); });
    expect(actions.decide).toHaveBeenCalledWith(expect.objectContaining({ outcome: "keep-current", stableRecordId: "20000000-0000-4000-8000-000000000001", observationId: pending.lines[0].observation.id, locator: "row:2" }));
    const applyButton = container.querySelectorAll("button").find((button) => button.textContent === "Confirmar e aplicar recorte aceito");
    expect(applyButton).toBeDefined();
    await act(async () => { applyButton?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.apply).toHaveBeenCalledWith({ reconciliationId: decided.id, idempotencyKey: `apply-${decided.id}` });
    expect(textOf(container)).toContain("versão da projeção 1");
    await act(async () => { root.unmount(); });
    actions.reopenByPreview.mockResolvedValueOnce({ ok: true, data: applied });
    const reloadedContainer = installDom().createElement("div");
    root = createRoot(reloadedContainer as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); });
    expect(textOf(reloadedContainer)).toContain("Reconciliação reaberta após o reload.");
    expect(textOf(reloadedContainer)).toContain("aplicada");
    await act(async () => { root.unmount(); });
  });

  it("limpa a reconciliação ao recuperar conflito de versão e usa a versão retornada", () => {
    const versionConflict = applyReconciliationUiState({ ok: false, error: { code: "PROJECTION_VERSION_CONFLICT", message: "mensagem interna" } });
    expect(versionConflict).toEqual({ kind: "reload-required", projectionVersion: null, message: "A projeção mudou. Reabra a comparação para recuperar a versão atual." });
    const applied = applyReconciliationUiState({ ok: true, data: { projectionVersion: "7", reused: false } as unknown as PublicReconciliationApplyResult });
    expect(applied).toEqual({ kind: "applied", projectionVersion: "7", message: "Aplicação concluída. A projeção efetiva foi atualizada." });
  });

  it("reabre a leaf informada por conflito de decisão sem recarregar a prévia", async () => {
    actions.reopen.mockReset();
    actions.reopenByPreview.mockReset();
    actions.decide.mockReset();
    const pending = reconciliation();
    const winner = reconciliation({ id: "50000000-0000-4000-000000000002", parentReconciliationId: pending.id });
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: pending });
    actions.decide.mockResolvedValueOnce({ ok: false, error: { code: "REVISION_CONFLICT", message: "Uma revisão mais recente venceu.", requestId: "rf89-ui", kind: "structural", leafReconciliationId: winner.id } });
    actions.reopen.mockResolvedValueOnce({ ok: true, data: winner });
    const preview: Preview = { previewId: pending.previewId, batchId: pending.batchId, sourceFileId: pending.sourceFileId, fileVersionId: "a0000000-0000-4000-000000000001", sourceSha256: pending.sourceSha256, sourceFormat: "CSV", contentHash: "1".repeat(64), rowResultHash: "2".repeat(64), retainUntil: "2027-01-01T00:00:00.000Z", registry: { schemaId: "schema-v1", parserProfileId: "parser-v1", transformationId: "transformation-v1", limitsProfileId: "limits-v1" }, schemaVersion: "schema-v1", parserVersion: "parser-v1", transformationVersion: "transformation-v1", contractHash: pending.contractHash, transformationHash: pending.transformationHash, previewHash: pending.previewHash, preparedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "Validado", contract: {} as Preview["contract"], summary: { found: 1, valid: 1, withError: 0, rejected: 0, inserted: "não avaliadas nesta etapa", updated: "não avaliadas nesta etapa", unchanged: "não avaliadas nesta etapa", conflicts: [], rowResultHash: "2".repeat(64) }, rows: [], headers: [] };
    const confirmation: PreviewConfirmation = { sourceFormat: "CSV", contentHash: preview.contentHash, rowResultHash: preview.rowResultHash, confirmationId: pending.confirmationId, previewId: pending.previewId, batchId: pending.batchId, sourceFileId: pending.sourceFileId, fileVersionId: preview.fileVersionId, sourceSha256: pending.sourceSha256, contractHash: pending.contractHash, transformationHash: pending.transformationHash, previewHash: pending.previewHash, confirmedAt: "2026-01-01T00:00:00.000Z", actor: "Rodrigo", status: "confirmed", reused: false };
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await Promise.resolve(); });
    const rejectButton = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    expect(rejectButton).toBeDefined();
    await act(async () => { rejectButton?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.reopen).toHaveBeenCalledWith({ reconciliationId: winner.id });
    expect(actions.reopenByPreview).toHaveBeenCalledTimes(1);
    expect(textOf(container)).toContain("a revisão atual foi reaberta");
    expect(container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha")?.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it("reabre a leaf exata quando o recibo exige reabertura canônica", async () => {
    actions.reopen.mockReset(); actions.reopenByPreview.mockReset(); actions.decide.mockReset();
    const pending = reconciliation();
    const winner = reconciliation({ id: "50000000-0000-4000-8000-000000000011", parentReconciliationId: pending.id });
    const { preview, confirmation } = confirmedInput(pending);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: pending });
    actions.decide.mockResolvedValue({ ok: true, data: { id: winner.id, reconciliationId: winner.id,
      parentReconciliationId: winner.parentReconciliationId, revisionNo: "3", fingerprint: winner.fingerprint,
      status: winner.status, summary: winner.summary, decisionCount: 1, reused: false, canonicalReopenRequired: true,
      decision: { id: "a0000000-0000-4000-8000-000000000011", observationId, locator: "row:2", outcome: "reject", actor: "Rodrigo", decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: "stable-v1", rationale: "Rodrigo decidiu não incluir esta observação.", version: "1" },
      changedLines: [], absenceChanges: [] } });
    actions.reopen.mockResolvedValue({ ok: true, data: winner });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await Promise.resolve(); });
    const reject = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    await act(async () => { reject?.click(); await Promise.resolve(); });
    expect(actions.reopen).toHaveBeenCalledWith({ reconciliationId: winner.id });
    expect(container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha")?.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it("limpa busy após recuperar conflito de projeção durante a decisão", async () => {
    actions.reopenByPreview.mockReset(); actions.decide.mockReset(); actions.recover.mockReset();
    const pending = reconciliation();
    const recovered = reconciliation({ id: "50000000-0000-4000-8000-000000000012" });
    const { preview, confirmation } = confirmedInput(pending);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: pending });
    actions.decide.mockResolvedValue({ ok: false, error: { code: "PROJECTION_VERSION_CONFLICT", message: "Versão mudou.", requestId: "projection-ui", kind: "structural" } });
    actions.recover.mockResolvedValue({ ok: true, data: { reconciliation: recovered, reused: false } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await Promise.resolve(); });
    const reject = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    await act(async () => { reject?.click(); await Promise.resolve(); });
    expect(textOf(container)).toContain("recuperada sobre a versão vigente");
    expect(container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha")?.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it("ignora recibo atrasado quando outra geração já instalou uma leaf mais nova", async () => {
    actions.reopenByPreview.mockReset(); actions.decide.mockReset(); actions.apply.mockReset();
    const pending = reconciliation();
    const { preview, confirmation } = confirmedInput(pending);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: pending });
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    actions.decide.mockImplementationOnce(() => first).mockImplementationOnce(() => second);
    const decisionFor = (id: string) => ({ id, observationId, locator: "row:2", outcome: "reject" as const, actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: "stable-v1", rationale: "Rodrigo rejeitou a observação.", version: "1" });
    const receiptFor = (id: string, consequence: string) => {
      const decision = decisionFor(`a0000000-0000-4000-8000-${id.at(-1)?.padStart(12, "0")}`);
      const changed = { ...pending.lines[0], category: "rejected" as const, consequence, decision, conflict: { ...protectedConflict, resolution: "reject" as const } };
      return { ok: true as const, data: { id, reconciliationId: id, parentReconciliationId: pending.id, revisionNo: "2", fingerprint: pending.fingerprint,
        status: "ready-to-apply" as const, summary: { ...pending.summary, rejected: 1, conflict: 0, pendingDecisions: 0 }, decisionCount: 1,
        reused: false, decision, changedLines: [changed], absenceChanges: [] } };
    };
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await Promise.resolve(); });
    const reject = container.querySelectorAll("button").find((item) => item.textContent === "Rejeitar linha");
    if (!reject) throw new Error("Botão de rejeição ausente.");
    await act(async () => { reject.click(); reject.click(); await Promise.resolve(); });
    const newerId = "50000000-0000-4000-8000-000000000003";
    const olderId = "50000000-0000-4000-8000-000000000002";
    await act(async () => { resolveSecond(receiptFor(newerId, "RECIBO NOVO")); await Promise.resolve(); });
    await act(async () => { resolveFirst(receiptFor(olderId, "RECIBO ANTIGO")); await Promise.resolve(); });
    expect(textOf(container)).toContain("RECIBO NOVO");
    expect(textOf(container)).not.toContain("RECIBO ANTIGO");
    actions.apply.mockResolvedValue({ ok: true, data: { reconciliation: reconciliation({ id: newerId, status: "applied" }), projectionVersion: "1", reused: false, eventCount: 1 } });
    const applyButton = container.querySelectorAll("button").find((item) => item.textContent === "Confirmar e aplicar recorte aceito");
    expect(applyButton?.disabled).toBe(false);
    await act(async () => { applyButton?.click(); await Promise.resolve(); });
    expect(actions.apply).toHaveBeenCalledWith({ reconciliationId: newerId, idempotencyKey: `apply-${newerId}` });
    await act(async () => { root.unmount(); });
  });

  it("renderiza somente a página corrente e navega entre páginas sem perder a contagem global", async () => {
    actions.reopen.mockReset();
    actions.reopenByPreview.mockReset();
    actions.decide.mockReset();
    actions.apply.mockReset();
    const source = paginatedReconciliation(55);
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(container.querySelectorAll("article")).toHaveLength(50);
    expect(textOf(container)).toContain("Todas: 55");
    expect(textOf(container)).toContain("Página 1 de 2");
    const previous = container.querySelectorAll("button").find((button) => button.textContent === "Página anterior");
    const next = container.querySelectorAll("button").find((button) => button.textContent === "Próxima página");
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);

    await act(async () => { next?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelectorAll("article")).toHaveLength(5);
    expect(textOf(container)).toContain("Página 2 de 2");
    expect(container.querySelectorAll("article").some((article) => textOf(article).includes("row:52 — Inseridas"))).toBe(true);
    expect(container.querySelectorAll("article").some((article) => textOf(article).includes("row:2 — Inseridas"))).toBe(false);
    expect(textOf(container)).toContain("Todas: 55");

    await act(async () => { previous?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelectorAll("article")).toHaveLength(50);
    expect(textOf(container)).toContain("Página 1 de 2");
    expect(container.querySelectorAll("article").some((article) => textOf(article).includes("row:2 — Inseridas"))).toBe(true);
    expect(previous?.disabled).toBe(true);
    await act(async () => { root.unmount(); });
  });

  it("mantém o DOM limitado a 50 linhas quando a leaf contém 10.000 linhas", async () => {
    actions.reopenByPreview.mockReset();
    actions.listAbsences.mockReset();
    const source = paginatedReconciliation(10_000);
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: 0, absences: [] } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelectorAll("article")).toHaveLength(50);
    expect(textOf(container)).toContain("Todas: 10000");
    expect(textOf(container)).toContain("Página 1 de 200");
    await act(async () => { root.unmount(); });
  });

  it("busca ausências por página na Server Action e mantém a identidade da página 2", async () => {
    actions.reopen.mockReset();
    actions.reopenByPreview.mockReset();
    actions.listAbsences.mockReset();
    const source = reconciliation({ lines: [], conflicts: [], status: "ready-to-apply", absences: [], summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, conflict: 0, total: 0, absent: 55, pendingDecisions: 0 } });
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockImplementation(async ({ page }: { page: number; cursor?: string }) => ({ ok: true, data: { page, pageSize: 50, total: 55, ...(page === 0 ? { nextCursor: "cursor-page-1" } : {}), absences: [{ stableRecordId: `absence-page-${page}`, status: "not_observed_this_batch", label: "Não observado neste lote" }] } }));
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(textOf(container)).toContain("absence-page-0");
    expect(textOf(container)).toContain("Ausências: página 1 de 2 — 55 registro(s)");
    const absenceNav = container.querySelectorAll("nav").find((nav) => nav.getAttribute("aria-label") === "Paginação das ausências");
    const next = absenceNav?.querySelectorAll("button").find((button) => button.textContent === "Próxima página");
    expect(next).toBeDefined();
    await act(async () => { next?.focus(); next?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(textOf(container)).toContain("absence-page-1");
    expect(textOf(container)).toContain("Ausências: página 2 de 2 — 55 registro(s)");
    expect(actions.listAbsences).toHaveBeenLastCalledWith({ reconciliationId: source.id, page: 1, pageSize: 50, cursor: "cursor-page-1" });
    await act(async () => { root.unmount(); });
  });

  it("digitar ou focar não busca; Buscar dispara uma única pesquisa explícita", async () => {
    const source = reconciliation();
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    actions.searchStable.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", records: [] } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const input = container.querySelectorAll("input").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Buscar registro estável"));
    await act(async () => { input?.focus(); changeInput(input, "MiXeD"); await Promise.resolve(); });
    expect(actions.searchStable).not.toHaveBeenCalled();
    const button = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalledTimes(1);
    expect(actions.searchStable).toHaveBeenCalledWith({ reconciliationId: source.id, query: "MiXeD", page: 0, pageSize: 50 });
    await act(async () => { root.unmount(); });
  });

  it("busca explicitamente, pagina por cursor, seleciona ID opaco e envia o vínculo auditado até o reopen", async () => {
    const source = reconciliation();
    const { preview, confirmation } = confirmedInput(source);
    const targetId = "53000000-0000-4000-8000-000000000060";
    const pageOne = Array.from({ length: 50 }, (_, index) => ({
      id: `61000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      matchingAttributes: { stable_key: `page-one-${index + 1}` }, effectiveLayer: "source" as const, effectivePayload: { codigo: `P-${index + 1}` },
    }));
    const pageTwo = [
      { id: "53000000-0000-4000-8000-000000000059", matchingAttributes: { rf81_fixture: "absent" }, effectiveLayer: "source" as const, effectivePayload: { valor: "1.00" } },
      { id: targetId, matchingAttributes: { rf81_fixture: "absent" }, effectiveLayer: "source" as const, effectivePayload: { valor: "1.00" } },
    ];
    const decision = { id: "a0000000-0000-4000-8000-000000000060", observationId, locator: "row:2", outcome: "link" as const,
      stableRecordId: targetId, actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: source.policy.version,
      rationale: "Rodrigo confirmou o vínculo exibido.", version: "1" };
    const changedLine = { ...source.lines[0], category: "updated" as const, conflict: undefined, decision, consequence: "Vínculo auditado." };
    const decidedSource = reconciliation({ ...source, id: "50000000-0000-4000-8000-000000000060", parentReconciliationId: source.id,
      revisionNo: "2", status: "ready-to-apply", lines: [changedLine], conflicts: [], decisions: [decision],
      summary: { ...source.summary, updated: 1, conflict: 0, pendingDecisions: 0 } });
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    actions.searchStable
      .mockResolvedValueOnce({ ok: true, data: { page: 0, pageSize: 50, total: "52", nextCursor: "stable-page-2", records: pageOne } })
      .mockResolvedValueOnce({ ok: true, data: { page: 1, pageSize: 50, total: "52", records: pageTwo } });
    actions.decide.mockResolvedValue({ ok: true, data: { id: decidedSource.id, reconciliationId: decidedSource.id, parentReconciliationId: source.id,
      revisionNo: "2", fingerprint: source.fingerprint, status: "ready-to-apply", summary: decidedSource.summary, decisionCount: 1,
      reused: false, decision, changedLines: [changedLine], absenceChanges: [] } });

    let testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    let container = testDocument.createElement("div");
    let root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const input = container.querySelectorAll("input").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Buscar registro estável"));
    await act(async () => { input?.focus(); changeInput(input, "absent"); await Promise.resolve(); });
    expect(actions.searchStable).not.toHaveBeenCalled();
    const search = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { search?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.searchStable).toHaveBeenCalledTimes(1);
    expect(actions.searchStable).toHaveBeenLastCalledWith({ reconciliationId: source.id, query: "absent", page: 0, pageSize: 50 });
    expect(textOf(container)).toContain("Página 1 de 2 — 52 registro(s)");
    const targetPagination = container.querySelectorAll("div").find((candidate) => candidate.getAttribute("aria-label") === "Paginação de registros estáveis");
    const next = targetPagination?.querySelectorAll("button").find((candidate) => candidate.textContent === "Próxima");
    await act(async () => { next?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.searchStable).toHaveBeenCalledTimes(2);
    expect(actions.searchStable).toHaveBeenLastCalledWith({ reconciliationId: source.id, query: "absent", page: 1, pageSize: 50, cursor: "stable-page-2" });
    expect(textOf(container)).toContain("Página 2 de 2 — 52 registro(s)");
    const select = container.querySelectorAll("select").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Registro estável para"));
    await act(async () => { changeSelect(select, targetId); await Promise.resolve(); });
    expect(textOf(container)).toContain(`Camada vigente: source`);
    const link = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Vincular registro selecionado");
    await act(async () => { link?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.decide).toHaveBeenCalledWith({ reconciliationId: source.id, observationId, locator: "row:2", stableRecordId: targetId,
      outcome: "link", policyVersion: source.policy.version, rationale: "Rodrigo confirmou o vínculo exibido.", version: "1" });
    const audit = container.querySelectorAll("p").find((candidate) => candidate.getAttribute("aria-label") === "Decisão auditada para row:2");
    expect(audit?.textContent).toContain(targetId);
    await act(async () => { root.unmount(); });

    actions.reopenByPreview.mockResolvedValue({ ok: true, data: decidedSource });
    testDocument = installDom();
    container = testDocument.createElement("div");
    root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const reopenedAudit = container.querySelectorAll("p").find((candidate) => candidate.getAttribute("aria-label") === "Decisão auditada para row:2");
    expect(reopenedAudit?.textContent).toContain(targetId);
    await act(async () => { root.unmount(); });
  });

  it("mantém no máximo uma busca em voo por observação e suprime o resultado invalidado pela edição", async () => {
    const source = reconciliation();
    const { preview, confirmation } = confirmedInput(source);
    let resolveOld!: (value: unknown) => void;
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    actions.searchStable.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: { page: 0, pageSize: 50, total: "1", records: [{ id: "new-result", matchingAttributes: {}, effectiveLayer: "source", effectivePayload: { codigo: "nova" } }] } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const input = container.querySelectorAll("input").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Buscar registro estável"));
    await act(async () => { changeInput(input, "antiga"); });
    let button = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { button?.click(); button?.click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalledTimes(1);
    await act(async () => { changeInput(input, "nova"); resolveOld({ ok: true, data: { page: 0, pageSize: 50, total: "1", records: [{ id: "old-result", matchingAttributes: {}, effectiveLayer: "source", effectivePayload: { codigo: "antiga" } }] } }); await Promise.resolve(); });
    expect(textOf(container)).not.toContain("old-result");
    button = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalledTimes(2);
    expect(actions.searchStable).toHaveBeenLastCalledWith({ reconciliationId: source.id, query: "nova", page: 0, pageSize: 50 });
    expect(textOf(container)).toContain("new-result");
    await act(async () => { root.unmount(); });
  });

  it("limpa tickets na troca de leaf e não deixa a busca antiga repovoar a nova revisão", async () => {
    const source = reconciliation();
    const winner = reconciliation({ ...source, id: "50000000-0000-4000-8000-000000000077" });
    const { preview, confirmation } = confirmedInput(source);
    let resolveOld!: (value: unknown) => void;
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.reopen.mockResolvedValue({ ok: true, data: winner });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    actions.searchStable.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: { page: 0, pageSize: 50, total: "1", records: [{ id: "winner-result", matchingAttributes: {}, effectiveLayer: "source", effectivePayload: { codigo: "winner" } }] } });
    actions.decide.mockResolvedValue({ ok: true, data: { canonicalReopenRequired: true, reconciliationId: winner.id, parentReconciliationId: source.id } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    let input = container.querySelectorAll("input").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Buscar registro estável"));
    await act(async () => { changeInput(input, "old"); });
    let search = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { search?.click(); await Promise.resolve(); });
    const reject = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Rejeitar linha");
    await act(async () => { reject?.click(); await Promise.resolve(); });
    expect(actions.reopen).toHaveBeenCalledWith({ reconciliationId: winner.id });
    input = container.querySelectorAll("input").find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Buscar registro estável"));
    await act(async () => { changeInput(input, "winner"); });
    search = container.querySelectorAll("button").find((candidate) => candidate.textContent === "Buscar");
    await act(async () => { search?.click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalledTimes(2);
    expect(actions.searchStable).toHaveBeenLastCalledWith({ reconciliationId: winner.id, query: "winner", page: 0, pageSize: 50 });
    await act(async () => { resolveOld({ ok: true, data: { page: 0, pageSize: 50, total: "1", records: [{ id: "old-result", matchingAttributes: {}, effectiveLayer: "source", effectivePayload: { codigo: "old" } }] } }); await Promise.resolve(); });
    expect(textOf(container)).toContain("winner-result");
    expect(textOf(container)).not.toContain("old-result");
    await act(async () => { root.unmount(); });
  });

  it("isola buscas por observação e limpa todas as requisições no unmount", async () => {
    const base = reconciliation();
    const secondObservationId = "10000000-0000-4000-8000-000000000099";
    const secondConflict: ImportConflict = { ...protectedConflict, id: "40000000-0000-4000-8000-000000000099", observationId: secondObservationId };
    const secondLine: ReconciliationLine = { ...base.lines[0], observation: { ...base.lines[0].observation, id: secondObservationId, locator: "row:99" }, conflict: secondConflict,
      match: { ...base.lines[0].match, id: "30000000-0000-4000-8000-000000000099", observationId: secondObservationId } };
    const source = reconciliation({ lines: [base.lines[0], secondLine], conflicts: [protectedConflict, secondConflict], summary: { ...base.summary, conflict: 2, total: 2, pendingDecisions: 2 } });
    const { preview, confirmation } = confirmedInput(source);
    const resolvers: Array<(value: unknown) => void> = [];
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    actions.searchStable.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const buttons = container.querySelectorAll("button").filter((candidate) => candidate.textContent === "Buscar");
    expect(buttons).toHaveLength(2);
    await act(async () => { buttons[0].click(); buttons[0].click(); buttons[1].click(); buttons[1].click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);
    await act(async () => { root.unmount(); });
    await act(async () => { for (const resolve of resolvers) resolve({ ok: true, data: { page: 0, pageSize: 50, total: "1", records: [{ id: "late-result", matchingAttributes: {}, effectiveLayer: "source", effectivePayload: {} }] } }); await Promise.resolve(); });
    expect(textOf(container)).toBe("");
  });

  it("refresh de busca invalida decisão atrasada e conserva a leaf vencedora", async () => {
    actions.reopen.mockReset(); actions.reopenByPreview.mockReset(); actions.searchStable.mockReset(); actions.decide.mockReset(); actions.listAbsences.mockReset();
    const source = reconciliation();
    const winner = reconciliation({ ...source, id: "50000000-0000-4000-8000-000000000008" });
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.reopen.mockResolvedValue({ ok: true, data: winner });
    actions.listAbsences.mockResolvedValue({ ok: true, data: { page: 0, pageSize: 50, total: "0", absences: [] } });
    const decisionResolvers: Array<(value: unknown) => void> = [];
    actions.decide.mockImplementation(() => new Promise((resolve) => { decisionResolvers.push(resolve); }));
    actions.searchStable.mockResolvedValue({ ok: false, error: { code: "REVISION_CONFLICT", message: "Busca obsoleta.", requestId: "search-stale", kind: "structural", leafReconciliationId: winner.id } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); await Promise.resolve(); });
    const reject = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    await act(async () => { reject?.click(); await Promise.resolve(); });
    const searchButton = container.querySelectorAll("button").find((button) => button.textContent === "Buscar");
    await act(async () => { searchButton?.click(); await Promise.resolve(); });
    expect(actions.searchStable).toHaveBeenCalled();
    expect(actions.reopen).toHaveBeenCalledWith({ reconciliationId: winner.id });
    expect(textOf(container)).toContain("leaf vigente");
    const canonicalReject = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    expect(canonicalReject?.disabled).toBe(false);
    await act(async () => { canonicalReject?.click(); await Promise.resolve(); });
    expect(canonicalReject?.disabled).toBe(true);
    const staleDecision = { id: "a0000000-0000-4000-8000-000000000098", observationId, locator: "row:2", outcome: "reject" as const,
      actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: "stable-v1", rationale: "Rodrigo decidiu não incluir esta observação.", version: "1" };
    await act(async () => { decisionResolvers[0]({ ok: true, data: { id: "50000000-0000-4000-8000-000000000098", reconciliationId: "50000000-0000-4000-8000-000000000098",
      parentReconciliationId: source.id, revisionNo: "2", fingerprint: source.fingerprint, status: "ready-to-apply", summary: { ...source.summary, rejected: 1, conflict: 0, pendingDecisions: 0 },
      decisionCount: 1, reused: false, decision: staleDecision, changedLines: [{ ...source.lines[0], category: "rejected", consequence: "BUSCA OBSOLETA", decision: staleDecision }], absenceChanges: [] } }); await Promise.resolve(); });
    expect(canonicalReject?.disabled).toBe(true);
    await act(async () => { decisionResolvers[1]({ ok: false, error: { code: "DECISION_INVALID", message: "Decisão canônica recusada.", requestId: "newer-operation", kind: "structural" } }); await Promise.resolve(); });
    expect(textOf(container)).toContain("Decisão canônica recusada");
    expect(textOf(container)).not.toContain("BUSCA OBSOLETA");
    expect(container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha")?.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it("refresh de ausência invalida decisão atrasada, descarta cursores e libera controles", async () => {
    actions.reopen.mockReset();
    actions.reopenByPreview.mockReset();
    actions.listAbsences.mockReset();
    actions.decide.mockReset();
    const source = reconciliation({ absences: [], summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, conflict: 1, total: 1, absent: 55, pendingDecisions: 1 } });
    const winner = reconciliation({ ...source, id: "50000000-0000-4000-8000-000000000009", summary: { ...source.summary, absent: 1 } });
    const { preview, confirmation } = confirmedInput(source);
    actions.reopenByPreview.mockResolvedValue({ ok: true, data: source });
    actions.reopen.mockResolvedValue({ ok: true, data: winner });
    let resolveDecision!: (value: unknown) => void;
    actions.decide.mockImplementation(() => new Promise((resolve) => { resolveDecision = resolve; }));
    actions.listAbsences
      .mockResolvedValueOnce({ ok: true, data: { page: 0, pageSize: 50, total: "55", nextCursor: "stale-cursor", absences: [{ stableRecordId: "old-absence", status: "not_observed_this_batch", label: "Não observado neste lote" }] } })
      .mockResolvedValueOnce({ ok: false, error: { code: "REVISION_CONFLICT", message: "Leaf obsoleta.", requestId: "stale-ui", kind: "structural", leafReconciliationId: winner.id } })
      .mockResolvedValueOnce({ ok: true, data: { page: 0, pageSize: 50, total: "1", absences: [{ stableRecordId: "winner-absence", status: "not_observed_this_batch", label: "Não observado neste lote" }] } });
    const testDocument = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = testDocument.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(ConsolidatedSourceReconciliation, { preview, confirmation })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const reject = container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha");
    await act(async () => { reject?.click(); await Promise.resolve(); });
    const absenceNav = container.querySelectorAll("nav").find((nav) => nav.getAttribute("aria-label") === "Paginação das ausências");
    const next = absenceNav?.querySelectorAll("button").find((button) => button.textContent === "Próxima página");
    await act(async () => { next?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(actions.reopen).toHaveBeenCalledWith({ reconciliationId: winner.id });
    expect(actions.listAbsences).toHaveBeenLastCalledWith({ reconciliationId: winner.id, page: 0, pageSize: 50 });
    const staleDecision = { id: "a0000000-0000-4000-8000-000000000099", observationId, locator: "row:2", outcome: "reject" as const,
      actor: "Rodrigo" as const, decidedAt: "2026-01-01T00:00:01.000Z", policyVersion: "stable-v1", rationale: "Rodrigo decidiu não incluir esta observação.", version: "1" };
    await act(async () => { resolveDecision({ ok: true, data: { id: "50000000-0000-4000-8000-000000000099", reconciliationId: "50000000-0000-4000-8000-000000000099",
      parentReconciliationId: source.id, revisionNo: "2", fingerprint: source.fingerprint, status: "ready-to-apply", summary: { ...source.summary, rejected: 1, conflict: 0, pendingDecisions: 0 },
      decisionCount: 1, reused: false, decision: staleDecision, changedLines: [{ ...source.lines[0], category: "rejected", consequence: "RECIBO OBSOLETO", decision: staleDecision }], absenceChanges: [] } }); await Promise.resolve(); });
    expect(textOf(container)).toContain("winner-absence");
    expect(textOf(container)).not.toContain("old-absence");
    expect(textOf(container)).not.toContain("RECIBO OBSOLETO");
    expect(textOf(container)).toContain("todas as páginas foram recarregadas sobre a leaf vigente");
    expect(container.querySelectorAll("button").find((button) => button.textContent === "Rejeitar linha")?.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

});
