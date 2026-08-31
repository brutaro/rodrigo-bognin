import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoProjects, type Project } from "./demo-data";

export const manualFinancialKinds = [
  "Custo ou valor do projeto",
  "Nota ou cobrança",
  "Pagamento",
  "Valor informado",
] as const;
export type ManualFinancialKind = (typeof manualFinancialKinds)[number];

export const financialOrigins = [
  "Informado por Rodrigo",
  "Cadastro demonstrativo",
] as const;
export type FinancialOrigin = (typeof financialOrigins)[number];

export type ManualFinancialEntry = {
  id: string;
  kind: ManualFinancialKind;
  description: string;
  amountCents: string;
  origin: FinancialOrigin;
  documentState: "Sem arquivo associado" | "Com arquivo associado";
  createdAt: string;
};

export type HistoryEvent = {
  id: string;
  action: string;
  detail: string;
  actor: "Rodrigo (demonstração)";
  occurredAt: string;
};

export type DemoProjectDraft = {
  narrative: string;
  manualFinancialEntries: ManualFinancialEntry[];
  history: HistoryEvent[];
  updatedAt: string | null;
};

export type FinancialGroup =
  | "project_measurement"
  | "invoice_or_charge"
  | "payment"
  | "reported_value"
  | "financial_reference";

export type PublishedFinancialEntry = {
  id: string;
  sourceType: "Referência importada" | "Cadastro manual";
  financialGroup: FinancialGroup;
  kind: string;
  label: string;
  amount: string;
  amountCents: string | null;
  currency: "BRL";
  origin: string;
  relation: string;
  payment: string;
  documentState: "Não avaliado" | "Sem arquivo associado" | "Com arquivo associado";
  recordedAt: string | null;
};

export type DemoPublication = {
  id: string;
  projectId: string;
  version: number;
  priorPublicationId: string | null;
  createdAt: string;
  createdBy: "Rodrigo (demonstração)";
  dataClassification: "Dados fictícios";
  schemaVersion: "tria-publication-v1";
  rendererVersion: "tria-export-v1";
  cutoff: {
    startDate: string;
    endDate: string;
    endInclusive: true;
    timeZone: "America/Sao_Paulo";
    basis: "Período demonstrativo do projeto";
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
          recordHash: computePublicationRecordHash(publication),
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

export async function saveDemoNarrative(projectId: string, narrative: string) {
  const now = new Date().toISOString();
  await updateDemoProject(projectId, (draft) => ({
    ...draft,
    narrative,
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
  }));
}

export async function addDemoFinancialEntry(
  projectId: string,
  entry: Omit<ManualFinancialEntry, "id" | "createdAt">,
) {
  const now = new Date().toISOString();
  await updateDemoProject(projectId, (draft) => ({
    ...draft,
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
  }));
}

function publicationContent(
  project: Project,
  draft: DemoProjectDraft,
): Omit<DemoPublication, "id" | "version" | "priorPublicationId" | "createdAt" | "createdBy" | "contentHash" | "recordHash" | "review"> {
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
    currency: "BRL",
    origin: "Base demonstrativa importada",
    relation: reference.relation,
    payment: reference.payment,
    documentState: "Não avaliado",
    recordedAt: null,
  }));
  const manual: PublishedFinancialEntry[] = draft.manualFinancialEntries.map((entry) => ({
    id: entry.id,
    sourceType: "Cadastro manual",
    financialGroup:
      entry.kind === "Pagamento"
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
    currency: "BRL",
    origin: entry.origin,
    relation: "Sem relação confirmada",
    payment: entry.kind === "Pagamento" ? "Informado" : "Não informado",
    documentState: entry.documentState,
    recordedAt: entry.createdAt,
  }));
  return {
    projectId: project.id,
    dataClassification: "Dados fictícios",
    schemaVersion: "tria-publication-v1",
    rendererVersion: "tria-export-v1",
    cutoff: {
      startDate: project.periodStart,
      endDate: project.periodEnd,
      endInclusive: true,
      timeZone: "America/Sao_Paulo",
      basis: "Período demonstrativo do projeto",
    },
    title: project.name,
    period: project.period,
    narrative: draft.narrative,
    activities: structuredClone(project.activities),
    financialEntries: [...imported, ...manual],
    evidence: structuredClone(project.evidence),
  };
}

type PublicationContent = ReturnType<typeof publicationContent>;

function computePublicationContentHash(content: PublicationContent) {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function storedPublicationContent(publication: DemoPublication): PublicationContent {
  return {
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
  };
}

export function buildDemoCompositionHash(project: Project, draft: DemoProjectDraft) {
  return computePublicationContentHash(publicationContent(project, draft));
}

export function verifyDemoPublicationIntegrity(publication: DemoPublication) {
  const actual = computePublicationContentHash(storedPublicationContent(publication));
  const { recordHash, ...record } = publication;
  const actualRecordHash = computePublicationRecordHash(record);
  if (
    actual !== publication.contentHash ||
    publication.review.compositionHash !== actual ||
    publication.review.caveatsAcknowledged !== true ||
    publication.review.reviewedAt !== publication.createdAt ||
    !publication.review.requestId ||
    actualRecordHash !== recordHash
  ) {
    throw new Error("A integridade da publicação demonstrativa falhou.");
  }
  return publication;
}

export function assertDemoCompositionMatches(expected: string, actual: string) {
  if (expected !== actual) throw new Error("A composição mudou depois da conferência.");
}

export function buildPublicationSnapshot(
  project: Project,
  draft: DemoProjectDraft,
  version: number,
  priorPublicationId: string | null,
  createdAt: string,
  id: string = randomUUID(),
): DemoPublication {
  const content = publicationContent(project, draft);
  const contentHash = computePublicationContentHash(content);
  const record: Omit<DemoPublication, "recordHash"> = {
    id,
    version,
    priorPublicationId,
    createdAt,
    createdBy: "Rodrigo (demonstração)",
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

export async function publishDemoProject(
  projectId: string,
  expectedCompositionHash?: string,
  caveatsAcknowledged = false,
): Promise<{ publication: DemoPublication; created: boolean }> {
  assertKnownProject(projectId);
  return updateWorkspace((state) => {
    const project = demoProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("Projeto demonstrativo desconhecido.");
    const draft = state.projects[projectId] ?? emptyDraft(projectId);
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
  if (clean.includes(",")) {
    const parts = clean.split(",");
    if (parts.length !== 2 || parts[1].length > 2) return null;
    integerPart = parts[0].replace(/\./g, "");
    decimalPart = parts[1].padEnd(2, "0");
  } else if (/\.\d{1,2}$/.test(clean)) {
    const lastDot = clean.lastIndexOf(".");
    integerPart = clean.slice(0, lastDot).replace(/\./g, "");
    decimalPart = clean.slice(lastDot + 1).padEnd(2, "0");
  } else {
    integerPart = clean.replace(/\./g, "");
    decimalPart = "00";
  }
  if (!/^\d+$/.test(integerPart) || !/^\d{2}$/.test(decimalPart)) return null;
  return (BigInt(integerPart || "0") * BigInt(100) + BigInt(decimalPart)).toString();
}

export function formatBrlFromCents(amountCents: string): string {
  const cents = BigInt(amountCents);
  const integer = cents / BigInt(100);
  const decimal = (cents % BigInt(100)).toString().padStart(2, "0");
  const grouped = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${decimal}`;
}
