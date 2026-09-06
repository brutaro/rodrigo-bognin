import { calculateCash } from "./cash-domain";
import { toPublicPublicationV4, buildPublicationCsvV4, buildPublicationHtmlV4 } from "./demo-publication-export-v4";
import { describe, expect, it } from "vitest";
import { getDemoProject } from "./demo-data";
import {
  assertDemoCompositionMatches,
  assertDraftRevision,
  buildDemoCompositionHash,
  buildPublicationSnapshot,
  buildPublicationSnapshotV4,
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

  it.each(["", "-1,00", "abc", "1,234", "1,2,3", "1.2.3", "12345678901234567890123,00"])("rejeita %s", (input) => {
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

  it("congela caixa e conferência nas exportações e rejeita alteração do resultado publicado", () => {
    const source=draft();source.manualFinancialEntries=[];
    source.cash=calculateCash([],{revision:"1",basisHash:"basis",cutoffDate:"2026-09-05",costs:"sem_movimento",payments:"sem_movimento",reimbursements:"sem_movimento",reason:"Sem movimentos declarado",actor:"Rodrigo",createdAt:"2026-09-05T12:00:00Z"},"basis");
    const snapshot=buildPublicationSnapshotV4(project,source,1,null,"2026-09-05T12:00:00Z");
    expect(snapshot.cash?.resultCents).toBe("0");
    expect(buildPublicationCsvV4(snapshot)).toContain("Equilíbrio de caixa");
    expect(buildPublicationHtmlV4(snapshot)).toContain("Cobertura do valor pago");
    source.cash.resultCents="999";expect(snapshot.cash?.resultCents).toBe("0");
    expect(verifyDemoPublicationIntegrity(snapshot)).toBeTruthy();
    snapshot.cash!.resultCents="999";expect(()=>verifyDemoPublicationIntegrity(snapshot)).toThrow(/integridade/);
  });

  it("congela a situação explícita do reembolso e distingue pendente de recebido", () => {
    const source=draft();const entry=source.manualFinancialEntries[0];entry.kind="Reembolso";
    const publish=()=>buildPublicationSnapshotV4(project,source,1,null,"2026-09-05T12:00:00Z");
    const unknown=publish();expect(unknown.financialEntries.at(-1)?.payment).toBe("Não informado");
    entry.reimbursement={status:"sinalizado_pendente",receivedOn:null,revision:"1"};
    const pending=publish();expect(pending.financialEntries.at(-1)?.payment).toBe("Aprovado · a receber");
    entry.reimbursement={status:"recebido_confirmado",receivedOn:"2026-09-05",revision:"2"};
    const received=publish();expect(received.contentHash).not.toBe(pending.contentHash);
    expect(buildPublicationCsvV4(received)).toContain("Recebido confirmado · 05/09/2026");
    expect(buildPublicationHtmlV4(received)).toContain("Recebido confirmado · 05/09/2026");
    expect(pending.financialEntries.at(-1)?.reimbursement?.status).toBe("sinalizado_pendente");
    expect(verifyDemoPublicationIntegrity(pending)).toBeTruthy();
  });

  it("congela comprovante com referência pública e recusa arquivo ausente", () => {
    const source=draft();source.manualFinancialEntries[0].proofVersionId="file-version";
    source.manualFinancialEntries[0].documentState="Com arquivo associado";
    const files=[{documentId:"document",versionId:"file-version",title:"Comprovante",version:1,originalName:"comprovante.pdf",mediaType:"application/pdf",sizeBytes:10,sha256:"a".repeat(64)}];
    const snapshot=buildPublicationSnapshotV4(project,source,1,null,"2026-09-05T12:00:00Z","publication","Rodrigo",files);
    expect(toPublicPublicationV4(snapshot).financialEntries.at(-1)?.documentState).toContain("ARQ-001");
    expect(buildPublicationCsvV4(snapshot)).toContain("ARQ-001");
    expect(buildPublicationHtmlV4(snapshot)).toContain("Com arquivo associado · ARQ-001");
    delete source.manualFinancialEntries[0].proofVersionId;
    expect(snapshot.financialEntries.at(-1)?.proofVersionId).toBe("file-version");
    source.manualFinancialEntries[0].proofVersionId="missing";
    expect(()=>buildPublicationSnapshotV4(project,source,1,null,"2026-09-05T12:00:00Z","publication","Rodrigo",files)).toThrow(/Comprovante/);
  });

  it("mantém reembolso em grupo próprio na publicação", () => {
    const source = draft();
    source.manualFinancialEntries[0].kind = "Reembolso";
    const snapshot = buildPublicationSnapshot(project, source, 1, null, "2026-09-05T12:00:00Z", "test-reimbursement");
    expect(snapshot.financialEntries.at(-1)?.financialGroup).toBe("reimbursement");
    expect(snapshot.financialEntries.at(-1)?.kind).toBe("Reembolso");
  });

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

  it("mantém a integridade quando JSONB reordena as chaves", () => {
    const snapshot = buildPublicationSnapshot(project, draft(), 1, null, "2026-08-31T12:30:00.000Z");
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
      }
      return value;
    };
    const persisted = reorder(snapshot) as typeof snapshot;
    expect(verifyDemoPublicationIntegrity(persisted)).toBe(persisted);
  });

  it("mantém o hash para a mesma composição e muda após edição", () => {
    const first = draft();
    const same = structuredClone(first);
    const changed = draft("Outra narrativa demonstrativa com contexto suficiente para publicação.");
    expect(buildDemoCompositionHash(project, first)).toBe(buildDemoCompositionHash(project, same));
    expect(buildDemoCompositionHash(project, first)).not.toBe(buildDemoCompositionHash(project, changed));
  });

  it("recusa revisão obsoleta mesmo quando o conteúdo volta ao hash anterior", () => {
    expect(() => assertDraftRevision("4", "6")).toThrow(/composição mudou/);
    expect(() => assertDraftRevision("6", "6")).not.toThrow();
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
  it("publica V4 com valores efetivos e proveniência sem alterar o ramo legado", () => {
    const effectiveProject = structuredClone(project);
    effectiveProject.activities[0] = { ...effectiveProject.activities[0], hours: "30:15", measuredValue: "-R$ 12,50",
      sourceHours: "12:30", sourceMeasuredValue: "R$ 1.125,00", adjustmentRevision: "2",
      adjusted: true, adjustmentReason: "Correção comprovada", adjustedBy: "Rodrigo", adjustedAt: "2026-09-01T10:00:00.000Z" };
    effectiveProject.financialReferences[0] = { ...effectiveProject.financialReferences[0], amount: "R$ 1.600,00",
      sourceAmount: "R$ 1.500,00", adjustmentRevision: "1", adjusted: true,
      adjustmentReason: "Valor fiscal corrigido", adjustedBy: "Rodrigo", adjustedAt: "2026-09-01T10:10:00.000Z" };
    const v4 = buildPublicationSnapshotV4(effectiveProject, draft(), 4, null, "2026-09-01T11:00:00.000Z");
    const legacy = buildPublicationSnapshot(project, draft(), 3, null, "2026-09-01T11:00:00.000Z");
    expect(v4.schemaVersion).toBe("tria-publication-v4");
    expect(v4.rendererVersion).toBe("tria-export-v4");
    expect(v4.activities[0]).toMatchObject({ hours: "30:15", sourceHours: "12:30", adjustmentRevision: "2" });
    expect(v4.financialEntries[0].provenance).toMatchObject({ sourceAmount: "R$ 1.500,00", revision: "1", actor: "Rodrigo" });
    expect(verifyDemoPublicationIntegrity(v4)).toBe(v4);
    expect(legacy.schemaVersion).toBe("tria-publication-v2");
  });

});
