import { describe, expect, it } from "vitest";
import { evidenceAvailability, relationLabel } from "./project-semantics";

describe("semântica importada", () => {
  it.each([["FORTE", "Forte"], ["MÉDIO", "Média"], ["FRACO", "Fraca"], ["NENHUM", "Sem relação confirmada"]])("mapeia %s", (source, expected) => {
    expect(relationLabel(source, true)).toBe(expected);
  });
  it("não transfere classificação para projeto apenas declarado", () => {
    expect(relationLabel("FORTE", false)).toBe("Sem relação confirmada");
  });
  it.each([["ok", "Disponível"], ["confirmado", "Disponível"], ["pendente", "Pendente"]])("mapeia evidência %s", (source, expected) => {
    expect(evidenceAvailability(source)).toBe(expected);
  });
});
