import "server-only";

import { randomUUID } from "node:crypto";
import {
  addDemoFinancialEntry,
  assertDemoCompositionMatches,
  buildDemoCompositionHash,
  buildPublicationSnapshot,
  financialOrigins,
  formatBrlFromCents,
  listDemoProjectPublications,
  manualFinancialKinds,
  parseBrlToCents,
  publishDemoProject,
  readDemoProjectDraft,
  readDemoPublication,
  saveDemoNarrative,
  verifyDemoPublicationIntegrity,
  type DemoProjectDraft,
  type DemoPublication,
  type FinancialOrigin,
  type HistoryEvent,
  type ManualFinancialEntry,
  type ManualFinancialKind,
  PublicationIntegrityError,
} from "./demo-workspace";
import { getSql, isDatabaseConfigured } from "./database";
import { getProjectDetails } from "./project-repository";

export {
  financialOrigins,
  formatBrlFromCents,
  manualFinancialKinds,
  parseBrlToCents,
  verifyDemoPublicationIntegrity,
  PublicationIntegrityError,
};
export type {
  DemoProjectDraft,
  DemoPublication,
  FinancialOrigin,
  HistoryEvent,
  ManualFinancialEntry,
  ManualFinancialKind,
};

const actor = "Rodrigo";

export function buildWorkspaceCompositionHash(project: Parameters<typeof buildDemoCompositionHash>[0], draft: DemoProjectDraft) {
  return buildDemoCompositionHash(project, draft, isDatabaseConfigured() ? "Dados privados locais" : "Dados fictícios");
}

export async function readProjectDraft(projectId: string): Promise<DemoProjectDraft> {
  if (!isDatabaseConfigured()) return readDemoProjectDraft(projectId);
  const sql = getSql();
  const { draftRows, entries, history } = await sql.begin("read only isolation level repeatable read", async (tx) => {
    const draftRows = await tx<{ narrative: string; revision: string; updated_at: string | null }[]>`
      SELECT narrative, revision::text, updated_at::text FROM project_draft WHERE project_id = ${projectId}`;
    const entries = await tx<{ id: string; kind: ManualFinancialKind; description: string; amount_cents: string; origin: FinancialOrigin; document_state: ManualFinancialEntry["documentState"]; request_id: string; created_at: string }[]>`
      SELECT id::text, kind, description, amount_cents::text, origin, document_state, request_id::text, created_at::text
      FROM manual_financial_entry WHERE project_id = ${projectId} ORDER BY created_at, id`;
    const history = await tx<{ id: string; action: string; detail: string; actor: string; occurred_at: string }[]>`
      SELECT id::text, action, detail, actor, occurred_at::text FROM history_event
      WHERE project_id = ${projectId} ORDER BY occurred_at DESC, id DESC`;
    return { draftRows, entries, history };
  });
  if (!draftRows[0]) throw new Error("Projeto local desconhecido.");
  return {
    narrative: draftRows[0].narrative,
    revision: draftRows[0].revision,
    updatedAt: draftRows[0].updated_at,
    manualFinancialEntries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      description: entry.description,
      amountCents: entry.amount_cents,
      origin: entry.origin,
      documentState: entry.document_state,
      requestId: entry.request_id,
      createdAt: entry.created_at,
    })),
    history: history.map((event) => ({
      id: event.id,
      action: event.action,
      detail: event.detail,
      actor: event.actor,
      occurredAt: event.occurred_at,
    })),
  };
}

export async function saveNarrative(projectId: string, narrative: string, expectedRevision?: string) {
  if (!isDatabaseConfigured()) return saveDemoNarrative(projectId, narrative, expectedRevision);
  const sql = getSql();
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    const updated = await tx`UPDATE project_draft SET narrative = ${narrative}, revision = revision + 1, updated_at = ${now}
      WHERE project_id = ${projectId} AND revision = ${expectedRevision ?? "-1"} RETURNING project_id`;
    if (!updated.length) {
      const exists = await tx`SELECT 1 FROM project_draft WHERE project_id = ${projectId}`;
      if (!exists.length) throw new Error("Projeto local desconhecido.");
      throw new Error("A narrativa mudou depois que este formulário foi aberto.");
    }
    await tx`INSERT INTO history_event (id, project_id, action, detail, actor, occurred_at)
      VALUES (${randomUUID()}, ${projectId}, 'Narrativa salva', 'Uma nova versão do texto foi registrada no ambiente local privado.', ${actor}, ${now})`;
  });
}

export async function addFinancialEntry(
  projectId: string,
  entry: Omit<ManualFinancialEntry, "id" | "createdAt">,
  requestId: string,
) {
  if (!isDatabaseConfigured()) return addDemoFinancialEntry(projectId, { ...entry, requestId });
  const sql = getSql();
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const project = await tx`SELECT id FROM project WHERE id = ${projectId}`;
    if (!project.length) throw new Error("Projeto local desconhecido.");
    const inserted = await tx`INSERT INTO manual_financial_entry
      (id, project_id, kind, description, amount_cents, origin, document_state, request_id, created_at)
      VALUES (${randomUUID()}, ${projectId}, ${entry.kind}, ${entry.description}, ${entry.amountCents}, ${entry.origin}, ${entry.documentState}, ${requestId}, ${now})
      ON CONFLICT (request_id) DO NOTHING RETURNING id`;
    if (!inserted.length) return;
    await tx`UPDATE project_draft SET revision = revision + 1, updated_at = ${now} WHERE project_id = ${projectId}`;
    await tx`INSERT INTO history_event (id, project_id, action, detail, actor, occurred_at)
      VALUES (${randomUUID()}, ${projectId}, 'Valor registrado', ${`${entry.kind}: ${entry.description}.`}, ${actor}, ${now})`;
  });
}

