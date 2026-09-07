"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyConsolidatedReconciliationAction,
  decideConsolidatedReconciliationAction,
  listConsolidatedAbsencesAction,
  recoverConsolidatedPreviewAction,
  reopenConsolidatedReconciliationAction,
  reopenConsolidatedReconciliationByPreviewAction,
  reconcileConsolidatedPreviewAction,
  searchConsolidatedStableRecordsAction,
} from "@/app/fontes/base-consolidada/actions";
import type { Preview, PreviewConfirmation, PublicReconciliation, PublicReconciliationApplyResult, ReconciliationLine, ReconciliationCategory, DecisionOutcome, AbsenceCoverage, StableRecordContext } from "@/modules/source-ledger/public";

const button = "rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300";
export const RECONCILIATION_PAGE_SIZE = 50;
export const ABSENCE_PAGE_SIZE = 50;
export const STABLE_RECORD_PAGE_SIZE = 50;

type TargetSearchResult = { records: StableRecordContext[]; total: string; page: number; query: string; cursors: Array<string | undefined>; nextCursor?: string };

export function exactPageCount(total: string, pageSize: number) {
  try {
    const value = BigInt(total);
    return value <= 0n ? "1" : ((value + BigInt(pageSize) - 1n) / BigInt(pageSize)).toString();
  } catch { return "1"; }
}

function decimalTotalExceeds(total: string, limit: number) {
  try { return BigInt(total) > BigInt(limit); } catch { return false; }
}

const labels: Record<ReconciliationCategory, string> = { inserted: "Inseridas", updated: "Atualizadas", unchanged: "Inalteradas", rejected: "Rejeitadas", conflict: "Conflitos" };

export function paginateReconciliationLines<T>(lines: T[], page: number) {
  const safePage = Math.max(0, Math.floor(page));
  return lines.slice(safePage * RECONCILIATION_PAGE_SIZE, (safePage + 1) * RECONCILIATION_PAGE_SIZE);
}

export function paginateAbsences<T>(absences: T[], page: number) {
  const safePage = Math.max(0, Math.floor(page));
  return absences.slice(safePage * ABSENCE_PAGE_SIZE, (safePage + 1) * ABSENCE_PAGE_SIZE);
}

export function paginateStableRecords<T>(records: T[], page: number) {
  const safePage = Math.max(0, Math.floor(page));
  return records.slice(safePage * STABLE_RECORD_PAGE_SIZE, (safePage + 1) * STABLE_RECORD_PAGE_SIZE);
}

export function keepCurrentTarget(line: ReconciliationLine) {
  if (line.conflict?.code !== "PROTECTED_LAYER" || line.conflict.resolution) return undefined;
  return line.stableRecordId ?? line.match.matchedRecordId;
}

export function allowedDecisionOutcomes(line: ReconciliationLine): DecisionOutcome[] {
  if (!line.conflict || line.conflict.resolution) return [];
  if (line.conflict.code === "PROTECTED_LAYER") return ["link", "keep-current", "reject"];
  if (line.conflict.code === "DISREGARDED_RECORD") return ["reject"];
  return ["link", "create", "reject"];
}

export function applyReconciliationUiState(result: { ok: true; data: PublicReconciliationApplyResult } | { ok: false; error: { code: string; message: string } }) {
  if (result.ok) return { kind: "applied" as const, projectionVersion: result.data.projectionVersion, message: result.data.reused ? "Aplicação reutilizada; nenhum efeito novo foi criado." : "Aplicação concluída. A projeção efetiva foi atualizada." };
  if (result.error.code === "PROJECTION_VERSION_CONFLICT") return { kind: "reload-required" as const, projectionVersion: null, message: "A projeção mudou. Reabra a comparação para recuperar a versão atual." };
  return { kind: "error" as const, projectionVersion: null, message: `${result.error.message} (${result.error.code})` };
}

function readStoredDrilldowns(storageKey: string) {
  try {
    const saved = sessionStorage.getItem(`${storageKey}:drilldowns`);
    return saved ? JSON.parse(saved) as Record<string, boolean> : {};
  } catch { return {}; }
}
function rememberDrilldown(storageKey: string, observationId: string, open: boolean) {
  try {
    const saved = readStoredDrilldowns(storageKey);
    sessionStorage.setItem(`${storageKey}:drilldowns`, JSON.stringify({ ...saved, [observationId]: open }));
  } catch { /* storage is optional */ }
}

type LeafScope = { generation: number; leafId: string | null };
type DecisionScope = LeafScope & { decisionToken: number };
type PendingTargetRequest = { scope: LeafScope; observationId: string; valid: boolean };

