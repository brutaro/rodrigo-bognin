import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { buildHeaderDescriptors, validateHeaderMapping, validateHeaderStructure } from "../domain/header-mapping";
import { PassiveTabularReader, syntheticParserLimitsV1 } from "../domain/passive-tabular-reader";

const reader = new PassiveTabularReader();
const csv = { encoding: "utf-8" as const, delimiter: "," as const, quote: '"' as const, escape: "double-quote" as const, allowMultilineQuotedField: false };

function xlsxFixture(active = false, formula = false, relationVariant = "valid") {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Resumo" state="visible" r:id="rId1"/><sheet name="Oculta" state="hidden" r:id="rId2"/></sheets></workbook>'), "xl/workbook.xml");
  zip.addBuffer(Buffer.from(`<Relationships><Relationship Id="rId1" ${relationVariant === "ambiguous" ? 'other:Id="rId3"' : ''} Target="worksheets/sheet1.xml"/><Relationship Id="${relationVariant === "duplicate" ? 'rId1' : 'rId2'}" Target="worksheets/sheet2.xml"/></Relationships>`), "xl/_rels/workbook.xml.rels");
  zip.addBuffer(Buffer.from(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1">data</c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2">${formula ? '<f>SUM(A1:A2)</f><v>999</v>' : '<v>2026-01-01</v>'}</c></row></sheetData></worksheet>`), "xl/worksheets/sheet1.xml");
  zip.addBuffer(Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c></row></sheetData></worksheet>'), "xl/worksheets/sheet2.xml");
  zip.addBuffer(Buffer.from("<sst><si><t>codigo</t></si><si><t>A-1</t></si><si><t>A-2</t></si></sst>"), "xl/sharedStrings.xml");
  if (active) zip.addBuffer(Buffer.from("active"), "xl/embeddings/object.bin");
  zip.end();
  return new Promise<Uint8Array>((resolve, reject) => { const chunks: Buffer[] = []; zip.outputStream.on("data", (chunk) => chunks.push(chunk)); zip.outputStream.on("error", reject); zip.outputStream.on("end", () => resolve(Buffer.concat(chunks))); });
}

describe("leitor tabular passivo", () => {
  it("aceita somente UTF-8 aprovado e mantém fórmula como texto", async () => {
    const bytes = new TextEncoder().encode("\uFEFFcodigo;descricao\nA-1;\"=SUM(A1:A2)\"\n");
    const document = await reader.enumerate({ bytes, sourceSha256: "a".repeat(64), sourceFormat: "CSV", limits: syntheticParserLimitsV1, csvParseOptions: { ...csv, encoding: "utf-8-bom", delimiter: ";" } });
    expect(document.csv?.rows).toEqual([["A-1", "=SUM(A1:A2)"]]);
    await expect(reader.enumerate({ bytes, sourceSha256: "a".repeat(64), sourceFormat: "CSV", limits: syntheticParserLimitsV1, csvParseOptions: csv })).rejects.toMatchObject({ code: "CSV_OPTIONS_UNSUPPORTED" });
  });

  it("rejeita multiline quando desabilitado e aceita quando explicitamente contratado", async () => {
    const bytes = new TextEncoder().encode("codigo,descricao\nA-1,\"linha 1\nlinha 2\"\n");
    await expect(reader.enumerate({ bytes, sourceSha256: "b".repeat(64), sourceFormat: "CSV", limits: syntheticParserLimitsV1, csvParseOptions: csv })).rejects.toMatchObject({ code: "CSV_MALFORMED" });
    const document = await reader.enumerate({ bytes, sourceSha256: "b".repeat(64), sourceFormat: "CSV", limits: syntheticParserLimitsV1, csvParseOptions: { ...csv, allowMultilineQuotedField: true } });
    expect(document.csv?.rows).toEqual([["A-1", "linha 1\nlinha 2"]]);
  });

  it("preserva linhas físicas após CSV multilinha e recusa NUL", async () => {
    const options = { bytes: new TextEncoder().encode('codigo,descricao\r\nA-1,"linha 1\r\nlinha 2"\r\nA-2,normal\r\n'), sourceSha256: "b".repeat(64), sourceFormat: "CSV" as const, limits: syntheticParserLimitsV1, csvParseOptions: { ...csv, allowMultilineQuotedField: true } };
    const document = await reader.enumerate(options);
    expect(document.csv?.locators).toEqual(["row:2", "row:4"]);
    await expect(reader.enumerate({ ...options, bytes: new TextEncoder().encode("codigo\nA\0B") })).rejects.toMatchObject({ code: "CSV_MALFORMED" });
  });

  it("rejeita XLS binário e lê XLSX por XML passivo", async () => {
    await expect(reader.enumerate({ bytes: Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]), sourceSha256: "c".repeat(64), sourceFormat: "XLS", limits: syntheticParserLimitsV1 })).rejects.toMatchObject({ code: "XLS_BINARY_UNSUPPORTED" });
    const document = await reader.enumerate({ bytes: await xlsxFixture(), sourceSha256: "1".repeat(64), sourceFormat: "XLSX", limits: syntheticParserLimitsV1 });
    expect(document.sheets?.map((sheet) => ({ name: sheet.selection.name, visible: sheet.selection.visible }))).toEqual([{ name: "Resumo", visible: true }, { name: "Oculta", visible: false }]);
    const selected = reader.read({ document, sourceSha256: "1".repeat(64), sheetSelection: document.sheets![0].selection });
    expect(selected.rows).toEqual([["A-1", "2026-01-01"]]);
    await expect(reader.enumerate({ bytes: await xlsxFixture(false,true), sourceSha256: "2".repeat(64), sourceFormat: "XLSX", limits: syntheticParserLimitsV1 })).rejects.toMatchObject({ code: "WORKBOOK_UNSAFE" });
    await expect(reader.enumerate({ bytes: await xlsxFixture(true), sourceSha256: "2".repeat(64), sourceFormat: "XLSX", limits: syntheticParserLimitsV1 })).rejects.toMatchObject({ code: "WORKBOOK_UNSAFE" });
  });

  it("recusa relações duplicadas e atributos XML ambíguos", async () => {
    for (const variant of ["duplicate", "ambiguous"]) {
      await expect(reader.enumerate({ bytes: await xlsxFixture(false, false, variant), sourceSha256: "3".repeat(64), sourceFormat: "XLSX", limits: syntheticParserLimitsV1 })).rejects.toMatchObject({ code: "WORKBOOK_UNSAFE" });
    }
  });

  it("bloqueia DTD, traversal e excesso de orçamento", async () => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<!DOCTYPE workbook [<!ENTITY x "x">]><workbook/>'), "xl/workbook.xml");
    zip.addBuffer(Buffer.from("<Relationships/>"), "xl/_rels/workbook.xml.rels"); zip.end();
    const bytes = await new Promise<Uint8Array>((resolve, reject) => { const chunks: Buffer[] = []; zip.outputStream.on("data", (chunk) => chunks.push(chunk)); zip.outputStream.on("error", reject); zip.outputStream.on("end", () => resolve(Buffer.concat(chunks))); });
    await expect(reader.enumerate({ bytes, sourceSha256: "3".repeat(64), sourceFormat: "XLSX", limits: syntheticParserLimitsV1 })).rejects.toMatchObject({ code: "WORKBOOK_UNSAFE" });
    await expect(reader.enumerate({ bytes: new TextEncoder().encode(`codigo\n${"x".repeat(20_000)}`), sourceSha256: "4".repeat(64), sourceFormat: "CSV", limits: syntheticParserLimitsV1, csvParseOptions: csv })).rejects.toMatchObject({ code: "TABULAR_LIMIT_EXCEEDED" });
  });

  it("aplica normalização declarada, sem colisão ou fuzzy match", () => {
    const headers = buildHeaderDescriptors(["  CÓDIGO ", "Data", "valor extra"], "f".repeat(64));
    expect(headers.map((header) => header.normalizedLabel)).toEqual(["codigo", "data", "valor extra"]);
    expect(() => validateHeaderStructure(buildHeaderDescriptors(["Código", "codigo"], "f".repeat(64)), { version: "v1", fields: [{ id: "codigo", label: "Código", required: true, type: "text" }] })).toThrowError(expect.objectContaining({ code: "HEADER_COLLISION" }));
    expect(() => validateHeaderMapping({ headers, mappings: [{ sourceHeaderId: headers[0].headerId, sourceOrdinal: 0, logicalFieldId: "codigo", mode: "canonical-normalized", coercionProfile: "identity-v1" }, { sourceHeaderId: headers[1].headerId, sourceOrdinal: 1, logicalFieldId: "data", mode: "canonical-normalized", coercionProfile: "identity-v1" }], schema: { version: "v1", fields: [{ id: "codigo", label: "Código", required: true, type: "text" }, { id: "data", label: "Data", required: true, type: "date" }] } })).toThrowError(expect.objectContaining({ code: "HEADER_UNMAPPED" }));
  });
});
