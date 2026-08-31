import { describe, expect, it } from "vitest";
import { getDemoProject } from "./demo-data";
import {
  assertDemoCompositionMatches,
  buildDemoCompositionHash,
  buildPublicationSnapshot,
  formatBrlFromCents,
  parseBrlToCents,
  verifyDemoPublicationIntegrity,
  type DemoProjectDraft,
} from "./demo-workspace";

function draft(narrative = "Organizei o conteúdo demonstrativo com origem e contexto suficientes."): DemoProjectDraft {
  return {
    narrative,
    manualFinancialEntries: [
      {
        id: "manual-internal-secret-id",
        kind: "Pagamento",
        description: "Pagamento demonstrativo",
        amountCents: "34500",
        origin: "Informado por Rodrigo",
        documentState: "Sem arquivo associado",
        createdAt: "2026-08-31T12:00:00.000Z",
      },
    ],
    history: [],
    updatedAt: "2026-08-31T12:00:00.000Z",
  };
}

describe("parseBrlToCents", () => {
  it.each([
    ["0", "0"],
    ["0,00", "0"],
    ["345,00", "34500"],
    ["1.234,56", "123456"],
    ["R$ 15.748,00", "1574800"],
    ["99.5", "9950"],
  ])("converte %s sem usar ponto flutuante", (input, expected) => {
    expect(parseBrlToCents(input)).toBe(expected);
  });

  it.each(["", "-1,00", "abc", "1,234", "1,2,3"])("rejeita %s", (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });
});

describe("formatBrlFromCents", () => {
  it.each([
    ["0", "R$ 0,00"],
    ["34500", "R$ 345,00"],
    ["123456", "R$ 1.234,56"],
    ["1574800", "R$ 15.748,00"],
  ])("formata %s como %s", (input, expected) => {
    expect(formatBrlFromCents(input)).toBe(expected);
  });
});

describe("snapshot de publicação", () => {
  const project = getDemoProject("demonstracao-continuidade");
  if (!project) throw new Error("Fixture ausente.");

  it("congela conteúdo, corte e grupos financeiros", () => {
    const source = draft();
    const snapshot = buildPublicationSnapshot(
      project,
      source,
      1,
      null,
      "2026-08-31T12:30:00.000Z",
      "publication-internal-id",
    );
    source.narrative = "Texto alterado depois da publicação";
    source.manualFinancialEntries[0].description = "Descrição alterada";

    expect(snapshot.narrative).not.toContain("alterado");
    expect(snapshot.financialEntries.at(-1)?.label).toBe("Pagamento demonstrativo");
    expect(snapshot.financialEntries.at(-1)?.financialGroup).toBe("payment");
    expect(snapshot.financialEntries[0].financialGroup).toBe("invoice_or_charge");
    expect(snapshot.cutoff).toEqual({
      startDate: "2024-06-01",
      endDate: "2025-11-30",
      endInclusive: true,
      timeZone: "America/Sao_Paulo",
      basis: "Período demonstrativo do projeto",
    });
  });

  it("detecta adulteração do conteúdo congelado", () => {
    const snapshot = buildPublicationSnapshot(project, draft(), 1, null, "2026-08-31T12:30:00.000Z");
    expect(verifyDemoPublicationIntegrity(snapshot)).toBe(snapshot);
    const tampered = structuredClone(snapshot);
    tampered.narrative = "Conteúdo adulterado";
    expect(() => verifyDemoPublicationIntegrity(tampered)).toThrow(/integridade/);
    const metadataTampered = structuredClone(snapshot);
    metadataTampered.version = 99;
    expect(() => verifyDemoPublicationIntegrity(metadataTampered)).toThrow(/integridade/);
  });

  it("mantém o hash para a mesma composição e muda após edição", () => {
    const first = draft();
    const same = structuredClone(first);
    const changed = draft("Outra narrativa demonstrativa com contexto suficiente para publicação.");
    expect(buildDemoCompositionHash(project, first)).toBe(buildDemoCompositionHash(project, same));
    expect(buildDemoCompositionHash(project, first)).not.toBe(buildDemoCompositionHash(project, changed));
  });

  it("recusa um token de conferência obsoleto", () => {
    const reviewed = buildDemoCompositionHash(project, draft());
    const current = buildDemoCompositionHash(
      project,
      draft("O rascunho mudou depois da conferência e precisa ser revisto."),
    );
    expect(() => assertDemoCompositionMatches(reviewed, current)).toThrow(/mudou depois da conferência/);
    expect(() => assertDemoCompositionMatches(current, current)).not.toThrow();
  });
});