export async function publishProject(
  projectId: string,
  expectedCompositionHash?: string,
  caveatsAcknowledged = false,
  expectedRevision?: string,
): Promise<{ publication: DemoPublication; created: boolean }> {
  if (!isDatabaseConfigured()) return publishDemoProject(projectId, expectedCompositionHash, caveatsAcknowledged, expectedRevision);
  if (!caveatsAcknowledged) throw new Error("A conferência explícita é obrigatória.");
  const project = await getProjectDetails(projectId);
  if (!project) throw new Error("Projeto local desconhecido.");
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const draftRows = await tx<{ narrative: string; revision: string; updated_at: string | null }[]>`
      SELECT narrative, revision::text, updated_at::text FROM project_draft WHERE project_id = ${projectId} FOR UPDATE`;
    if (!draftRows[0]) throw new Error("Projeto local desconhecido.");
    if (expectedRevision !== undefined && draftRows[0].revision !== expectedRevision) {
      throw new Error("A composição mudou depois da conferência.");
    }
    if (draftRows[0].narrative.trim().length < 20) throw new Error("A narrativa precisa ter pelo menos 20 caracteres.");
    const entries = await tx<{ id: string; kind: ManualFinancialKind; description: string; amount_cents: string; origin: FinancialOrigin; document_state: ManualFinancialEntry["documentState"]; created_at: string }[]>`
      SELECT id::text, kind, description, amount_cents::text, origin, document_state, created_at::text
      FROM manual_financial_entry WHERE project_id = ${projectId} ORDER BY created_at, id`;
    const draft: DemoProjectDraft = {
      narrative: draftRows[0].narrative,
      updatedAt: draftRows[0].updated_at,
      history: [],
      manualFinancialEntries: entries.map((entry) => ({
        id: entry.id, kind: entry.kind, description: entry.description, amountCents: entry.amount_cents,
        origin: entry.origin, documentState: entry.document_state, createdAt: entry.created_at,
      })),
    };
    const priorRows = await tx<{ snapshot: DemoPublication }[]>`
      SELECT snapshot FROM publication WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    const prior = priorRows[0]?.snapshot ? verifyDemoPublicationIntegrity(priorRows[0].snapshot) : null;
    const now = new Date().toISOString();
    const candidate = buildPublicationSnapshot(
      project, draft, (prior?.version ?? 0) + 1, prior?.id ?? null, now,
      randomUUID(), "Dados privados locais", actor,
    );
    if (expectedCompositionHash) assertDemoCompositionMatches(expectedCompositionHash, candidate.contentHash);
    if (prior?.contentHash === candidate.contentHash) return { publication: prior, created: false };
    await tx`INSERT INTO publication
      (id, project_id, version, prior_publication_id, created_at, created_by, content_hash, record_hash, snapshot)
      VALUES (${candidate.id}, ${projectId}, ${candidate.version}, ${candidate.priorPublicationId}, ${candidate.createdAt},
        ${candidate.createdBy}, ${candidate.contentHash}, ${candidate.recordHash}, ${tx.json(candidate)})`;
    await tx`INSERT INTO history_event (id, project_id, action, detail, actor, occurred_at)
      VALUES (${randomUUID()}, ${projectId}, ${`Publicação V${candidate.version} criada`},
        'Uma cópia imutável do conteúdo local foi registrada.', ${actor}, ${now})`;
    await tx`UPDATE project_draft SET revision = revision + 1, updated_at = ${now} WHERE project_id = ${projectId}`;
    return { publication: candidate, created: true };
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PublicationRow = {
  id: string; project_id: string; version: number; prior_publication_id: string | null;
  created_at: string; created_by: string; content_hash: string; record_hash: string; snapshot: DemoPublication;
};

function verifiedPublicationRow(row: PublicationRow) {
  const snapshot = verifyDemoPublicationIntegrity(row.snapshot);
  if (snapshot.id !== row.id || snapshot.projectId !== row.project_id || snapshot.version !== row.version ||
      snapshot.priorPublicationId !== row.prior_publication_id || snapshot.createdBy !== row.created_by ||
      snapshot.contentHash !== row.content_hash || snapshot.recordHash !== row.record_hash ||
      new Date(snapshot.createdAt).getTime() !== new Date(row.created_at).getTime()) {
    throw new PublicationIntegrityError();
  }
  return snapshot;
}

export async function readPublication(publicationId: string) {
  if (!isDatabaseConfigured()) return readDemoPublication(publicationId);
  if (!uuidPattern.test(publicationId)) return undefined;
  const sql = getSql();
  const rows = await sql<PublicationRow[]>`SELECT id::text, project_id, version, prior_publication_id::text,
      created_at::text, created_by, content_hash, record_hash, snapshot
    FROM publication WHERE id = ${publicationId}`;
  return rows[0] ? verifiedPublicationRow(rows[0]) : undefined;
}

export async function listProjectPublications(projectId: string) {
  if (!isDatabaseConfigured()) return listDemoProjectPublications(projectId);
  const sql = getSql();
  const rows = await sql<PublicationRow[]>`
    SELECT id::text, project_id, version, prior_publication_id::text, created_at::text,
      created_by, content_hash, record_hash, snapshot
    FROM publication WHERE project_id = ${projectId} ORDER BY version DESC`;
  return rows.map(verifiedPublicationRow);
}
