import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoProjects } from "./demo-data";

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

type WorkspaceFile = {
  version: 1;
  projects: Record<string, DemoProjectDraft>;
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

async function readWorkspaceFile(): Promise<WorkspaceFile> {
  try {
    const raw = await readFile(workspaceFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("projects" in parsed) || !parsed.projects || typeof parsed.projects !== "object") {
      throw new Error("Arquivo de trabalho incompatível.");
    }
    return parsed as WorkspaceFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, projects: {} };
    throw error;
  }
}

async function writeWorkspaceFile(state: WorkspaceFile) {
  await mkdir(workspaceDirectory, { recursive: true });
  const temporary = `${workspaceFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, workspaceFile);
}

export async function readDemoProjectDraft(projectId: string): Promise<DemoProjectDraft> {
  assertKnownProject(projectId);
  const state = await readWorkspaceFile();
  return state.projects[projectId] ?? emptyDraft(projectId);
}

async function updateDemoProject(projectId: string, update: (draft: DemoProjectDraft) => DemoProjectDraft) {
  assertKnownProject(projectId);
  let resolveResult: (() => void) | undefined;
  let rejectResult: ((error: unknown) => void) | undefined;
  const result = new Promise<void>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  writeQueue = writeQueue
    .then(async () => {
      const state = await readWorkspaceFile();
      const current = state.projects[projectId] ?? emptyDraft(projectId);
      state.projects[projectId] = update(current);
      await writeWorkspaceFile(state);
      resolveResult?.();
    })
    .catch((error) => {
      rejectResult?.(error);
    });

  return result;
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

export async function addDemoFinancialEntry(projectId: string, entry: Omit<ManualFinancialEntry, "id" | "createdAt">) {
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
