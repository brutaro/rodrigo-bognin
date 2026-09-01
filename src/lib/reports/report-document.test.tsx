import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
vi.mock("server-only", () => ({}));
import { renderReport } from "./renderer";
import type { GlobalReportModel, ProjectReportModel } from "./types";

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

const globalModel: GlobalReportModel = {
  kind: "global", meta: { code: "TRIA-GLOBAL-TESTE", generatedAt: "2026-09-01T10:00:00Z", modelHash: "b".repeat(64) },
  coverage: [{ label: "Projetos", value: "2" }], statuses: [{ label: "Publicado com alterações pendentes", value: 2, displayValue: "2" }],
  trend: Array.from({ length: 26 }, (_, index) => ({ label: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`, value: index + 1, displayValue: `${String(index + 1).padStart(2, "0")}:00` })),
  portfolio: [
    { id: "P1", title: "Projeto gerencial com nome completo", status: "Publicado com alterações pendentes", activities: "125",
      effectiveHours: "987:45:20", measurement: "R$ 123.456,78", invoiced: "R$ 999.999,99", related: "R$ 1,00", payments: "R$ 50,00" },
    { id: "P2", title: "Segundo projeto", status: "Pronto para revisar", activities: "9", effectiveHours: "12:30",
      measurement: "R$ 765,43", invoiced: "Não informado", related: "Não informado", payments: "Não informado" },
  ],
  financialUniverses: [{ name: "Medição de atividades", value: "R$ 124.222,21", explanation: "Soma somente da medição." },
    { name: "NFS-e brutas", value: "R$ 999.999,99", explanation: "Soma somente fiscal." }],
};

async function pdfText(buffer: Buffer) {
  const document = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: `${path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/` }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return { pages: document.numPages, text: pages.join(" "), pageTexts: pages };
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
      activities: Array.from({ length: 90 }, (_, index) => ({ ...model.activities[0], id: `A${index}`, description: index === 42
        ? `INICIOLINHA42 ${"descrição ".repeat(8)} FIMLINHA42` : `Atividade longa ${index} ${"descrição ".repeat(8)}` })),
      history: [{ kind: "NFS-e", record: "N1", revision: "3", operation: "adjust", reason: "Motivo auditável ".repeat(20), actor: "Rodrigo", occurredAt: "2026-09-01T12:00:00Z", before: "antes ".repeat(80), after: "depois ".repeat(80) }],
    };
    const semantic = await pdfText((await renderReport(longModel)).buffer);
    expect(semantic.pages).toBeGreaterThan(1);
    expect(semantic.text).toContain("Histórico de ajustes");
    expect(semantic.text).toContain("Motivo auditável");
    const historyPage = semantic.pageTexts.find((page) => page.includes("Motivo auditável"));
    expect(historyPage).toContain("Antes:"); expect(historyPage).toContain("Depois:");
    const tablePages = semantic.pageTexts.filter((page) => /A\d+/.test(page));
    expect(tablePages.length).toBeGreaterThan(1);
    expect(tablePages.every((page) => page.includes("Proveniência"))).toBe(true);
    const guardedRowPage = semantic.pageTexts.find((page) => page.includes("INICIOLINHA42"));
    expect(guardedRowPage).toContain("FIMLINHA42");
  });

  it("apresenta histórico e horários sem JSON nem chaves internas", async () => {
    const historyModel: ProjectReportModel = { ...model, history: [{ kind: "NFS-e", record: "NFS-e 036", revision: "5", operation: "adjust",
      reason: "Projetos declarado e candidato foram conferidos.", actor: "Rodrigo", occurredAt: "01/09/2026, 12:40:23",
      before: "NFS-e: 036; emissão: 16/10/2024; valor: R$ 2.972,44; projeto declarado: Análise - Benefícios",
      after: "NFS-e: 036; emissão: 16/10/2024; valor: R$ 2.972,44; projeto candidato: Segundo projeto" }] };
    const semantic = await pdfText((await renderReport(historyModel)).buffer);
    const normalized = semantic.text.replace(/\s+/g, " ");
    expect(normalized).toContain("Gerado em 01/09/2026"); expect(normalized).toContain("emissão: 16/10/2024");
    expect(semantic.text).not.toMatch(/\{\s*"/); expect(semantic.text).not.toContain("declaredProjectId");
    expect(semantic.text).not.toContain("verifiedRelatedValue"); expect(semantic.text).not.toContain("2026-09-01T10:00:00Z");
  });
  it("mantém portfólio legível e headings da tendência junto aos dados", async () => {
    const semantic = await pdfText((await renderReport(globalModel)).buffer);
    expect(semantic.text).toContain("Publicado com alterações pendentes"); expect(semantic.text).toContain("R$ 123.456,78");
    expect(semantic.text.replace(/\s+/g, " ")).toContain("Projeto Status Atividades Horas Medição");
    const trendPages = semantic.pageTexts.filter((page) => /202[4-6]-\d{2}/.test(page));
    expect(trendPages.length).toBeGreaterThan(1);
    expect(trendPages.every((page) => page.includes("Tendência temporal de horas") && page.includes("Tabela equivalente ao gráfico"))).toBe(true);
    expect(semantic.pageTexts.filter((page) => page.includes("Tendência temporal de horas")).every((page) => /202[4-6]-\d{2}/.test(page))).toBe(true);
  });

});
