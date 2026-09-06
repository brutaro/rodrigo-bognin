import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { PassiveTabularReader, syntheticParserLimitsV1 as limits } from "../domain/passive-tabular-reader";
import type { ParserLimits } from "../domain/import-contract";
import { canonicalStringify } from "../shared/hash-canonical";

const reader=new PassiveTabularReader();
const options={encoding:"utf-8" as const,delimiter:"," as const,quote:'"' as const,escape:"double-quote" as const,allowMultilineQuotedField:false};
const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>codigo</t></is></c><c r="B1" t="inlineStr"><is><t>data</t></is></c><c r="C1" t="inlineStr"><is><t>valor</t></is></c></row><row r="7"><c r="A7" t="inlineStr"><is><t>SYSTEM PUBLIC &amp; válido</t></is></c><c r="B7" s="0"><v>46023</v></c></row><row r="11"><c r="A11" t="inlineStr"><is><t>A2</t></is></c><c r="C11"><v>10.500</v></c></row></sheetData></worksheet>';
async function zip(overrides: Record<string,string>={},extras:Array<[string,string]>=[]) {
  const archive=new yazl.ZipFile();
  const entries={ 'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Sintética" r:id="r1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml':sheet, 'xl/styles.xml':'<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>', ...overrides };
  for(const [path,content] of [...Object.entries(entries),...extras]) archive.addBuffer(Buffer.from(content),path);
  archive.end(); return await new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];archive.outputStream.on('data',(b)=>chunks.push(b));archive.outputStream.on('error',reject);archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));});
}
const workbook=(bytes:Uint8Array,custom:Partial<ParserLimits>={})=>reader.enumerate({bytes,sourceSha256:'a'.repeat(64),sourceFormat:'XLSX',limits:{...limits,...custom}});
const csv=(text:string,custom:Partial<ParserLimits>={})=>reader.enumerate({bytes:Buffer.from(text),sourceSha256:'b'.repeat(64),sourceFormat:'CSV',limits:{...limits,...custom},csvParseOptions:options});

describe('G-05/G-06 matriz sintética positiva e hostil',()=>{
  it('preserva sparse, final vazio, serial date e localizadores reais',async()=>{
    const doc=await workbook(await zip()); const result=reader.read({document:doc,sourceSha256:'a'.repeat(64),sheetSelection:doc.sheets![0].selection});
    expect(result.locators).toEqual(['row:7','row:11']); expect(result.rows[0]).toEqual(['SYSTEM PUBLIC & válido','2026-01-01','']); expect(result.rows[1]).toEqual(['A2','','10.500']);
  });
  it('preserva registro final vazio entre aspas e rejeita UTF-8 inválido',async()=>{
    expect((await csv('codigo\n""')).csv?.rows).toEqual([['']]);
    await expect(reader.enumerate({bytes:Uint8Array.of(0xff),sourceSha256:'a'.repeat(64),sourceFormat:'CSV',limits,csvParseOptions:options})).rejects.toMatchObject({code:'CSV_OPTIONS_UNSUPPORTED'});
  });
  it.each([
    ['DTD','<!DOCTYPE worksheet [<!ENTITY a "b">]><worksheet/>'],
    ['entidade externa','<!DOCTYPE worksheet SYSTEM "https://invalid.test/"><worksheet/>'],
    ['atributo duplicado','<worksheet a="1" a="2"/>'],
    ['entidade zero','<worksheet>&#0;</worksheet>'],
    ['entidade inválida','<worksheet>&#xZZ;</worksheet>'],
    ['entidade parcial','<worksheet>&#12junk;</worksheet>'],
    ['surrogate','<worksheet>&#xD800;</worksheet>'],
    ['entidade desconhecida','<worksheet>&evil;</worksheet>'],
    ['múltiplas raízes','<worksheet/><worksheet/>'],
    ['tag incompleta','<worksheet>'],
  ])('rejeita XML %s',async(_,xml)=>{await expect(workbook(await zip({'xl/worksheets/sheet1.xml':xml}))).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});});
  it.each(['ftp://bad/x','mailto:bad','file:///bad','//bad','../bad','/bad'])('rejeita Target externo %s',async(target)=>{await expect(workbook(await zip({'xl/_rels/workbook.xml.rels':`<Relationships><Relationship Id="r1" Target="${target}"/></Relationships>`}))).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});});
  it.each(['xl/vbaProject.bin','xl/externalLinks/x.xml','xl/embeddings/a.bin','xl/activeX/a.bin','xl/macrosheets/a.xml','xl/connections.xml'])('rejeita conteúdo ativo %s',async(path)=>{await expect(workbook(await zip({},[[path,'x']]))).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});});
  it('rejeita duplicidade e traversal no ZIP',async()=>{
    await expect(workbook(await zip({},[['xl/workbook.xml','<workbook/>']]))).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});
    const bytes=await zip({},[['zz/a.xml','x']]);const changed=Buffer.from(bytes.toString('latin1').replaceAll('zz/a.xml','../a.xml'),'latin1');
    await expect(workbook(changed)).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});
  });
  it.each<Partial<ParserLimits>>([{maxZipEntries:1},{maxCompressionRatio:1},{maxExpandedBytes:10},{maxSourceBytes:10},{maxXmlDepth:2},{maxXmlAttributes:1},{maxColumns:1},{maxRows:1}])('aplica orçamento XLSX %j',async(custom)=>{await expect(workbook(await zip(),custom)).rejects.toMatchObject({code:'TABULAR_LIMIT_EXCEEDED'});});
  it.each<[string,Partial<ParserLimits>]>([['codigo\na\nb',{maxRows:1}],['codigo,data\na,b',{maxColumns:1}],['codigo\nlong',{maxCellCharacters:3}],['codigo\n"123456789"',{maxCsvRecordBytes:7}],['codigo\na',{maxExpandedBytes:3}],['codigo\na',{maxSourceBytes:3}]])('aplica orçamento CSV %j',async(text,custom)=>{await expect(csv(text,custom)).rejects.toMatchObject({code:'TABULAR_LIMIT_EXCEEDED'});});
  it('inclui descompressão no timeout e rejeita ZIP truncado',async()=>{
    const bytes=await zip({},[['xl/large.xml',`<a>${Array.from({length:100000},(_,i)=>i.toString(36)).join(',')}</a>`]]);
    await expect(workbook(bytes,{maxMilliseconds:1})).rejects.toMatchObject({code:'TABULAR_LIMIT_EXCEEDED'});
    await expect(workbook(bytes.subarray(0,20))).rejects.toMatchObject({code:'WORKBOOK_UNSAFE'});
  });
  it('rejeita Unicode fora de RFC 8785',()=>{expect(()=>canonicalStringify('\ud800')).toThrow();expect(()=>canonicalStringify({'\udc00':'x'})).toThrow();});
});
