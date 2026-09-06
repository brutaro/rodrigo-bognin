import type {Contract} from './contract-domain';
import { costConfirmationLabel, type CostConfirmation, type CashResult } from "./cash-domain";
import { reimbursementLabel, type ReimbursementStatus } from "./reimbursement-status";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoProjects, type Project } from "./demo-data";

export const manualFinancialKinds = [
  "Custo ou valor do projeto",
  "Nota ou cobrança",
  "Pagamento",
  "Reembolso",
  "Valor informado",
] as const;
export type ManualFinancialKind = (typeof manualFinancialKinds)[number];

export const financialOrigins = [
  "Informado por Rodrigo",
] as const;
export type FinancialOrigin = (typeof financialOrigins)[number];

export type ManualFinancialEntry = {
  confirmation?: CostConfirmation;
  reimbursement?: ReimbursementStatus;
  proofVersionId?: string;
  id: string;
  kind: ManualFinancialKind;
  description: string;
  amountCents: string;
  origin: FinancialOrigin;
  documentState: "Sem arquivo associado" | "Com arquivo associado";
  requestId?: string;
  createdAt: string;
};

export type HistoryEvent = {
  id: string;
  action: string;
  detail: string;
  actor: string;
  occurredAt: string;
};

export type DemoProjectDraft = {
  cash?: CashResult;
  contract?: Contract;
  narrative: string;
  revision?: string;
  manualFinancialEntries: ManualFinancialEntry[];
  history: HistoryEvent[];
  updatedAt: string | null;
};

export type FinancialGroup =
  | "project_measurement"
  | "invoice_or_charge"
  | "payment"
  | "reimbursement"
  | "reported_value"
  | "financial_reference";

export type PublishedFinancialEntry = {
  confirmation?: CostConfirmation;
  reimbursement?: ReimbursementStatus;
  proofVersionId?: string;
  id: string;
  sourceType: "Referência importada" | "Cadastro manual";
  financialGroup: FinancialGroup;
  kind: string;
  label: string;
  amount: string;
  amountCents: string | null;
  relatedAmount: string | null;
  relatedAmountCents: string | null;
  fullValueEligible: boolean | null;
  relationBasis: string;
  currency: "BRL";
  origin: string;
  relation: string;
  payment: string;
  documentState: "Não avaliado" | "Sem arquivo associado" | "Com arquivo associado";
  recordedAt: string | null;
  provenance?: {
    sourceAmount: string;
    sourceDeclaredProjectId: string | null;
    sourceCandidateProjectId: string | null;
    revision: string;
    operation: "adjust" | "restore" | null;
    reason: string | null;
    actor: string | null;
    adjustedAt: string | null;
  };
};

export class PublicationIntegrityError extends Error {
  constructor() {
    super("A integridade da publicação falhou.");
    this.name = "PublicationIntegrityError";
  }
}

export type PublishedFile = {
  documentId: string;
  versionId: string;
  title: string;
  version: number;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
};

export type DemoPublication = {
  cash?: CashResult;
  contract?: Contract;
  id: string;
  projectId: string;
  version: number;
  priorPublicationId: string | null;
  createdAt: string;
  createdBy: string;
  dataClassification: "Dados fictícios" | "Dados privados locais";
  schemaVersion: "tria-publication-v1" | "tria-publication-v2" | "tria-publication-v3" | "tria-publication-v4";
  rendererVersion: "tria-export-v1" | "tria-export-v2" | "tria-export-v3" | "tria-export-v4";
  cutoff: {
    startDate: string;
    endDate: string;
    endInclusive: true;
    timeZone: "America/Sao_Paulo";
    basis: string;
  };
  contentHash: string;
  recordHash: string;
  review: {
    compositionHash: string;
    caveatsAcknowledged: true;
    reviewedAt: string;
    requestId: string;
  };
  title: string;
  period: string;
  narrative: string;
  activities: Project["activities"];
  financialEntries: PublishedFinancialEntry[];
  evidence: Project["evidence"];
  files?: PublishedFile[];
};

type WorkspaceFileV1 = {
  version: 1;
  projects: Record<string, DemoProjectDraft>;
};

type WorkspaceFileV2 = {
  version: 2;
  projects: Record<string, DemoProjectDraft>;
  publications: Array<Omit<DemoPublication, "recordHash">>;
};

type WorkspaceFile = {
  version: 3;
  projects: Record<string, DemoProjectDraft>;
  publications: DemoPublication[];
};

