export const resourceFields = [
  { key: "id", label: "ID do lançamento", aliases: ["id", "codigo"] },
  { key: "project", label: "Projeto", aliases: ["projeto"] },
  { key: "date", label: "Data", aliases: ["data"] },
  { key: "activity", label: "Atividade", aliases: ["atividade", "descricao"] },
  { key: "amount", label: "Valor (R$)", aliases: ["valor (r$)", "valor", "medicao"] },
  { key: "hours", label: "Horas (opcional)", aliases: ["horas", "duracao"] },
  { key: "bm", label: "Boletim (opcional)", aliases: ["boletim", "bm"] },
  { key: "executor", label: "Executor (opcional)", aliases: ["executor", "executores"] },
  { key: "nature", label: "Natureza (opcional)", aliases: ["natureza"] },
] as const;
export type ResourceRow = { id: string; project: string; date: string; activity: string; amount: string; hours: string; bm?: string; executor?: string; nature: string };
export type ResourceMapping = Record<string, number>;
export function normalizeHeader(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase(); }
export function suggestResourceMapping(headers: string[]): ResourceMapping {
  return Object.fromEntries(resourceFields.map(field => [field.key, headers.findIndex(header => (field.aliases as readonly string[]).includes(normalizeHeader(header)))]));
}
export function decimal(value: string): string {
  let text = value.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d{1,14}(\.\d{1,16})?$/.test(text)) throw new Error("valor numérico inválido");
  return text;
}
export function cents(value: string) {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(integer) * 100n + BigInt((fraction + "00").slice(0, 2)) + (Number(fraction[2] ?? 0) >= 5 ? 1n : 0n)) * (negative ? -1n : 1n);
}
export function validateResourceRows(rows: string[][], mapping: ResourceMapping, width: number, locators?:string[], scope?: { title: string; aliases: string[] }) {
  const errors: string[] = [], valid: ResourceRow[] = [], ids = new Set<string>();
  const chosen = Object.values(mapping).filter(n => n >= 0);
  if (new Set(chosen).size !== chosen.length || chosen.some(n => !Number.isInteger(n) || n >= width)) throw new Error("Cada campo precisa de uma coluna diferente e válida.");
  for (const key of (scope ? ["id", "date", "activity", "amount"] : ["id", "project", "date", "activity", "amount"])) if (!(mapping[key] >= 0)) throw new Error("Mapeie ID, Projeto, Data, Atividade e Valor.");
  rows.forEach((row, index) => {
    if (row.every(cell => !cell.trim())) return;
    try {
      const rawProject = (row[mapping.project] ?? "").trim();
      if (scope && rawProject && !scope.aliases.includes(rawProject)) throw new Error("projeto diferente do projeto selecionado");
      const value = (key: string) => key === "project" && scope ? scope.title : (row[mapping[key]] ?? "").trim();
      for (const key of ["id", "project", "amount"]) if (!value(key)) throw new Error(`campo ${key} vazio`);
      if (Object.keys(mapping).some(key => value(key).startsWith("="))) throw new Error("fórmula: salve os valores calculados antes de importar");
      const id = value("id");
      if (ids.has(id)) throw new Error(`ID ${id} repetido`);
      ids.add(id);
      let date = value("date");
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) date = date.split("/").reverse().join("-");
      if (/^\d{5}$/.test(date)) date = new Date(Date.UTC(1899, 11, 30) + Number(date) * 86400000).toISOString().slice(0, 10);
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error("data inválida");
      const result = { id, project: value("project"), date, activity: value("activity"), amount: decimal(value("amount")), hours: value("hours") ? decimal(value("hours")) : "", nature: value("nature"), bm: value("bm"), executor: value("executor") };
      if (id.length > 120 || result.project.length > 300 || result.activity.length > 10000 || result.executor.length > 300) throw new Error("texto muito longo");
      valid.push(result);
    } catch (error) { errors.push(`Linha ${locators?.[index]?.replace(/^row:/, "") ?? index + 2}: ${error instanceof Error ? error.message : "inválida"}.`); }
  });
  if (!valid.length && !errors.length) errors.push("A aba não contém lançamentos.");
  return { rows: valid, errors };
}
export function compareResources(current: ResourceRow[], next: ResourceRow[]) {
  const old = new Map(current.map(row => [row.id, row]));
  let added = 0, changed = 0, unchanged = 0;
  for (const row of next) { const prior = old.get(row.id); if (!prior) added++; else if (resourceFields.every(field => (prior[field.key] ?? "") === (row[field.key] ?? ""))) unchanged++; else changed++; old.delete(row.id); }
  return { added, changed, unchanged, absent: old.size };
}
// Soma na precisão da fonte; arredonda somente o resultado final para exibição.
export function resourceTotalCents(rows: ResourceRow[]) {
  const scale = 10n ** 16n;
  const total = rows.reduce((sum, row) => {
    const negative = row.amount.startsWith("-");
    const [integer, fraction = ""] = row.amount.replace(/^-/, "").split(".");
    return sum + (BigInt(integer) * scale + BigInt(fraction.padEnd(16, "0"))) * (negative ? -1n : 1n);
  }, 0n);
  const absolute = total < 0n ? -total : total;
  return ((absolute + 5n * 10n ** 13n) / (10n ** 14n)) * (total < 0n ? -1n : 1n);
}

