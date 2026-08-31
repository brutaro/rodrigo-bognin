import { describe, expect, it } from "vitest";
import { getDemoProject } from "./demo-data";
import {
  buildPublicationCsv,
  buildPublicationHtml,
  safeCsvCell,
  toPublicPublicationV1,
} from "./demo-publication-export";
import { buildPublicationSnapshot, type DemoProjectDraft } from "./demo-workspace";

const project = getDemoProject("demonstracao-continuidade")!;

function publicationWith(narrative: string) {
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
  const view = toPublicPublicationV1(publication);
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