const workspaceDirectory = path.join(process.cwd(), "var");
const workspaceFile = path.join(workspaceDirectory, "demo-workspace.json");
const knownProjectIds = new Set(demoProjects.map((project) => project.id));
let writeQueue: Promise<void> = Promise.resolve();

function emptyDraft(projectId: string): DemoProjectDraft {
  const project = demoProjects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projeto demonstrativo desconhecido.");
  return {
    narrative: project.narrative,
    manualFinancialEntries: [],
    history: [],
    updatedAt: null,
  };
}

function assertKnownProject(projectId: string) {
  if (!knownProjectIds.has(projectId)) throw new Error("Projeto demonstrativo desconhecido.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function computePublicationRecordHash(publication: Omit<DemoPublication, "recordHash">) {
  return createHash("sha256")
    .update(stableStringify({
      id: publication.id,
      projectId: publication.projectId,
      version: publication.version,
      priorPublicationId: publication.priorPublicationId,
      createdAt: publication.createdAt,
      createdBy: publication.createdBy,
      contentHash: publication.contentHash,
      review: publication.review,
    }))
    .digest("hex");
}

function computeLegacyPublicationRecordHash(publication: Omit<DemoPublication, "recordHash">) {
  return createHash("sha256")
    .update(JSON.stringify({
      id: publication.id,
      projectId: publication.projectId,
      version: publication.version,
      priorPublicationId: publication.priorPublicationId,
      createdAt: publication.createdAt,
      createdBy: publication.createdBy,
      contentHash: publication.contentHash,
      review: publication.review,
    }))
    .digest("hex");
}

async function readWorkspaceFile(): Promise<WorkspaceFile> {
  try {
    const raw = await readFile(workspaceFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.projects)) {
      throw new Error("Arquivo de trabalho incompatível.");
    }
    if (parsed.version === 1) {
      const legacy = parsed as unknown as WorkspaceFileV1;
      return { version: 3, projects: legacy.projects, publications: [] };
    }
    if (parsed.version === 2 && Array.isArray(parsed.publications)) {
      const legacy = parsed as unknown as WorkspaceFileV2;
      return {
        version: 3,
        projects: legacy.projects,
        publications: legacy.publications.map((publication) => ({
          ...publication,
          recordHash: computeLegacyPublicationRecordHash(publication),
        })),
      };
    }
    if (parsed.version !== 3 || !Array.isArray(parsed.publications)) {
      throw new Error("Arquivo de trabalho incompatível.");
    }
    return parsed as unknown as WorkspaceFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 3, projects: {}, publications: [] };
    }
    throw error;
  }
}

async function writeWorkspaceFile(state: WorkspaceFile) {
  await mkdir(workspaceDirectory, { recursive: true });
  const temporary = `${workspaceFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}
`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, workspaceFile);
}

async function updateWorkspace<TResult>(
  update: (state: WorkspaceFile) => TResult | Promise<TResult>,
): Promise<TResult> {
  let resolveResult: ((value: TResult) => void) | undefined;
  let rejectResult: ((error: unknown) => void) | undefined;
  const result = new Promise<TResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  writeQueue = writeQueue
    .then(async () => {
      const state = await readWorkspaceFile();
      const value = await update(state);
      await writeWorkspaceFile(state);
      resolveResult?.(value);
    })
    .catch((error) => {
      rejectResult?.(error);
    });

  return result;
}

export async function readDemoProjectDraft(projectId: string): Promise<DemoProjectDraft> {
  assertKnownProject(projectId);
  const state = await readWorkspaceFile();
  return state.projects[projectId] ?? emptyDraft(projectId);
}

async function updateDemoProject(
  projectId: string,
  update: (draft: DemoProjectDraft) => DemoProjectDraft,
) {
  assertKnownProject(projectId);
  await updateWorkspace((state) => {
    const current = state.projects[projectId] ?? emptyDraft(projectId);
    state.projects[projectId] = update(current);
  });
}

export async function saveDemoNarrative(projectId: string, narrative: string, expectedRevision?: string) {
  const now = new Date().toISOString();
  await updateDemoProject(projectId, (draft) => {
    if (expectedRevision !== undefined && (draft.revision ?? "0") !== expectedRevision) {
      throw new Error("A narrativa mudou depois que este formulário foi aberto.");
    }
    return {
    ...draft,
    narrative,
    revision: (BigInt(draft.revision ?? "0") + BigInt(1)).toString(),
    updatedAt: now,
    history: [
      {
        id: randomUUID(),
        action: "Narrativa salva",
        detail: "Uma nova versão do texto foi registrada no ambiente demonstrativo.",
        actor: "Rodrigo (demonstração)",
        occurredAt: now,
      },
      ...draft.history,
    ],
    };
  });
}

