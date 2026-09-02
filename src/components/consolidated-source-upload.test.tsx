import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildConsolidatedSourceUploadRequest,
  ConsolidatedSourceUpload,
  parseConsolidatedSourceReceipt,
} from "./consolidated-source-upload";

describe("recepção da base consolidada", () => {
  it("explica o isolamento e mantém o controle bloqueado quando o gate está fechado", () => {
    const html = renderToStaticMarkup(<ConsolidatedSourceUpload enabled={false} />);
    expect(html).toContain("Base consolidada de aplicação de recursos");
    expect(html).toContain("Dados reais continuam bloqueados");
    expect(html).toContain("disabled");
    expect(html).toContain(".xls,.xlsx,.csv");
  });

  it("oferece ajuda acessível por controle focável", () => {
    const html = renderToStaticMarkup(<ConsolidatedSourceUpload enabled />);
    expect(html).toContain("aria-describedby=\"consolidated-source-help\"");
    expect(html).toContain("id=\"consolidated-source-help\"");
    expect(html).toContain("Somente os bytes são preservados");
  });

  it("constrói a requisição binária que o navegador envia", () => {
    const file = new File(["abc"], "fixture.XLSX", { type: "application/x-unexpected" });
    const request = buildConsolidatedSourceUploadRequest(file);
    expect(request.url).toBe("/api/sources/consolidated");
    expect(request.init).toMatchObject({ method: "POST", body: file });
    expect(request.init.headers).toEqual({
      "Content-Type": "application/x-unexpected",
      "X-TRIA-File-Name": "fixture.XLSX",
      "X-TRIA-File-Size": "3",
    });
  });

  it("aceita somente recibo estruturalmente válido", () => {
    const valid = {
      receiptId: "10000000-0000-4000-8000-000000000001",
      format: "CSV",
      sizeBytes: 3,
      receivedAt: "2026-09-02T20:00:00.000Z",
      status: "protected",
    };
    expect(parseConsolidatedSourceReceipt(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, receiptId: "inválido" },
      { ...valid, format: "ZIP" },
      { ...valid, sizeBytes: "3" },
      { ...valid, receivedAt: "agora" },
      { ...valid, status: "active" },
    ]) expect(parseConsolidatedSourceReceipt(invalid)).toBeUndefined();
  });
});
