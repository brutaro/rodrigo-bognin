import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDemoProject } from "./demo-data";
import {
  buildPublicationCsv,
  buildPublicationHtml,
  safeCsvCell,
  sanitizePublicText,
  toPublicPublication,
} from "./demo-publication-export";
import { buildPublicationSnapshot, buildPublicationSnapshotV4, type DemoProjectDraft } from "./demo-workspace";

const project = getDemoProject("demonstracao-continuidade")!;

function publicationWith(narrative: string, files?: Parameters<typeof buildPublicationSnapshot>[8]) {
  const draft: DemoProjectDraft = {
    narrative,
    manualFinancialEntries: [
      {
        id: "manual-internal-secret-id",
        kind: "Pagamento",
        description: "=HIPERLINK(\"https://example.invalid\")",
        amountCents: "34500",
        origin: "Informado por Rodrigo",
        documentState: "Sem arquivo associado",
        createdAt: "2026-08-31T12:00:00.000Z",
      },
    ],
    history: [],
    updatedAt: "2026-08-31T12:00:00.000Z",
  };
  return buildPublicationSnapshot(
    project,
    draft,
    1,
    null,
    "2026-08-31T12:30:00.000Z",
    "publication-internal-secret-id",
    "Dados fictícios",
    "Rodrigo (demonstração)",
    files,
  );
}

describe("proteção CSV", () => {
  it.each([
    "=1+1",
    "+cmd",
    "-2+3",
    "@SUM(A1:A2)",
    "  \t=HYPERLINK(\"x\")",
    "\uFEFF@formula",
    "\u00A0+formula",
  ])("neutraliza fórmula com prefixos invisíveis: %s", (value) => {
    expect(safeCsvCell(value).startsWith("\"'")).toBe(true);
  });

  it("escapa aspas e remove quebras de linha do campo", () => {
    expect(safeCsvCell('linha 1\nlinha "2"')).toBe('"linha 1 linha ""2"""');
  });
});

describe("DTO público e exportações", () => {
  const localPathCanary = `/${"Users"}/segredo/documento.pdf`;
  const publication = publicationWith(`<script>alert("x")</script> ${localPathCanary}`);
  const view = toPublicPublication(publication);
  const html = buildPublicationHtml(publication);
  const csv = buildPublicationCsv(publication);

  it("usa códigos públicos e omite identificadores internos", () => {
    expect(view.publicationCode).toMatch(/^TRIA-V1-[A-F0-9]{12}$/);
    expect(html).not.toContain("publication-internal-secret-id");
    expect(html).not.toContain("manual-internal-secret-id");
    expect(csv).not.toContain("publication-internal-secret-id");
    expect(csv).not.toContain("manual-internal-secret-id");
  });

  it("escapa HTML ativo e elimina caminhos locais", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).not.toContain(localPathCanary);
    expect(html).toContain("[caminho local omitido]");
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).not.toMatch(/(?:href|src)=["']https?:\/\//i);
  });

  it("gera CSV com BOM, CRLF, grupo explícito e fórmula neutralizada", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"group_code"');
    expect(csv).toContain('"payment"');
    expect(csv).toContain('"\'=HIPERLINK(""https://example.invalid"")');
    expect(csv).not.toContain(localPathCanary);
  });

  it("é determinístico para o mesmo snapshot", () => {
    expect(buildPublicationHtml(publication)).toBe(html);
    expect(buildPublicationCsv(publication)).toBe(csv);
  });
});


describe("renderizadores versionados", () => {
  it("preserva os bytes do renderizador v1", () => {
    const snapshot = publicationWith("Golden renderer fixture with enough stable content.");
    snapshot.schemaVersion = "tria-publication-v1";
    snapshot.rendererVersion = "tria-export-v1";
    expect(createHash("sha256").update(buildPublicationHtml(snapshot)).digest("hex")).toBe("897a09064d854b48074f43a2aae638b9e00d88791ae6d3cd1bb77660a9f5451f");
    expect(createHash("sha256").update(buildPublicationCsv(snapshot)).digest("hex")).toBe("bd8027ba835abbdfb13724aa7f6337105b3d1e4524e984df27d0b5e6526ce222");
  });

  it("preserva os bytes do renderizador v2 enquanto a versão não muda", () => {
    const snapshot = structuredClone(publicationWith(`<script>alert("x")</script> /Users/segredo/documento.pdf`));
    snapshot.rendererVersion = "tria-export-v2";
    expect(createHash("sha256").update(buildPublicationHtml(snapshot)).digest("hex")).toBe("3363ea08d4020b495b3834ab139def4249074d68d33b962c96e61cb6b84d0615");
    expect(createHash("sha256").update(buildPublicationCsv(snapshot)).digest("hex")).toBe("eaa2786cdfde1d5f45b9bb160c6a5598ced3c4f4420667d34c31f7cb87ab1a6a");
  });

  it.each([
    "/Users/alice/Secret Folder/file.pdf",
    "/home/rodrigo/private report.pdf",
    "C:\\Users\\alice\\Secret Folder\\file.pdf",
    "file:///tmp/private file.txt",
    "/var/folders/ab/private cache.bin",
    "/opt/work/private config.yaml",
    "D:\\work\\Secret Folder\\file.pdf",
  ])("omite caminhos locais completos: %s", (value) => {
    const sanitized = sanitizePublicText(`Antes ${value} depois`);
    expect(sanitized).toBe("Antes [caminho local omitido] depois");
  });
});


describe("renderizador v3", () => {
  it("preserva literais que coincidem com nomes das versões v2", () => {
    const literal = "texto tria-publication-v2 e tria-export-v2 preservado";
    const publication = publicationWith(literal, [{
      documentId: "10000000-0000-4000-8000-000000000001",
      versionId: "10000000-0000-4000-8000-000000000002",
      title: "Comprovante",
      version: 1,
      originalName: "comprovante.bin",
      mediaType: "application/octet-stream",
      sizeBytes: 3,
      sha256: "a".repeat(64),
    }]);
    expect(buildPublicationHtml(publication)).toContain(literal);
    expect(buildPublicationCsv(publication)).toContain(literal);
    expect(buildPublicationHtml(publication)).toContain("tria-export-v3");
  });
});

describe("exportação V4", () => {
  it("expõe efetivo e proveniência sem misturar universos financeiros", () => {
    const effective = structuredClone(project);
    effective.financialReferences[0] = { ...effective.financialReferences[0], label: "​=1+1" };
    effective.activities[0] = { ...effective.activities[0], hours: "30:15", measuredValue: "-R$ 12,50",
      sourceHours: "12:30", sourceMeasuredValue: "R$ 1.125,00", adjustmentRevision: "1",
      adjustmentReason: "Correção auditada", adjustedBy: "Rodrigo", adjustedAt: "2026-09-01T10:00:00.000Z" };
    const snapshot = buildPublicationSnapshotV4(effective, {
      narrative: "Narrativa V4 com /Users/rodrigo/Pasta privada/segredo.pdf controlado.", manualFinancialEntries: [], history: [], updatedAt: null,
    }, 4, null, "2026-09-01T11:00:00.000Z");
    const html = buildPublicationHtml(snapshot); const csv = buildPublicationCsv(snapshot); const view = toPublicPublication(snapshot);
    expect(html).toContain("Horas originais");
    expect(html).toContain("universos distintos");
    expect(html).toContain("[caminho local omitido]");
    expect(html).not.toContain("/Users/rodrigo");
    expect(csv).toContain("Correção auditada");
    expect(csv).toContain("'​=1+1");
    expect(view.schemaVersion).toBe("tria-publication-v4");
  });
});