export async function addDemoFinancialEntry(
  projectId: string,
  entry: Omit<ManualFinancialEntry, "id" | "createdAt">,
) {
  const now = new Date().toISOString();
  await updateDemoProject(projectId, (draft) => {
    if (entry.requestId && draft.manualFinancialEntries.some((item) => item.requestId === entry.requestId)) return draft;
    return {
      ...draft,
      revision: (BigInt(draft.revision ?? "0") + BigInt(1)).toString(),
      updatedAt: now,
      manualFinancialEntries: [
        ...draft.manualFinancialEntries,
        { ...entry, id: randomUUID(), createdAt: now },
      ],
      history: [
        {
          id: randomUUID(),
          action: "Valor registrado",
          detail: `${entry.kind}: ${entry.description}.`,
          actor: "Rodrigo (demonstração)",
          occurredAt: now,
        },
        ...draft.history,
      ],
    };
  });
}

function publicationContent(
  project: Project,
  draft: DemoProjectDraft,
  dataClassification: DemoPublication["dataClassification"] = "Dados fictícios",
  files?: PublishedFile[],
  snapshotV4 = false,
): Omit<DemoPublication, "id" | "version" | "priorPublicationId" | "createdAt" | "createdBy" | "contentHash" | "recordHash" | "review"> {
  if (draft.manualFinancialEntries.some(entry=>entry.proofVersionId && !files?.some(file=>file.versionId===entry.proofVersionId))) throw new Error("Comprovante vinculado ausente dos arquivos da publicação.");
  const imported: PublishedFinancialEntry[] = project.financialReferences.map((reference) => ({
    id: reference.id,
    sourceType: "Referência importada",
    financialGroup:
      reference.kind === "NFS-e"
        ? "invoice_or_charge"
        : reference.kind === "Informação de Rodrigo"
          ? "reported_value"
          : "financial_reference",
    kind: reference.kind,
    label: reference.label,
    amount: reference.amount,
    amountCents: parseBrlToCents(reference.amount),
    relatedAmount: reference.relatedAmount ?? null,
    relatedAmountCents: reference.relatedAmount ? parseBrlToCents(reference.relatedAmount) : null,
    fullValueEligible: reference.fullValueEligible ?? null,
    relationBasis: reference.relationBasis ?? "Não informada",
    currency: "BRL",
    origin: dataClassification === "Dados privados locais" ? "Base local importada" : "Base demonstrativa importada",
    relation: reference.relation,
    payment: reference.payment,
    documentState: "Não avaliado",
    recordedAt: null,
    ...(snapshotV4 ? { provenance: {
      sourceAmount: reference.sourceAmount ?? reference.amount,
      sourceDeclaredProjectId: reference.sourceDeclaredProjectId ?? null,
      sourceCandidateProjectId: reference.sourceCandidateProjectId ?? null,
      revision: reference.adjustmentRevision ?? "0",
      operation: reference.adjustmentOperation ?? null,
      reason: reference.adjustmentReason ?? null,
      actor: reference.adjustedBy ?? null,
      adjustedAt: reference.adjustedAt ?? null,
    } } : {}),
  }));
  const manual: PublishedFinancialEntry[] = draft.manualFinancialEntries.map((entry) => ({
    id: entry.id,
    sourceType: "Cadastro manual",
    financialGroup:
      entry.kind === "Reembolso"
        ? "reimbursement"
        : entry.kind === "Pagamento"
        ? "payment"
        : entry.kind === "Nota ou cobrança"
          ? "invoice_or_charge"
          : entry.kind === "Valor informado"
            ? "reported_value"
            : "project_measurement",
    kind: entry.kind,
    label: entry.description,
    amount: formatBrlFromCents(entry.amountCents),
    amountCents: entry.amountCents,
    relatedAmount: null,
    relatedAmountCents: null,
    fullValueEligible: null,
    relationBasis: "Cadastro manual",
    currency: "BRL",
    origin: entry.origin,
    relation: "Sem relação confirmada",
    payment: entry.confirmation ? costConfirmationLabel(entry.kind,entry.confirmation) : entry.reimbursement ? reimbursementLabel(entry.reimbursement) : entry.kind === "Pagamento" ? "Informado" : "Não informado",
    ...(entry.confirmation ? {confirmation:structuredClone(entry.confirmation)} : {}),
    ...(entry.reimbursement ? {reimbursement:structuredClone(entry.reimbursement)} : {}),
    documentState: entry.documentState,
    ...(entry.proofVersionId ? {proofVersionId:entry.proofVersionId} : {}),
    recordedAt: entry.createdAt,
  }));
  return {
    ...(draft.contract ? {contract:structuredClone(draft.contract)} : {}),
    ...(draft.cash ? {cash:structuredClone(draft.cash)} : {}),
    projectId: project.id,
    dataClassification,
    schemaVersion: snapshotV4 ? "tria-publication-v4" : files ? "tria-publication-v3" : "tria-publication-v2",
    rendererVersion: snapshotV4 ? "tria-export-v4" : files ? "tria-export-v3" : "tria-export-v2",
    cutoff: {
      startDate: project.periodStart,
      endDate: project.periodEnd,
      endInclusive: true,
      timeZone: "America/Sao_Paulo",
      basis: dataClassification === "Dados privados locais" ? "Período registrado do projeto" : "Período demonstrativo do projeto",
    },
    title: project.name,
    period: project.period,
    narrative: draft.narrative,
    activities: structuredClone(project.activities),
    financialEntries: [...imported, ...manual],
    evidence: structuredClone(project.evidence),
    ...(files || snapshotV4 ? { files: structuredClone(files ?? []) } : {}),
  };
}

