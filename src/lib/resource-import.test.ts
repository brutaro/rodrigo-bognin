import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import yazl from "yazl";
import { sourceDocument } from "./resource-import";

const source = vi.hoisted(() => ({ bytes: Buffer.alloc(0) }));
vi.mock("./database", () => ({ getSql: () => async () => [{ object_key: "test", size_bytes: String(source.bytes.length), sha256: createHash("sha256").update(source.bytes).digest("hex"), source_format: "xlsx" }] }));
vi.mock("./consolidated-source-repository", () => ({ realSourceUploadEnabled: () => true }));
vi.mock("./file-store", () => ({ verifiedStoredObjectNodeStream: async function* () { yield source.bytes; } }));

async function workbook(rowCount: number, columns: number, extraXml = "", customRows?: string) {
  const zip = new yazl.ZipFile();
  const add = (name: string, xml: string) => zip.addBuffer(Buffer.from(xml), name, { compress: false });
  add("xl/workbook.xml", '<workbook xmlns:r="r"><sheets><sheet name="Base" r:id="rId1"/></sheets></workbook>');
  add("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  const rows = customRows ?? Array.from({ length: rowCount + 1 }, (_, row) => `<row r="${row + 1}">${Array.from({ length: columns }, (_, col) => `<c r="${String.fromCharCode(65 + col)}${row + 1}" t="inlineStr"><is><t>${row === 0 ? `Coluna ${col}` : `Linha ${row} coluna ${col}`}</t></is></c>`).join("")}</row>`).join("");
  add("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${rows}</sheetData>${extraXml}</worksheet>`);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  source.bytes = Buffer.concat(chunks);
}

describe("capacidade de leitura da importação de recursos", () => {
  it.each([8_000, 10_000])("lê %i linhas e 25 colunas sem truncar células", async (rowCount) => {
    await workbook(rowCount, 25);
    const { sheets } = await sourceDocument("test");
    expect(sheets[0].rows).toHaveLength(rowCount);
    expect(sheets[0].headers).toHaveLength(25);
    expect(sheets[0].rows[0][0]).toBe("Linha 1 coluna 0");
    expect(sheets[0].rows[rowCount - 1][24]).toBe(`Linha ${rowCount} coluna 24`);
  }, 30_000);

  it("continua recusando XML acima do orçamento proporcional de elementos", async () => {
    await workbook(8_000, 25, '<extra/>'.repeat(170_000));
    await expect(sourceDocument("test")).rejects.toMatchObject({ code: "TABULAR_LIMIT_EXCEEDED", message: "O XML excedeu o orçamento de elementos em memória." });
  }, 30_000);

  it("mantém o limite de 10 mil linhas", async () => {
    await workbook(10_001, 1);
    await expect(sourceDocument("test")).rejects.toMatchObject({ code: "TABULAR_LIMIT_EXCEEDED", message: "A quantidade de linhas excedeu o orçamento permitido." });
  });
});


it("usa resultados salvos, inclusive zero, e sinaliza fórmulas sem resultado ou com erro", async () => {
  await workbook(0, 0, "", `<row r="1"><c r="A1" t="inlineStr"><is><t>Valor</t></is></c></row>
    <row r="2"><c r="A2"><f>1-1</f><v>0</v></c></row>
    <row r="3"><c r="A3"><f>1/3</f><v>0.3333333333333333</v></c></row>
    <row r="4"><c r="A4"><f>1+1</f><v/></c></row>
    <row r="5"><c r="A5"><f t="shared" si="1"/></c></row>
    <row r="6"><c r="A6" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
    <row r="7"><c r="A7"><v>0</v></c></row><row r="8"><c r="A8"><v>0.83330000000000004</v></c></row><row r="9"><c r="A9"><v>1E-5</v></c></row><row r="10"><c r="A10"><v>1E-20</v></c></row><row r="11"><c r="A11" t="str"><f>""</f><v/></c></row><row r="12"><c r="A12" t="str"><f t="shared" si="2"/><v/></c></row><row r="13"><c r="A13" t="str"><f>"texto"</f></c></row>`);
  const { sheets } = await sourceDocument("test");
  expect(sheets[0].rows).toEqual([["0"], ["0.3333333333333333"], ["=1+1"], ["="], ["=1/0"], ["0"], ["0.8333"], ["0.00001"], ["1E-20"], [""], [""], ['="texto"']]);
});