function useReconciliationOperationController() {
  const lifecycleGeneration = useRef(0);
  const activeReconciliationId = useRef<string | null>(null);
  const decisionOperation = useRef(0);
  const busyOperation = useRef(0);
  return useMemo(() => ({
    beginLifecycle(leafId: string | null) {
      lifecycleGeneration.current += 1;
      decisionOperation.current += 1;
      activeReconciliationId.current = leafId;
      return lifecycleGeneration.current;
    },
    isLifecycle(generation: number) { return lifecycleGeneration.current === generation; },
    captureLeaf(leafId: string): LeafScope { return { generation: lifecycleGeneration.current, leafId }; },
    isLeaf(scope: LeafScope) {
      return lifecycleGeneration.current === scope.generation && activeReconciliationId.current === scope.leafId;
    },
    beginDecision(leafId: string): DecisionScope {
      decisionOperation.current += 1;
      return { generation: lifecycleGeneration.current, leafId, decisionToken: decisionOperation.current };
    },
    isDecision(scope: DecisionScope) {
      return lifecycleGeneration.current === scope.generation && activeReconciliationId.current === scope.leafId
        && decisionOperation.current === scope.decisionToken;
    },
    beginBusy() { busyOperation.current += 1; return busyOperation.current; },
    invalidateBusy() { busyOperation.current += 1; },
    isBusy(token: number) { return busyOperation.current === token; },
  }), []);
}

type ConflictControlsProps = {
  line: ReconciliationLine;
  reconciliationId: string;
  busy: boolean;
  query: string;
  targetPage: number;
  serverPage?: TargetSearchResult;
  explicitTarget: string;
  searchPending: boolean;
  onQueryChange: (observationId: string, query: string) => void;
  onSearch: (reconciliationId: string, observationId: string, query: string) => void;
  onNavigate: (reconciliationId: string, observationId: string, query: string, page: number, cursor?: string) => void;
  onExplicitTarget: (observationId: string, stableRecordId: string) => void;
  onDecide: (line: ReconciliationLine, outcome: "create" | "reject" | "link" | "keep-current", stableRecordId?: string) => void;
};

function ConflictControls({ line, reconciliationId, busy, query, targetPage, serverPage, explicitTarget, searchPending,
  onQueryChange, onSearch, onNavigate, onExplicitTarget, onDecide }: ConflictControlsProps) {
  const outcomes = allowedDecisionOutcomes(line);
  const options = serverPage?.records ?? [];
  const total = serverPage?.total ?? "0";
  const targetPageCount = exactPageCount(total, STABLE_RECORD_PAGE_SIZE);
  const currentTarget = keepCurrentTarget(line);
  return <div className="mt-3 flex min-w-0 flex-wrap gap-2">
    {outcomes.includes("create") && <button className={button} disabled={busy} onClick={() => onDecide(line, "create")}>Criar identidade</button>}
    {outcomes.includes("link") && line.match.candidateIds.slice(0, STABLE_RECORD_PAGE_SIZE).map((candidateId) =>
      <button key={candidateId} className="rounded-xl border px-4 py-3 text-sm font-bold" disabled={busy} onClick={() => onDecide(line, "link", candidateId)}>Vincular {candidateId}</button>)}
    {outcomes.includes("keep-current") && currentTarget && <button className="rounded-xl border px-4 py-3 text-sm font-bold" disabled={busy} onClick={() => onDecide(line, "keep-current", currentTarget)}>Manter camada vigente</button>}
    {outcomes.includes("link") && <div className="flex min-w-0 flex-wrap items-end gap-2 basis-full">
      <label className="min-w-0 flex-1 text-sm font-semibold" htmlFor={`stable-target-${line.observation.id}`}>Buscar registro estável existente
        <input id={`stable-search-${line.observation.id}`} aria-label={`Buscar registro estável para ${line.observation.locator}`} className="mt-1 block min-w-0 w-full rounded-xl border px-3 py-3 font-normal" value={query} onChange={(event) => onQueryChange(line.observation.id, event.target.value)} />
        <button type="button" className="mt-2 rounded-xl border px-3 py-3 text-sm font-bold" disabled={searchPending} onClick={() => onSearch(reconciliationId, line.observation.id, query)}>{searchPending ? "Buscando…" : "Buscar"}</button>
        <select id={`stable-target-${line.observation.id}`} aria-label={`Registro estável para ${line.observation.locator}`} className="mt-1 block min-w-0 w-full rounded-xl border px-3 py-3 font-normal" value={explicitTarget} onChange={(event) => onExplicitTarget(line.observation.id, event.target.value)}>
          <option value="">Selecione um ID opaco</option>
          {options.map((record) => <option key={record.id} value={record.id}>{record.id}{Object.keys(record.matchingAttributes).length ? ` — ${Object.entries(record.matchingAttributes).map(([key, value]) => `${key}=${value}`).join(", ")}` : ""}</option>)}
        </select>
      </label>
      <div className="flex basis-full items-center gap-2 text-xs" aria-label="Paginação de registros estáveis">
        <button type="button" className="rounded-lg border px-2 py-1" disabled={targetPage === 0 || searchPending} onClick={() => { const next = Math.max(0, targetPage - 1); onNavigate(reconciliationId, line.observation.id, query, next, serverPage?.cursors[next]); }}>Anterior</button>
        <span>Página {targetPage + 1} de {targetPageCount} — {total} registro(s)</span>
        <button type="button" className="rounded-lg border px-2 py-1" disabled={!serverPage?.nextCursor || searchPending} onClick={() => onNavigate(reconciliationId, line.observation.id, query, targetPage + 1, serverPage?.nextCursor)}>Próxima</button>
      </div>
      <button className="rounded-xl border px-4 py-3 text-sm font-bold" disabled={busy || !explicitTarget} onClick={() => onDecide(line, "link", explicitTarget)}>Vincular registro selecionado</button>
      {explicitTarget && (() => { const target = options.find((record) => record.id === explicitTarget); return target ? <p className="basis-full break-words text-sm" aria-label="Contexto efetivo do registro selecionado">Camada vigente: <strong>{target.effectiveLayer}</strong>. Campos efetivos usados apenas como evidência: {Object.entries(target.effectivePayload).map(([key, value]) => `${key}=${value ?? "(vazio)"}`).join("; ") || "nenhum"}.</p> : null; })()}
    </div>}
    <button className="rounded-xl border px-4 py-3 text-sm font-bold" disabled={busy} onClick={() => onDecide(line, "reject")}>Rejeitar linha</button>
  </div>;
}