type PublicationContent = ReturnType<typeof publicationContent>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function computePublicationContentHash(content: PublicationContent) {
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

function computeLegacyPublicationContentHash(content: PublicationContent) {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function storedPublicationContent(publication: DemoPublication): PublicationContent {
  return {
    ...(publication.contract ? {contract:publication.contract} : {}),
    ...(publication.cash ? {cash:publication.cash} : {}),
    projectId: publication.projectId,
    dataClassification: publication.dataClassification,
    schemaVersion: publication.schemaVersion,
    rendererVersion: publication.rendererVersion,
    cutoff: publication.cutoff,
    title: publication.title,
    period: publication.period,
    narrative: publication.narrative,
    activities: publication.activities,
    financialEntries: publication.financialEntries,
    evidence: publication.evidence,
    ...(publication.schemaVersion === "tria-publication-v3" || publication.schemaVersion === "tria-publication-v4" ? { files: publication.files ?? [] } : {}),
  };
}

export function buildDemoCompositionHash(
  project: Project,
  draft: DemoProjectDraft,
  dataClassification: DemoPublication["dataClassification"] = "Dados fictícios",
  files?: PublishedFile[],
) {
  return computePublicationContentHash(publicationContent(project, draft, dataClassification, files));
}

export function verifyDemoPublicationIntegrity(publication: DemoPublication) {
  const content = storedPublicationContent(publication);
  const actual = computePublicationContentHash(content);
  const legacyActual = computeLegacyPublicationContentHash(content);
  const { recordHash, ...record } = publication;
  const actualRecordHash = computePublicationRecordHash(record);
  const legacyRecordHash = computeLegacyPublicationRecordHash(record);
  const canonicalValid = actual === publication.contentHash && actualRecordHash === recordHash;
  const legacyValid = legacyActual === publication.contentHash && legacyRecordHash === recordHash;
  if (
    (!canonicalValid && !legacyValid) ||
    publication.review.compositionHash !== publication.contentHash ||
    publication.review.caveatsAcknowledged !== true ||
    publication.review.reviewedAt !== publication.createdAt ||
    !publication.review.requestId
  ) {
    throw new PublicationIntegrityError();
  }
  return publication;
}

export function assertDemoCompositionMatches(expected: string, actual: string) {
  if (expected !== actual) throw new Error("A composição mudou depois da conferência.");
}

export function assertDraftRevision(expected: string | undefined, actual: string) {
  if (expected !== undefined && expected !== actual) {
    throw new Error("A composição mudou depois da conferência.");
  }
}

export function buildPublicationSnapshot(
  project: Project,
  draft: DemoProjectDraft,
  version: number,
  priorPublicationId: string | null,
  createdAt: string,
  id: string = randomUUID(),
  dataClassification: DemoPublication["dataClassification"] = "Dados fictícios",
  createdBy = "Rodrigo (demonstração)",
  files?: PublishedFile[],
): DemoPublication {
  const content = publicationContent(project, draft, dataClassification, files);
  const contentHash = computePublicationContentHash(content);
  const record: Omit<DemoPublication, "recordHash"> = {
    id,
    version,
    priorPublicationId,
    createdAt,
    createdBy,
    contentHash,
    review: {
      compositionHash: contentHash,
      caveatsAcknowledged: true,
      reviewedAt: createdAt,
      requestId: randomUUID(),
    },
    ...content,
  };
  return { ...record, recordHash: computePublicationRecordHash(record) };
}

export function buildPublicationSnapshotV4(
  project: Project, draft: DemoProjectDraft, version: number, priorPublicationId: string | null,
  createdAt: string, id: string = randomUUID(), createdBy = "Rodrigo", files: PublishedFile[] = [],
): DemoPublication {
  const content = publicationContent(project, draft, "Dados privados locais", files, true);
  const contentHash = computePublicationContentHash(content);
  const record: Omit<DemoPublication, "recordHash"> = {
    id, version, priorPublicationId, createdAt, createdBy, contentHash,
    review: { compositionHash: contentHash, caveatsAcknowledged: true, reviewedAt: createdAt, requestId: randomUUID() },
    ...content,
  };
  return { ...record, recordHash: computePublicationRecordHash(record) };
}

export async function publishDemoProject(
  projectId: string,
  expectedCompositionHash?: string,
  caveatsAcknowledged = false,
  expectedRevision?: string,
): Promise<{ publication: DemoPublication; created: boolean }> {
  assertKnownProject(projectId);
  return updateWorkspace((state) => {
    const project = demoProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("Projeto demonstrativo desconhecido.");
    const draft = state.projects[projectId] ?? emptyDraft(projectId);
    assertDraftRevision(expectedRevision, draft.revision ?? "0");
    if (draft.narrative.trim().length < 20) {
      throw new Error("A narrativa precisa ter pelo menos 20 caracteres.");
    }
    if (!caveatsAcknowledged) {
      throw new Error("A conferência explícita é obrigatória.");
    }
    const prior = state.publications
      .filter((publication) => publication.projectId === projectId)
      .sort((left, right) => right.version - left.version)[0] ?? null;
    const candidate = buildPublicationSnapshot(
      project,
      draft,
      (prior?.version ?? 0) + 1,
      prior?.id ?? null,
      new Date().toISOString(),
    );
    if (expectedCompositionHash) {
      assertDemoCompositionMatches(expectedCompositionHash, candidate.contentHash);
    }
    if (prior?.contentHash === candidate.contentHash) {
      return { publication: prior, created: false };
    }
    state.publications.push(candidate);
    const event: HistoryEvent = {
      id: randomUUID(),
      action: `Publicação V${candidate.version} criada`,
      detail: "Uma cópia imutável do conteúdo demonstrativo foi registrada.",
      actor: "Rodrigo (demonstração)",
      occurredAt: candidate.createdAt,
    };
    state.projects[projectId] = {
      ...draft,
      updatedAt: candidate.createdAt,
      history: [event, ...draft.history],
    };
    return { publication: candidate, created: true };
  });
}

export async function readDemoPublication(publicationId: string) {
  const state = await readWorkspaceFile();
  const publication = state.publications.find((item) => item.id === publicationId);
  return publication ? verifyDemoPublicationIntegrity(publication) : undefined;
}

export async function listDemoProjectPublications(projectId: string) {
  assertKnownProject(projectId);
  const state = await readWorkspaceFile();
  return state.publications
    .filter((publication) => publication.projectId === projectId)
    .map(verifyDemoPublicationIntegrity)
    .sort((left, right) => right.version - left.version);
}

export function parseBrlToCents(input: string): string | null {
  const clean = input.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!clean || clean.startsWith("-") || !/^[0-9.,]+$/.test(clean)) return null;
  let integerPart: string;
  let decimalPart: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean)) {
    const [integer, decimal = ""] = clean.split(",");
    integerPart = integer.replace(/\./g, "");
    decimalPart = decimal.padEnd(2, "0") || "00";
  } else if (/^\d+(?:,\d{1,2})?$/.test(clean)) {
    const [integer, decimal = ""] = clean.split(",");
    integerPart = integer;
    decimalPart = decimal.padEnd(2, "0") || "00";
  } else if (/^\d+\.\d{1,2}$/.test(clean)) {
    const [integer, decimal] = clean.split(".");
    integerPart = integer;
    decimalPart = decimal.padEnd(2, "0");
  } else {
    return null;
  }
  const cents = (BigInt(integerPart) * BigInt(100) + BigInt(decimalPart)).toString();
  return cents.length <= 24 ? cents : null;
}

export function formatBrlFromCents(amountCents: string): string {
  const signed = BigInt(amountCents);
  const cents = signed < 0n ? -signed : signed;
  const integer = cents / BigInt(100);
  const decimal = (cents % BigInt(100)).toString().padStart(2, "0");
  const grouped = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${signed < 0n ? "−" : ""}R$ ${grouped},${decimal}`;
}