export type ResourceDifference = { id: string; before: ResourceRow; after: ResourceRow | null };
export type ResourceDecisions = Record<string, "keep" | "incoming">;
export function resourceDifferences(current: ResourceRow[], next: ResourceRow[]): ResourceDifference[] {
  const incoming = new Map(next.map(row => [row.id, row]));
  return current.flatMap(before => {
    const after = incoming.get(before.id) ?? null;
    return !after || resourceFields.some(field => (before[field.key] ?? "") !== (after[field.key] ?? "")) ? [{ id: before.id, before, after }] : [];
  });
}
export function resolveResourceRows(current: ResourceRow[], next: ResourceRow[], decisions: ResourceDecisions) {
  const differences = resourceDifferences(current, next);
  const ids = new Set(differences.map(row => row.id));
  if (Object.keys(decisions).some(id => !ids.has(id)) || differences.some(row => !["keep", "incoming"].includes(decisions[row.id]))) throw new Error("Escolha uma decisão para cada registro alterado ou ausente.");
  const prior = new Map(current.map(row => [row.id, row]));
  return [...next.map(row => decisions[row.id] === "keep" ? prior.get(row.id)! : row), ...differences.filter(row => !row.after && decisions[row.id] === "keep").map(row => row.before)];
}

// IDs da base são globais. Um envio por projeto não pode reassociar outro projeto.
export function mergeProjectResources(current: ResourceRow[], incoming: ResourceRow[], projectTitle: string) {
  const others = current.filter(row => row.project !== projectTitle);
  const ids = new Set(others.map(row => row.id));
  if (incoming.some(row => row.project !== projectTitle)) throw new Error("A prévia contém outro projeto.");
  const collision = incoming.find(row => ids.has(row.id));
  if (collision) throw new Error(`ID ${collision.id} já pertence a outro projeto. Use um ID diferente.`);
  return [...others, ...incoming];
}

// Ausência de nomes não apaga a associação anterior; mover um ID não copia pessoas entre projetos.
export function preserveResourceExecutors(current: ResourceRow[], next: ResourceRow[]) {
  const prior = new Map(current.map(row => [row.id, row]));
  return next.map(row => {
    const before = prior.get(row.id);
    return !row.executor?.trim() && before?.project === row.project && before.executor?.trim()
      ? { ...row, executor: before.executor } : row;
  });
}
export function projectExecutors(rows: ResourceRow[], project: string) {
  const names = new Map<string, string>();
  for (const row of rows) if (row.project === project && row.executor?.trim()) {
    const name = row.executor.trim().replace(/\s+/g, " ");
    if (name === "-") continue;
    const key = name.normalize("NFC").toLocaleLowerCase("pt-BR");
    if (!names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a,b) => a.localeCompare(b, "pt-BR"));
}