export function ConsolidatedSourceReconciliation({ preview, confirmation }: { preview: Preview; confirmation: PreviewConfirmation }) {
  const [reconciliation, setReconciliation] = useState<PublicReconciliation | null>(null);
  const operations = useReconciliationOperationController();
  const absenceRequest = useRef<object | null>(null);
  const targetRequests = useRef(new Map<string, PendingTargetRequest>());
  const [hydrating, setHydrating] = useState(true);
  const [filter, setFilter] = useState<"all" | ReconciliationCategory>("all");
  const [explicitTargets, setExplicitTargets] = useState<Record<string, string>>({});
  const [projectionVersion, setProjectionVersion] = useState<string | null>(null);
  const [openDrilldowns, setOpenDrilldowns] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [absencePage, setAbsencePage] = useState(0);
  const [absenceCursors, setAbsenceCursors] = useState<Array<string | undefined>>([undefined]);
  const [targetPages, setTargetPages] = useState<Record<string, number>>({});
  const [targetQueries, setTargetQueries] = useState<Record<string, string>>({});
  const [targetResults, setTargetResults] = useState<Record<string, TargetSearchResult>>({});
  const [targetSearchPending, setTargetSearchPending] = useState<Record<string, boolean>>({});
  const [absenceResult, setAbsenceResult] = useState<{ total: string; absences: AbsenceCoverage[]; page: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = `tria-source-reconciliation:${confirmation.confirmationId}`;
  const invalidateTargetRequests = useCallback((observationId?: string) => {
    for (const request of targetRequests.current.values()) {
      if (!observationId || request.observationId === observationId) request.valid = false;
    }
  }, []);
  const invalidateLeafRequestRefs = useCallback(() => {
    absenceRequest.current = null;
    invalidateTargetRequests();
    targetRequests.current.clear();
  }, [invalidateTargetRequests]);
  const activateReconciliation = useCallback((value: PublicReconciliation | null) => {
    invalidateLeafRequestRefs();
    setTargetSearchPending({});
    operations.beginLifecycle(value?.id ?? null);
    operations.invalidateBusy();
    setBusy(false);
    setReconciliation(value);
    setFilter("all");
    setPage(0);
    setAbsencePage(0);
    setAbsenceResult(null);
    setAbsenceCursors([undefined]);
    setExplicitTargets({});
    setTargetPages({});
    setTargetQueries({});
    setTargetResults({});
    setProjectionVersion(value?.projectionVersion ?? null);
  }, [invalidateLeafRequestRefs, operations]);
  const beginBusyOperation = useCallback(() => {
    const token = operations.beginBusy();
    setBusy(true);
    return token;
  }, [operations]);
  const finishBusyOperation = useCallback((token: number) => {
    if (operations.isBusy(token)) setBusy(false);
  }, [operations]);
  const [reconciliationAttempt, setReconciliationAttempt] = useState(0);
  const filteredLines = useMemo(() => reconciliation?.lines.filter((line) => filter === "all" || line.category === filter) ?? [], [filter, reconciliation]);
  const pageCount = Math.max(1, Math.ceil(filteredLines.length / RECONCILIATION_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleLines = paginateReconciliationLines(filteredLines, currentPage);
  const absenceTotal = absenceResult?.total ?? String(reconciliation?.summary.absent ?? 0);
  const absencePageCount = exactPageCount(absenceTotal, ABSENCE_PAGE_SIZE);
  const currentAbsencePage = absencePage;
  // Absences are always fetched from the server for the active page. There is
  // deliberately no client-side catalog fallback that could mount thousands
  // of historical rows or expose stale data after reload.
  const visibleAbsences = absenceResult?.page === currentAbsencePage ? absenceResult.absences : [];

  const loadAbsences = useCallback(async (reconciliationId: string, nextPage = 0, cursor?: string) => {
    const scope = operations.captureLeaf(reconciliationId);
    const request = {};
    absenceRequest.current = request;
    const active = () => absenceRequest.current === request && operations.isLeaf(scope);
    try {
      const pendingPage = listConsolidatedAbsencesAction({ reconciliationId, page: nextPage, pageSize: ABSENCE_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      if (!pendingPage) return;
      const result = await pendingPage.catch(() => null);
      if (!active()) return;
      if (!result) {
        setAbsenceResult(null);
        setMessage("Não foi possível carregar as ausências desta revisão. Tente novamente.");
        return;
      }
      if (result.ok) {
        setAbsenceResult({ total: result.data.total, absences: result.data.absences, page: result.data.page });
        setAbsenceCursors((current) => {
          const next = current.slice(0, nextPage + 1);
          next[nextPage] = cursor;
          next[nextPage + 1] = result.data.nextCursor;
          return next;
        });
        return;
      }
      if (result.error.leafReconciliationId) {
        const refreshed = await reopenConsolidatedReconciliationAction({ reconciliationId: result.error.leafReconciliationId });
        if (!active()) return;
        if (refreshed.ok && refreshed.data) {
          activateReconciliation(refreshed.data);
          setMessage("A revisão mudou; todas as páginas foram recarregadas sobre a leaf vigente.");
        } else {
          setAbsenceResult(null);
          setMessage(refreshed.ok ? result.error.message : refreshed.error.message);
        }
        return;
      }
      setAbsenceResult(null);
      setMessage(result.error.message);
    } finally {
      if (absenceRequest.current === request) absenceRequest.current = null;
    }
  }, [activateReconciliation, operations]);

  const searchTargets = useCallback(async (reconciliationId: string, observationId: string, query: string, nextPage = 0, cursor?: string) => {
    const scope = operations.captureLeaf(reconciliationId);
    const requestKey = `${scope.generation}:${observationId}`;
    if (targetRequests.current.has(requestKey)) return;
    const request: PendingTargetRequest = { scope, observationId, valid: true };
    targetRequests.current.set(requestKey, request);
    setTargetSearchPending((current) => ({ ...current, [observationId]: true }));
    const active = () => request.valid && targetRequests.current.get(requestKey) === request && operations.isLeaf(scope);
    try {
      const pendingSearch = searchConsolidatedStableRecordsAction({ reconciliationId, query, page: nextPage, pageSize: STABLE_RECORD_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      if (!pendingSearch) return;
      const result = await pendingSearch.catch(() => null);
      if (!active()) return;
      if (!result) {
        setTargetResults((current) => { const next = { ...current }; delete next[observationId]; return next; });
        setMessage("Não foi possível buscar registros nesta revisão. Tente novamente.");
        return;
      }
      if (result.ok) {
        setTargetResults((current) => {
          const previous = current[observationId];
          const cursors = previous?.query === query ? previous.cursors.slice(0, nextPage + 1) : [undefined];
          cursors[nextPage] = cursor;
          cursors[nextPage + 1] = result.data.nextCursor;
          return { ...current, [observationId]: { records: result.data.records as StableRecordContext[], total: result.data.total,
            page: result.data.page, query, cursors, ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {}) } };
        });
        return;
      }
      if (result.error.leafReconciliationId) {
        const refreshed = await reopenConsolidatedReconciliationAction({ reconciliationId: result.error.leafReconciliationId });
        if (!active()) return;
        if (refreshed.ok && refreshed.data) {
          activateReconciliation(refreshed.data);
          setMessage("A revisão mudou; todas as páginas foram recarregadas sobre a leaf vigente.");
        } else {
          setTargetResults((current) => { const next = { ...current }; delete next[observationId]; return next; });
          setMessage(refreshed.ok ? result.error.message : refreshed.error.message);
        }
        return;
      }
      setTargetResults((current) => { const next = { ...current }; delete next[observationId]; return next; });
      setMessage(result.error.message);
    } finally {
      if (targetRequests.current.get(requestKey) === request) {
        targetRequests.current.delete(requestKey);
        if (operations.isLeaf(scope)) {
          setTargetSearchPending((current) => { const next = { ...current }; delete next[observationId]; return next; });
        }
      }
    }
  }, [activateReconciliation, operations]);

  const changeTargetQuery = useCallback((observationId: string, query: string) => {
    invalidateTargetRequests(observationId);
    setTargetQueries((current) => ({ ...current, [observationId]: query }));
    setTargetPages((current) => ({ ...current, [observationId]: 0 }));
    setExplicitTargets((current) => ({ ...current, [observationId]: "" }));
    setTargetResults((current) => { const next = { ...current }; delete next[observationId]; return next; });
  }, [invalidateTargetRequests]);
  const startTargetSearch = useCallback((reconciliationId: string, observationId: string, query: string) => {
    setTargetPages((current) => ({ ...current, [observationId]: 0 }));
    setExplicitTargets((current) => ({ ...current, [observationId]: "" }));
    void searchTargets(reconciliationId, observationId, query, 0);
  }, [searchTargets]);
  const navigateTargetSearch = useCallback((reconciliationId: string, observationId: string, query: string, nextPage: number, cursor?: string) => {
    setTargetPages((current) => ({ ...current, [observationId]: nextPage }));
    setExplicitTargets((current) => ({ ...current, [observationId]: "" }));
    void searchTargets(reconciliationId, observationId, query, nextPage, cursor);
  }, [searchTargets]);
  const changeExplicitTarget = useCallback((observationId: string, stableRecordId: string) => {
    setExplicitTargets((current) => ({ ...current, [observationId]: stableRecordId }));
  }, []);

  useEffect(() => () => {
    operations.beginLifecycle(null);
    operations.invalidateBusy();
    invalidateLeafRequestRefs();
  }, [invalidateLeafRequestRefs, operations]);

  useEffect(() => {
    if (!reconciliation) return;
    const timeout = setTimeout(() => void loadAbsences(reconciliation.id), 0);
    return () => clearTimeout(timeout);
  }, [loadAbsences, reconciliation]);

  useEffect(() => {
    let cancelled = false;
    invalidateLeafRequestRefs();
    const generation = operations.beginLifecycle(null);
    const active = () => !cancelled && operations.isLifecycle(generation);
    void (async () => {
      try {
        const result = await reopenConsolidatedReconciliationByPreviewAction({ previewId: preview.previewId });
        if (!active()) return;
        if (result.ok && result.data) {
          activateReconciliation(result.data);
          setMessage("Reconciliação reaberta após o reload.");
        } else if (result.ok) {
          activateReconciliation(null);
          setMessage("A versão anterior expirou. Compare novamente para abrir a base vigente.");
        } else if (result.error.code === "PROJECTION_VERSION_CONFLICT") {
          const recovered = await recoverConsolidatedPreviewAction({ previewId: preview.previewId });
          if (!active()) return;
          if (recovered.ok) {
            setReconciliationAttempt((current) => current + 1);
            activateReconciliation(recovered.data.reconciliation);
            setMessage("Reconciliação obsoleta recuperada automaticamente no servidor.");
          } else {
            activateReconciliation(null);
            setMessage(recovered.error.message);
          }
        } else {
          setMessage(result.error.message);
        }
      } catch {
        if (active()) setMessage("Não foi possível restaurar a reconciliação nesta sessão.");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activateReconciliation, invalidateLeafRequestRefs, operations, preview.previewId]);

  useEffect(() => {
    if (!reconciliation) return;
    const stored = readStoredDrilldowns(storageKey);
    if (!Object.values(stored).some(Boolean)) return;
    const restore = window.setTimeout(() => setOpenDrilldowns(stored), 0);
    return () => window.clearTimeout(restore);
  }, [reconciliation, storageKey]);

  async function compare() {
    invalidateLeafRequestRefs();
    setTargetSearchPending({});
    const generation = operations.beginLifecycle(null);
    const busyToken = beginBusyOperation();
    setHydrating(false);
    setMessage("Comparando a prévia confirmada com a projeção vigente…");
    try {
      const result = await reconcileConsolidatedPreviewAction({ idempotencyKey: `reconcile-${confirmation.confirmationId}-${reconciliationAttempt}`, previewId: preview.previewId });
      if (!operations.isLifecycle(generation)) return;
      if (result.ok) {
        activateReconciliation(result.data.reconciliation);
        setMessage(result.data.reused ? "Comparação reutilizada de forma idempotente." : "Comparação concluída. Resolva as decisões pendentes.");
      } else if (result.error.code === "PROJECTION_VERSION_CONFLICT") {
        setMessage("A projeção mudou. Recuperando a comparação no servidor…");
        const recovered = await recoverConsolidatedPreviewAction({ previewId: preview.previewId });
        if (!operations.isLifecycle(generation)) return;
        if (recovered.ok) {
          setReconciliationAttempt((current) => current + 1);
          activateReconciliation(recovered.data.reconciliation);
          setMessage("Comparação recuperada sobre a versão vigente.");
        } else {
          setMessage(`${recovered.error.message} (${recovered.error.code})`);
        }
      } else {
        setMessage(`${result.error.message} (${result.error.code})`);
      }
    } catch {
      if (operations.isLifecycle(generation)) setMessage("Não foi possível comparar esta prévia.");
    } finally {
      finishBusyOperation(busyToken);
    }
  }

  async function decide(line: ReconciliationLine, outcome: "create" | "reject" | "link" | "keep-current", stableRecordId?: string) {
    if (!reconciliation) return;
    const parent = reconciliation;
    const parentId = parent.id;
    const scope = operations.beginDecision(parentId);
    const busyToken = beginBusyOperation();
    const active = () => operations.isDecision(scope);
    try {
      const result = await decideConsolidatedReconciliationAction({ reconciliationId: parentId, observationId: line.observation.id, locator: line.observation.locator, ...(stableRecordId ? { stableRecordId } : {}), outcome, policyVersion: parent.policy.version, rationale: outcome === "create" ? "Rodrigo confirmou uma nova identidade interna." : outcome === "link" ? "Rodrigo confirmou o vínculo exibido." : outcome === "keep-current" ? "Rodrigo confirmou a permanência da camada vigente." : "Rodrigo decidiu não incluir esta observação.", version: "1" });
      if (!active()) return;
      if (result.ok) {
        const receipt = result.data;
        if (receipt.canonicalReopenRequired || parentId !== receipt.parentReconciliationId) {
          const refreshed = await reopenConsolidatedReconciliationAction({ reconciliationId: receipt.reconciliationId });
          if (!active()) return;
          if (refreshed.ok && refreshed.data) {
            activateReconciliation(refreshed.data);
            setMessage("A revisão mudou; a leaf vigente foi recarregada.");
          } else {
            setMessage(refreshed.ok ? "A leaf vigente não foi encontrada." : refreshed.error.message);
          }
          return;
        }
        const changedByObservation = new Map(receipt.changedLines.map((changed) => [changed.observation.id, changed]));
        const lines = parent.lines.map((existing) => changedByObservation.get(existing.observation.id) ?? existing);
        const decisions = parent.decisions.filter((decision) => decision.id !== receipt.decision.id).concat(receipt.decision);
        activateReconciliation({ ...parent, id: receipt.reconciliationId, parentReconciliationId: receipt.parentReconciliationId,
          revisionNo: receipt.revisionNo, fingerprint: receipt.fingerprint, status: receipt.status,
          createdAt: receipt.createdAt ?? parent.createdAt, summary: receipt.summary, ...(receipt.metrics ? { metrics: receipt.metrics } : {}), lines,
          conflicts: lines.flatMap((candidate) => candidate.conflict ? [candidate.conflict] : []), decisions });
        setMessage("Decisão registrada e aplicada ao estado local.");
      } else if (result.error.leafReconciliationId) {
        const leaf = await reopenConsolidatedReconciliationAction({ reconciliationId: result.error.leafReconciliationId });
        if (!active()) return;
        if (leaf.ok && leaf.data) {
          activateReconciliation(leaf.data);
          setMessage("Uma decisão concorrente venceu; a revisão atual foi reaberta.");
        } else {
          setMessage(`${result.error.message} (${result.error.code})`);
        }
      } else if (result.error.code === "PROJECTION_VERSION_CONFLICT") {
        const recovered = await recoverConsolidatedPreviewAction({ previewId: preview.previewId });
        if (!active()) return;
        if (recovered.ok) {
          setReconciliationAttempt((current) => current + 1);
          activateReconciliation(recovered.data.reconciliation);
          setMessage("A projeção mudou; a reconciliação foi recuperada sobre a versão vigente.");
        } else {
          setMessage(`${recovered.error.message} (${recovered.error.code})`);
        }
      } else {
        setMessage(`${result.error.message} (${result.error.code})`);
      }
    } catch {
      if (active()) setMessage("Não foi possível registrar a decisão.");
    } finally {
      finishBusyOperation(busyToken);
    }
  }

  async function apply() {
    if (!reconciliation || (reconciliation.status !== "ready-to-apply" && reconciliation.status !== "applied")) return;
    const parentId = reconciliation.id;
    const scope = operations.captureLeaf(parentId);
    const busyToken = beginBusyOperation();
    const active = () => operations.isLeaf(scope);
    setMessage("Aplicando eventos e projeção em uma transação…");
    try {
      const result = await applyConsolidatedReconciliationAction({ reconciliationId: parentId, idempotencyKey: `apply-${parentId}` });
      if (!active()) return;
      const view = applyReconciliationUiState(result);
      if (result.ok && view.kind === "applied") {
        activateReconciliation(result.data.reconciliation);
        setProjectionVersion(view.projectionVersion);
        setMessage(view.message);
      } else if (!result.ok && result.error.leafReconciliationId) {
        const leaf = await reopenConsolidatedReconciliationAction({ reconciliationId: result.error.leafReconciliationId });
        if (!active()) return;
        if (leaf.ok && leaf.data) {
          activateReconciliation(leaf.data);
          setMessage("A aplicação usava uma revisão obsoleta; a leaf vigente foi reaberta sem efeitos.");
        } else {
          setMessage(view.message);
        }
      } else if (view.kind === "reload-required") {
        setReconciliationAttempt((current) => current + 1);
        activateReconciliation(null);
        setMessage(view.message);
      } else {
        setMessage(view.message);
      }
    } catch {
      if (active()) setMessage("Não foi possível aplicar a reconciliação.");
    } finally {
      finishBusyOperation(busyToken);
    }
  }

  return <section aria-labelledby="reconciliation-title" className="mt-6 min-w-0 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm sm:p-6">
    <h2 id="reconciliation-title" className="text-xl font-bold">Reconciliar e aplicar observações recorrentes</h2>
    <p className="mt-2 text-sm leading-6">A comparação usa a confirmação exata da prévia. Cada linha mostra origem, consequência e decisão; ausência permanece vigente como “Não observado neste lote”.</p>
    <p role="status" aria-live="polite" className="my-3 break-words text-sm">{message}</p>
    {!reconciliation && <button className={button} disabled={busy || hydrating} onClick={() => void compare()}>Comparar prévia confirmada</button>}
    {reconciliation && <>
      <div className="my-4 grid min-w-0 gap-2 sm:grid-cols-3" aria-label="Resumo da reconciliação">
        {(["all", "inserted", "updated", "unchanged", "rejected", "conflict"] as const).map((key) => <button key={key} className="min-w-0 rounded-lg border bg-slate-50 p-3 text-left text-sm" aria-pressed={filter === key} onClick={() => { invalidateTargetRequests(); setFilter(key); setPage(0); setAbsencePage(0); setTargetPages({}); setExplicitTargets({}); setTargetResults({}); }}>{key === "all" ? "Todas" : labels[key]}: {key === "all" ? reconciliation.summary.total : reconciliation.summary[key]}</button>)}
      </div>
      <p className="text-sm">Estado: <strong>{reconciliation.status === "needs-decision" ? "aguarda decisões" : reconciliation.status === "ready-to-apply" ? "pronta para aplicar" : reconciliation.status === "applied" ? "aplicada" : "rascunho"}</strong>. {reconciliation.summary.absent} registro(s): <em>Não observado neste lote</em>.</p>
      {decimalTotalExceeds(absenceTotal, 0) && <>
        {decimalTotalExceeds(absenceTotal, ABSENCE_PAGE_SIZE) && <nav aria-label="Paginação das ausências" className="my-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={currentAbsencePage === 0} onClick={() => { const next = Math.max(0, currentAbsencePage - 1); setAbsencePage(next); void loadAbsences(reconciliation.id, next, absenceCursors[next]); }}>Página anterior</button>
          <span aria-live="polite">Ausências: página {currentAbsencePage + 1} de {absencePageCount} — {absenceTotal} registro(s)</span>
          <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={!absenceCursors[currentAbsencePage + 1]} onClick={() => { const next = currentAbsencePage + 1; setAbsencePage(next); void loadAbsences(reconciliation.id, next, absenceCursors[next]); }}>Próxima página</button>
        </nav>}
        <ul aria-label="Ausências" className="mt-3 grid min-w-0 gap-2 text-sm">{visibleAbsences.map((absence) => <li key={absence.stableRecordId} className="break-words rounded-lg border border-amber-200 bg-amber-50 p-3"><strong>Não observado neste lote</strong> — ID: <span className="break-all">{absence.stableRecordId}</span>{absence.effectiveVersion !== undefined ? `; versão: ${absence.effectiveVersion}` : ""}{absence.effectivePayload ? `; payload vigente: ${Object.entries(absence.effectivePayload).map(([field, value]) => `${field}=${value ?? "(vazio)"}`).join(", ")}` : ""}</li>)}</ul>
      </>}
      {filteredLines.length > RECONCILIATION_PAGE_SIZE && <nav aria-label="Paginação das linhas reconciliadas" className="my-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={currentPage === 0} onClick={() => { invalidateTargetRequests(); setPage((current) => Math.max(0, Math.min(current, pageCount - 1) - 1)); setExplicitTargets({}); setTargetResults({}); }}>Página anterior</button>
        <span aria-live="polite">Página {currentPage + 1} de {pageCount} — {filteredLines.length} linha(s) nesta seleção</span>
        <button type="button" className="rounded-xl border px-3 py-2 font-bold" disabled={currentPage >= pageCount - 1} onClick={() => { invalidateTargetRequests(); setPage((current) => Math.min(pageCount - 1, Math.max(0, current) + 1)); setExplicitTargets({}); setTargetResults({}); }}>Próxima página</button>
      </nav>}
      <div className="mt-4 min-w-0" aria-label="Linhas reconciliadas">{visibleLines.map((line) => <article key={line.observation.id} className="my-2 min-w-0 rounded-xl border p-4">
        <h3 className="break-words font-bold">{line.observation.locator} — {labels[line.category]}</h3>
        <p className="mt-1 break-words text-sm">{line.consequence}</p>
        {line.fieldDiffs.length > 0 && <dl className="mt-3 grid min-w-0 gap-2 text-sm">{line.fieldDiffs.map((diff) => <div key={diff.field} className="min-w-0"><dt className="font-bold">{diff.field}</dt><dd className="break-words">Original: {diff.originalPresent ? (diff.original ?? "null") : "ausente"}; proposto: {diff.proposedPresent ? (diff.proposed ?? "null") : "ausente"}; camada vigente: {diff.layer}; causa: {diff.cause}</dd></div>)}</dl>}
        <details key={`${line.observation.id}:${openDrilldowns[line.observation.id] ? "open" : "closed"}`} open={Boolean(openDrilldowns[line.observation.id])} onToggle={(event) => { const open = event.currentTarget.open; setOpenDrilldowns((current) => ({ ...current, [line.observation.id]: open })); rememberDrilldown(storageKey, line.observation.id, open); }} className="mt-3 min-w-0 rounded-lg border border-slate-200 p-3 text-sm"><summary onClick={(event) => { const details = event.currentTarget.parentElement; if (details instanceof HTMLDetailsElement) rememberDrilldown(storageKey, line.observation.id, !details.open); }} className="cursor-pointer font-semibold">Origem e proveniência da observação</summary><dl className="mt-2 grid min-w-0 gap-1"><div><dt className="font-semibold">Locator</dt><dd className="break-all">{line.observation.locator}</dd></div><div><dt className="font-semibold">Valores de origem</dt><dd className="break-words">{Object.entries(line.observation.sourceValues).map(([field, value]) => `${field}=${value}`).join("; ") || "Nenhum valor informado."}</dd></div><div><dt className="font-semibold">Decimais preservados</dt><dd className="break-words">{Object.entries(line.observation.decimalSources).map(([field, value]) => `${field}: ${value.source_text} (escala ${value.source_scale}; normalizado ${value.normalized_value ?? "não informado"})`).join("; ") || "Nenhum decimal informado."}</dd></div><div><dt className="font-semibold">Durações preservadas</dt><dd className="break-words">{Object.entries(line.observation.durationSources ?? {}).map(([field, value]) => `${field}: ${value.source_text} (${value.unit})`).join("; ") || "Nenhuma duração informada."}</dd></div></dl></details>
        {line.conflict && <p className="mt-3 break-words text-sm text-red-800">Conflito: {line.conflict.message} {line.conflict.candidateIds.length ? `Candidatos: ${line.conflict.candidateIds.join(", ")}.` : ""}</p>}
        {line.decision && <p className="mt-3 break-words text-sm" aria-label={`Decisão auditada para ${line.observation.locator}`}>
          Decisão auditada: <strong>{line.decision.outcome}</strong>{line.decision.stableRecordId ? <>; ID opaco: <span className="break-all">{line.decision.stableRecordId}</span></> : ""}.
        </p>}
        {line.category === "conflict" && !line.conflict?.resolution && reconciliation.status !== "applied" && <ConflictControls
          line={line}
          reconciliationId={reconciliation.id}
          busy={busy}
          query={targetQueries[line.observation.id] ?? ""}
          targetPage={targetResults[line.observation.id]?.page ?? targetPages[line.observation.id] ?? 0}
          serverPage={targetResults[line.observation.id]}
          explicitTarget={explicitTargets[line.observation.id] ?? ""}
          searchPending={Boolean(targetSearchPending[line.observation.id])}
          onQueryChange={changeTargetQuery}
          onSearch={startTargetSearch}
          onNavigate={navigateTargetSearch}
          onExplicitTarget={changeExplicitTarget}
          onDecide={decide}
        />}
      </article>)}</div>
      {reconciliation.status !== "applied" && <button className={`${button} mt-4`} disabled={busy || reconciliation.status !== "ready-to-apply"} onClick={() => void apply()}>Confirmar e aplicar recorte aceito</button>}
      {reconciliation.status === "applied" && <>
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold">Resultado aplicado e congelado{projectionVersion ? ` na versão da projeção ${projectionVersion}.` : "."}</p>
        <button className="mt-3 rounded-xl border px-4 py-3 text-sm font-bold" disabled={busy} onClick={() => void apply()}>Repetir aplicação idempotente</button>
      </>}
    </>}
  </section>;
}
