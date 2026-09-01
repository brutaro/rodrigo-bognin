import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
vi.mock("server-only", () => ({}));
import { renderReport } from "./renderer";
import type { ProjectReportModel } from "./types";

const model: ProjectReportModel = {
  kind: "project", meta: { code: "TRIA-PROJ-TESTE", generatedAt: "2026-09-01T10:00:00Z", modelHash: "a".repeat(64) },
  project: { id: "P1", title: "Projeto de teste", period: "2025-01-01 a 2025-12-31", narrative: "Narrativa verificável." },
  activities: [{ id: "A1", description: "Atividade", bm: "BM 1", sourceHours: "01:00", effectiveHours: "30:15", sourceMeasurement: "R$ 10,00", effectiveMeasurement: "-R$ 2,00", revision: "1", provenance: "Rodrigo · motivo" }],
  hoursByBm: [{ label: "BM 1", value: 30.25, displayValue: "30:15" }],
  financialUniverses: [
    { name: "Medição", value: "-R$ 2,00", explanation: "Somente medição." },
    { name: "Pagamento", value: "R$ 5,00", explanation: "Somente pagamento." },
  ], evidence: [], history: [],
};

async function pdfText(buffer: Buffer) {
  const document = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: `${path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/` }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return { pages: document.numPages, text: pages.join(" ") };
}

describe("PDF gerencial", () => {
  it("gera bytes íntegros em memória com texto PDF", async () => {
    const result = await renderReport(model);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(result.buffer.length).toBeGreaterThan(5_000);
    expect(result.sha256).toBe(createHash("sha256").update(result.buffer).digest("hex"));
    const semantic = await pdfText(result.buffer);
    expect(semantic.text).toContain("Horas efetivas por BM");
    expect(semantic.text).toContain("Tabela equivalente ao gráfico");
    expect(semantic.text).toContain("Medição, NFS-e, relação auditada");
    expect(semantic.text).toContain("30:15");
  });
  it("mantém medição e pagamento em linhas distintas do modelo", () => {
    expect(model.financialUniverses.map((item) => item.name)).toEqual(["Medição", "Pagamento"]);
  });
  it("pagina conteúdo longo sem perder o histórico", async () => {
    const longModel: ProjectReportModel = { ...model,
      activities: Array.from({ length: 90 }, (_, index) => ({ ...model.activities[0], id: `A${index}`, description: `Atividade longa ${index} ${"descrição ".repeat(8)}` })),
      history: [{ kind: "NFS-e", record: "N1", revision: "3", operation: "adjust", reason: "Motivo auditável ".repeat(20), actor: "Rodrigo", occurredAt: "2026-09-01T12:00:00Z", before: "antes ".repeat(80), after: "depois ".repeat(80) }],
    };
    const semantic = await pdfText((await renderReport(longModel)).buffer);
    expect(semantic.pages).toBeGreaterThan(1);
    expect(semantic.text).toContain("Histórico de ajustes");
    expect(semantic.text).toContain("Motivo auditável");
  });

});
