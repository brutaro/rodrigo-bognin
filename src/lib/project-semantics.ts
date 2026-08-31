export type RelationLabel = "Forte" | "Média" | "Fraca" | "Sem relação confirmada";

export function relationLabel(strength: string | null, auditedForProject: boolean): RelationLabel {
  if (!auditedForProject) return "Sem relação confirmada";
  const normalized = (strength ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalized === "FORTE") return "Forte";
  if (normalized === "MEDIO") return "Média";
  if (normalized === "FRACO") return "Fraca";
  return "Sem relação confirmada";
}

export function evidenceAvailability(status: string): "Disponível" | "Pendente" {
  return /(?:confirm|^ok$|dispon)/i.test(status) ? "Disponível" : "Pendente";
}
