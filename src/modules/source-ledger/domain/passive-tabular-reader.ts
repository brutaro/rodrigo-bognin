import yauzl from "yauzl";
import { buildHeaderDescriptors } from "./header-mapping";
import type { CsvParseOptions, HeaderDescriptor, ParserLimits, SheetSelection, SourceFormat } from "./import-contract";
import { syntheticSafeLimits } from "./import-registry";

export const syntheticParserLimitsV1 = syntheticSafeLimits;

export type TabularSheet = { selection: SheetSelection; headers: string[]; rows: string[][]; locators?: string[] };
export type TabularDocument = { format: SourceFormat; sheets?: TabularSheet[]; csv?: { headers: string[]; rows: string[][]; locators?: string[] } };

export class PassiveTabularReaderError extends Error {
  constructor(readonly code: "CSV_OPTIONS_UNSUPPORTED" | "CSV_MALFORMED" | "WORKBOOK_UNSAFE" | "WORKBOOK_INVALID" | "XLS_BINARY_UNSUPPORTED" | "TABULAR_LIMIT_EXCEEDED", message: string) {
    super(message);
    this.name = "PassiveTabularReaderError";
  }
}

export type PassiveReadResult = { document: TabularDocument; headers: HeaderDescriptor[]; rows: string[][]; locators?: string[]; sheetSelection?: SheetSelection };

function fail(code: PassiveTabularReaderError["code"], message: string): never {
  throw new PassiveTabularReaderError(code, message);
}

function assertLimits(limits: ParserLimits) {
  const numeric = [limits.maxSourceBytes, limits.maxExpandedBytes, limits.maxZipEntries, limits.maxCompressionRatio, limits.maxSheets, limits.maxRows, limits.maxColumns, limits.maxCellCharacters, limits.maxCsvRecordBytes, limits.maxXmlDepth, limits.maxXmlAttributes, limits.maxMilliseconds, limits.maxXmlNodes ?? 100_000];
  if (!limits.version || numeric.some((value) => !Number.isSafeInteger(value) || value <= 0)) fail("TABULAR_LIMIT_EXCEEDED", "Os limites versionados do parser são inválidos.");
}

function assertTime(startedAt: number, limits: ParserLimits) {
  if (Date.now() - startedAt > limits.maxMilliseconds) fail("TABULAR_LIMIT_EXCEEDED", "A operação excedeu o orçamento de tempo permitido.");
}

function assertCell(value: string, limits: ParserLimits) {
  if (value.length > limits.maxCellCharacters) fail("TABULAR_LIMIT_EXCEEDED", "Uma célula excedeu o orçamento permitido.");
}

function assertTable(rows: string[][], limits: ParserLimits) {
  if (rows.length > limits.maxRows + 1) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de linhas excedeu o orçamento permitido.");
  for (const row of rows) {
    if (row.length > limits.maxColumns) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de colunas excedeu o orçamento permitido.");
    for (const cell of row) assertCell(cell, limits);
  }
}

function decodeUtf8(bytes: Uint8Array, options: CsvParseOptions) {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (options.encoding === "utf-8" && bom) fail("CSV_OPTIONS_UNSUPPORTED", "O contrato UTF-8 sem BOM não aceita BOM.");
  if (options.encoding === "utf-8-bom" && !bom) fail("CSV_OPTIONS_UNSUPPORTED", "O contrato UTF-8 com BOM exige BOM.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.slice(3) : bytes); }
  catch { fail("CSV_OPTIONS_UNSUPPORTED", "A codificação do CSV não é UTF-8 aprovada."); }
}

function parseCsv(bytes: Uint8Array, options: CsvParseOptions, limits: ParserLimits, startedAt: number) {
  if (!(options.encoding === "utf-8" || options.encoding === "utf-8-bom") || !([",", ";", "\t", "|"] as string[]).includes(options.delimiter) || !([null, '"'] as unknown[]).includes(options.quote) || options.escape !== "double-quote") {
    fail("CSV_OPTIONS_UNSUPPORTED", "As opções do CSV não pertencem ao parser aprovado.");
  }
  if (bytes.byteLength > limits.maxExpandedBytes) fail("TABULAR_LIMIT_EXCEEDED", "O CSV excedeu o orçamento de expansão.");
  const text = decodeUtf8(bytes, options);
  if (text.includes("\0")) fail("CSV_MALFORMED", "O CSV contém caractere NUL; remova-o antes de importar.");
  const records: string[][] = [];
  const locators: string[] = [];
  let line = 1, recordStart = 1;
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let recordBytes = 0;
  let index = 0;
  const pushField = () => { assertCell(field, limits); record.push(field); if (record.length > limits.maxColumns) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de colunas excedeu o orçamento permitido."); field = ""; };
  const pushRecord = () => {
    pushField();
    records.push(record); locators.push(`row:${recordStart}`);
    if (records.length > limits.maxRows + 1) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de linhas excedeu o orçamento permitido.");
    record = [];
    recordBytes = 0;
  };
  while (index < text.length) {
    if ((index & 2047) === 0) assertTime(startedAt, limits);
    const char = text[index];
    const codePoint = text.codePointAt(index)!;
    const trailingSurrogate = codePoint >= 0xdc00 && codePoint <= 0xdfff;
    recordBytes += trailingSurrogate ? 0 : codePoint > 0xffff ? 4 : Buffer.byteLength(char, "utf8");
    if (recordBytes > limits.maxCsvRecordBytes) fail("TABULAR_LIMIT_EXCEEDED", "Um registro CSV excedeu o orçamento permitido.");
    if (options.quote !== null && char === options.quote) {
      if (quoted) {
        if (text[index + 1] === options.quote) { field += options.quote; recordBytes++; index += 2; continue; }
        quoted = false;
        closedQuote = true;
        index++;
        continue;
      }
      if (!field && !closedQuote) { quoted = true; index++; continue; }
      fail("CSV_MALFORMED", "O CSV possui aspas fora da estrutura permitida.");
    }
    if (quoted) {
      if (char === "\n" || char === "\r") {
        if (!options.allowMultilineQuotedField) fail("CSV_MALFORMED", "Quebra de linha dentro de aspas não está habilitada.");
        line++;
        field += char === "\r" && text[index + 1] === "\n" ? "\n" : char;
        if (char === "\r" && text[index + 1] === "\n") { recordBytes++; index++; }
      } else field += char;
      index++;
      continue;
    }
    if (closedQuote) {
      if (char === options.delimiter) { pushField(); closedQuote = false; index++; continue; }
      if (char === "\r" || char === "\n") { closedQuote = false; if (char === "\r" && text[index + 1] === "\n") { recordBytes++; index++; } if(recordBytes>limits.maxCsvRecordBytes) fail("TABULAR_LIMIT_EXCEEDED", "Um registro CSV excedeu o orçamento permitido."); pushRecord(); line++; recordStart=line; index++; continue; }
      if (char.trim() === "") { index++; continue; }
      fail("CSV_MALFORMED", "Há conteúdo após o fechamento de aspas.");
    }
    if (char === options.delimiter) { pushField(); index++; continue; }
    if (char === "\r" || char === "\n") { if (char === "\r" && text[index + 1] === "\n") { recordBytes++; index++; } if(recordBytes>limits.maxCsvRecordBytes) fail("TABULAR_LIMIT_EXCEEDED", "Um registro CSV excedeu o orçamento permitido."); pushRecord(); line++; recordStart=line; index++; continue; }
    field += char;
    index++;
  }
  if (quoted) fail("CSV_MALFORMED", "O CSV termina com aspas abertas.");
  if (closedQuote || field.length || record.length || text.endsWith(options.delimiter)) pushRecord();
  if (!records.length || !records[0].length || records[0].some((header) => !header.trim())) fail("CSV_MALFORMED", "O CSV não possui cabeçalho utilizável.");
  assertTable(records, limits);
  return { headers: records[0], rows: records.slice(1), locators: locators.slice(1) };
}

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

// Mesmo leitor passivo, com orçamento menor, para documentos fiscais individuais.
export function readBoundedXml(xml: string): XmlNode {
  return parseXml(xml, {...syntheticSafeLimits, maxExpandedBytes: 2*1024*1024, maxXmlNodes: 10000, maxXmlDepth: 32, maxMilliseconds: 2000}, Date.now()).children[0];
}

function localName(value: string) { const index = value.indexOf(":"); return index >= 0 ? value.slice(index + 1) : value; }

function decodeXml(value: string, limits: ParserLimits, startedAt: number) {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    if ((index & 2047)===0) assertTime(startedAt, limits);
    if (value[index] !== "&") { output += value[index]; continue; }
    const end = value.indexOf(";", index + 1);
    if (end < 0) fail("WORKBOOK_UNSAFE", "Entidade XML incompleta.");
    const entity = value.slice(index + 1, end);
    if (entity === "lt") output += "<";
    else if (entity === "gt") output += ">";
    else if (entity === "quot") output += '"';
    else if (entity === "apos") output += "'";
    else if (entity === "amp") output += "&";
    else if (/^#(?:x[0-9a-fA-F]+|[0-9]+)$/.test(entity)) {
      const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!(code===9 || code===10 || code===13 || code>=32 && code<=0xd7ff || code>=0xe000 && code<=0xfffd || code>=0x10000 && code<=0x10ffff)) fail("WORKBOOK_UNSAFE", "Referência XML inválida.");
      output += String.fromCodePoint(code);
    }
    else fail("WORKBOOK_UNSAFE", "Entidade XML não permitida.");
    index = end;
  }
  return output;
}

function findTagEnd(xml: string, start: number, limits: ParserLimits, startedAt: number) {
  let quote = "";
  for (let index = start; index < xml.length; index++) {
    if ((index & 2047)===0) assertTime(startedAt, limits);
    const char = xml[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  fail("WORKBOOK_UNSAFE", "Elemento XML incompleto.");
}

function parseStartTag(source: string, limits: ParserLimits, startedAt: number) {
  let index = 0;
  while (index < source.length && /\s/.test(source[index])) index++;
  const nameStart = index;
  while (index < source.length && !/[\s/=]/.test(source[index])) index++;
  const name = source.slice(nameStart, index);
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) fail("WORKBOOK_UNSAFE", "Elemento XML sem nome.");
  const attrs: Record<string, string> = {};
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index++;
    if (index >= source.length || source[index] === "/") break;
    const keyStart = index;
    while (index < source.length && !/[\s=]/.test(source[index])) index++;
    const key = source.slice(keyStart, index);
    while (index < source.length && /\s/.test(source[index])) index++;
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key) || source[index] !== "=") fail("WORKBOOK_UNSAFE", "Atributo XML inválido.");
    index++;
    while (index < source.length && /\s/.test(source[index])) index++;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") fail("WORKBOOK_UNSAFE", "Atributo XML sem aspas.");
    index++;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index++;
    if (index >= source.length) fail("WORKBOOK_UNSAFE", "Atributo XML incompleto.");
    if (Object.hasOwn(attrs,key) || source.slice(valueStart,index).includes("<")) fail("WORKBOOK_UNSAFE", "Atributo XML inválido ou duplicado.");
    attrs[key] = decodeXml(source.slice(valueStart, index),limits,startedAt);
    index++;
    if (Object.keys(attrs).length > limits.maxXmlAttributes) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de atributos XML excedeu o orçamento.");
  }
  return { name, attrs };
}

function parseXml(xml: string, limits: ParserLimits, startedAt: number): XmlNode {
  const upperXml = xml.toUpperCase();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml) || xml.length > limits.maxExpandedBytes || upperXml.includes("<!DOCTYPE") || upperXml.includes("<!ENTITY")) fail("WORKBOOK_UNSAFE", "O XML contém uma construção não permitida.");
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let index = 0;
  let nodes = 0;
  while (index < xml.length) {
    assertTime(startedAt, limits);
    const open = xml.indexOf("<", index);
    if (open < 0) { stack[stack.length - 1].text += decodeXml(xml.slice(index),limits,startedAt); break; }
    if (open > index) stack[stack.length - 1].text += decodeXml(xml.slice(index, open),limits,startedAt);
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4); if (end < 0) fail("WORKBOOK_UNSAFE", "Comentário XML incompleto."); index = end + 3; continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9); if (end < 0) fail("WORKBOOK_UNSAFE", "CDATA XML incompleto."); stack[stack.length - 1].text += xml.slice(open + 9, end); index = end + 3; continue;
    }
    if (xml.startsWith("<?", open)) { const end = xml.indexOf("?>", open + 2); if (end < 0) fail("WORKBOOK_UNSAFE", "Declaração XML incompleta."); index = end + 2; continue; }
    if (xml.startsWith("</", open)) {
      const end = xml.indexOf(">", open + 2); if (end < 0) fail("WORKBOOK_UNSAFE", "Fechamento XML incompleto.");
      const name = xml.slice(open + 2, end).trim();
      if (stack.length === 1 || stack[stack.length - 1].name !== name) fail("WORKBOOK_UNSAFE", "Estrutura XML malformada.");
      stack.pop(); index = end + 1; continue;
    }
    if (xml.startsWith("<!", open)) fail("WORKBOOK_UNSAFE", "Declaração XML não permitida.");
    const end = findTagEnd(xml, open + 1, limits, startedAt);
    const source = xml.slice(open + 1, end);
    const selfClosing = source.trimEnd().endsWith("/");
    const parsed = parseStartTag(selfClosing ? source.slice(0, -1) : source, limits, startedAt);
    if (++nodes > Math.min(limits.maxXmlNodes ?? 100_000, 1_000_000)) fail("TABULAR_LIMIT_EXCEEDED", "O XML excedeu o orçamento de elementos em memória.");
    const node: XmlNode = { name: parsed.name, attrs: parsed.attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      if (stack.length >= limits.maxXmlDepth) fail("TABULAR_LIMIT_EXCEEDED", "A profundidade XML excedeu o orçamento.");
      stack.push(node);
    }
    index = end + 1;
  }
  if (root.children.length !== 1 || root.text.trim()) fail("WORKBOOK_UNSAFE", "O XML exige uma única raiz.");
  if (stack.length !== 1) fail("WORKBOOK_UNSAFE", "O XML termina dentro de um elemento.");
  return root;
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => [ ...(localName(child.name) === name ? [child] : []), ...descendants(child, name) ]);
}
function textContent(node: XmlNode): string { return `${node.text}${node.children.map(textContent).join("")}`; }
function attr(node: XmlNode, name: string) {
  const keys=Object.keys(node.attrs).filter(key=>key!=="xmlns"&&!key.startsWith("xmlns:")&&localName(key)===name);
  if(keys.length>1) fail("WORKBOOK_UNSAFE", "Atributos XML ambíguos foram recusados.");
  return keys.length?node.attrs[keys[0]]:"";
}

function validateZipPath(name: string) {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || name.includes(":")) fail("WORKBOOK_UNSAFE", "O workbook contém um caminho inválido.");
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  if (normalized.split("/").some((part) => part === ".." || part === "." || part === "")) fail("WORKBOOK_UNSAFE", "O workbook contém traversal de caminho.");
}

async function unzip(bytes: Uint8Array, limits: ParserLimits, startedAt: number) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    const seen = new Set<string>();
    let expanded = 0;
    let count = 0;
    let settled = false;
    let close: (() => void) | undefined;
    let destroy: (() => void) | undefined;
    const timer = setTimeout(() => rejectOnce(new PassiveTabularReaderError("TABULAR_LIMIT_EXCEEDED", "O ZIP excedeu o orçamento de tempo.")), Math.max(1, limits.maxMilliseconds-(Date.now()-startedAt)));
    const rejectOnce = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); destroy?.(); close?.(); reject(error); } };
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error || !zipfile) return rejectOnce(new PassiveTabularReaderError("WORKBOOK_UNSAFE", "O contêiner ZIP não pôde ser aberto de forma segura."));
      close = () => zipfile.close();
      if (settled) { zipfile.close(); return; }
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        try {
          assertTime(startedAt, limits);
          count++;
          if (count > limits.maxZipEntries) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de entradas ZIP excedeu o orçamento.");
          validateZipPath(entry.fileName);
          if (/(?:vbaProject\.bin|embeddings\/|activeX\/|externalLinks\/|macrosheets\/|connections\.xml$)/i.test(entry.fileName)) fail("WORKBOOK_UNSAFE", "O workbook contém conteúdo ativo ou vínculo externo.");
          if ((entry.generalPurposeBitFlag & 1) !== 0) fail("WORKBOOK_UNSAFE", "ZIP criptografado não é permitido.");
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (unixMode === 0xa000) fail("WORKBOOK_UNSAFE", "Links simbólicos não são permitidos no workbook.");
          if (!Number.isFinite(entry.compressedSize) || !Number.isFinite(entry.uncompressedSize) || entry.uncompressedSize > 0 && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)) fail("TABULAR_LIMIT_EXCEEDED", "A razão de expansão ZIP excedeu o orçamento.");
          if (seen.has(entry.fileName)) fail("WORKBOOK_UNSAFE", "O workbook possui entrada ZIP duplicada.");
          seen.add(entry.fileName);
          if (entry.fileName.endsWith("/")) { zipfile.readEntry(); return; }
          expanded += entry.uncompressedSize;
          if (expanded > limits.maxExpandedBytes) fail("TABULAR_LIMIT_EXCEEDED", "A expansão ZIP excedeu o orçamento.");
          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return rejectOnce(new PassiveTabularReaderError("WORKBOOK_UNSAFE", "Uma entrada ZIP não pôde ser lida."));
            if (settled) { stream.destroy(); return; }
            destroy = () => stream.destroy();
            const chunks: Buffer[] = [];
            let actualBytes = 0;
            stream.on("data", (chunk: Buffer) => {
              try {
                assertTime(startedAt, limits); actualBytes += chunk.length;
                if (actualBytes>entry.uncompressedSize || actualBytes>limits.maxExpandedBytes) fail("TABULAR_LIMIT_EXCEEDED", "Expansão ZIP excedida.");
                chunks.push(chunk);
              } catch (error) { rejectOnce(error); }
            });
            stream.on("error", () => rejectOnce(new PassiveTabularReaderError("WORKBOOK_UNSAFE", "Uma entrada ZIP não pôde ser lida.")));
            stream.on("end", () => { if (settled) return; entries.set(entry.fileName, Buffer.concat(chunks)); zipfile.readEntry(); });
          });
        } catch (entryError) { try { zipfile.close(); } catch {} rejectOnce(entryError); }
      });
      zipfile.on("end", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(entries); } });
      zipfile.on("error", () => rejectOnce(new PassiveTabularReaderError("WORKBOOK_UNSAFE", "O contêiner ZIP não pôde ser lido de forma segura.")));
    });
  });
}

function parseXlsx(entries: Map<string, Buffer>, sourceSha256: string, limits: ParserLimits, startedAt: number, allowPresentationSheets = false, useCachedFormulaValues = false): TabularSheet[] {
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbookXml || !relsXml) fail("WORKBOOK_INVALID", "O workbook não possui catálogo de abas válido.");
  const workbook = parseXml(workbookXml, limits, startedAt);
  const rels = parseXml(relsXml, limits, startedAt);
  for (const [name, bytes] of entries) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const doc = parseXml(new TextDecoder("utf-8", { fatal: true }).decode(bytes), limits, startedAt);
    if (!allowPresentationSheets && descendants(doc,"f").length) fail("WORKBOOK_UNSAFE", "Fórmulas XLSX não são permitidas nesta versão.");
    for (const relation of descendants(doc,"Relationship")) {
      const target=attr(relation,"Target");
      if (!allowPresentationSheets && (attr(relation,"TargetMode")==="External" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/") || target.includes("..") || target.includes("\\"))) fail("WORKBOOK_UNSAFE", "Relação externa rejeitada.");
    }
  }
  const styles = entries.get("xl/styles.xml") ? parseXml(entries.get("xl/styles.xml")!.toString("utf8"),limits,startedAt) : undefined;
  const dateStyles = new Set<number>();
  if (styles) {
    const custom = new Map(descendants(styles,"numFmt").map((n)=>[Number(attr(n,"numFmtId")),attr(n,"formatCode")]));
    const xfs=descendants(styles,"cellXfs")[0];
    xfs?.children.forEach((n,i)=>{ const id=Number(attr(n,"numFmtId")); if ((id>=14 && id<=22) || (id>=45 && id<=47) || /[ymdhs]/i.test((custom.get(id)??"").replace(/"[^"]*"|\[[^\]]*\]|\\./g,""))) dateStyles.add(i); });
  }
  const date1904=descendants(workbook,"workbookPr").some((n)=>["1","true"].includes(attr(n,"date1904")));
  const relationshipNodes=descendants(rels, "Relationship");
  const relationships = new Map(relationshipNodes.map((node) => [attr(node, "Id"), attr(node, "Target")]));
  if(relationships.size!==relationshipNodes.length) fail("WORKBOOK_UNSAFE", "Identificador de relação XML duplicado.");
  for (const target of relationships.values()) {
    if (!target || target.includes("..") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes("\\")) fail("WORKBOOK_UNSAFE", "Relação externa ou fora do workbook foi rejeitada.");
  }
  const shared = entries.get("xl/sharedStrings.xml") ? descendants(parseXml(entries.get("xl/sharedStrings.xml")!.toString("utf8"), limits, startedAt), "si").map(textContent) : [];
  const sheets = descendants(workbook, "sheet");
  if (!sheets.length) fail("WORKBOOK_INVALID", "O workbook não possui abas.");
  if (sheets.length > limits.maxSheets) fail("TABULAR_LIMIT_EXCEEDED", "A quantidade de abas excedeu o orçamento.");
  return sheets.map((sheet, ordinal) => {
    assertTime(startedAt, limits);
    const relation = relationships.get(attr(sheet, "id"));
    if (!relation) fail("WORKBOOK_INVALID", "A aba não possui relação acessível.");
    const target = relation.startsWith("xl/") ? relation : `xl/${relation.replace(/^\.\//, "")}`;
    if (!target.startsWith("xl/") || target.includes("..")) fail("WORKBOOK_UNSAFE", "Relação de aba inválida.");
    const sheetXml = entries.get(target)?.toString("utf8");
    if (!sheetXml) fail("WORKBOOK_INVALID", "A aba selecionável não está disponível.");
    const root = parseXml(sheetXml, limits, startedAt);
    const locators: string[] = [];
    let lastRow=0;
    const rows = descendants(root, "row").map((rowNode) => {
      const rowNumber=Number(attr(rowNode,"r") || lastRow+1);
      if (!Number.isSafeInteger(rowNumber) || rowNumber<=lastRow || rowNumber>1048576) fail("WORKBOOK_INVALID", "Localizador de linha inválido.");
      lastRow=rowNumber; locators.push(`row:${rowNumber}`);
      const values: string[] = [];
      let nextColumn=0;
      for (const cell of descendants(rowNode, "c")) {
        const reference = attr(cell, "r");
        const match = reference?.match(/^([A-Za-z]+)([1-9][0-9]*)$/);
        if (reference && (!match || Number(match[2])!==rowNumber)) fail("WORKBOOK_INVALID", "Uma célula não possui localizador válido.");
        let column=nextColumn;
        if (match) { column=0; for (const char of match[1].toUpperCase()) column=column*26+char.charCodeAt(0)-64; column--; }
        nextColumn=column+1;
        if (column < 0 || column >= limits.maxColumns) fail("TABULAR_LIMIT_EXCEEDED", "A referência de coluna excedeu o orçamento permitido.");
        const type = attr(cell, "t");
        const formula = descendants(cell, "f")[0];
        const valueNode = descendants(cell, type === "inlineStr" ? "is" : "v")[0];
        // Nunca executa fórmulas. Importação de recursos pode usar o resultado salvo no XLSX.
        const cached = useCachedFormulaValues && valueNode && (textContent(valueNode).trim() !== "" || type === "str") && type !== "e";
        const raw = formula && !cached ? `=${textContent(formula)}` : valueNode ? textContent(valueNode) : textContent(cell);
        let value: string;
        if (formula && !cached) value = raw;
        else if (type === "s") {
          const sharedIndex = Number(raw);
          if (!Number.isSafeInteger(sharedIndex) || sharedIndex < 0 || sharedIndex >= shared.length) fail("WORKBOOK_INVALID", "Uma célula referencia um shared string inválido.");
          value = shared[sharedIndex];
        } else value = type === "b" ? (raw === "1" ? "true" : "false") : raw;
        // XLSX armazena números como doubles. Normaliza resíduos além da escala
        // decimal suportada pelos recursos, sem executar fórmulas ou alterar textos.
        if (useCachedFormulaValues && (!type || type === "n") && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
          && (/[eE]/.test(value) || (value.split(".")[1]?.length ?? 0) > 16)) {
          const numeric = Number(value);
          if (Number.isFinite(numeric) && Math.abs(numeric) < 1e14) {
            const normalized = numeric.toFixed(16).replace(/\.?0+$/, "") || "0";
            // Um valor não nulo pequeno demais deve falhar na validação, nunca virar zero.
            if (Number(normalized) !== 0 || /^-?0+(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(value)) value = normalized;
          }
        }
        if (dateStyles.has(Number(attr(cell,"s"))) && (!type || type==="n") && /^\d+(?:\.\d+)?$/.test(value)) {
          const serial=Number(value);
          if (Number.isSafeInteger(serial) && (date1904 || serial!==60) && serial>=0 && serial<=2958465) value=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31)+(serial-(date1904?0:serial>60?1:0))*86400000).toISOString().slice(0,10);
        }
        if (values[column]!==undefined) fail("WORKBOOK_INVALID", "Célula duplicada.");
        values[column] = value;
        assertCell(value, limits);
      }
      return Array.from({length:values.length},(_,i)=>values[i]??"");
    });
    assertTable(rows, limits);
    const headers = rows.shift() ?? [];
    if (allowPresentationSheets) {
      const width = Math.max(headers.length, ...rows.map(row => row.length));
      while (headers.length < width) headers.push("");
    }
    locators.shift();
    for (const row of rows) { if (row.length>headers.length) fail("WORKBOOK_INVALID", "Linha excede o cabeçalho."); while(row.length<headers.length) row.push(""); }
    if (!allowPresentationSheets && (!headers.length || headers.some((header) => !header.trim()))) fail("WORKBOOK_INVALID", "A aba não possui cabeçalho utilizável.");
    return { selection: { sheetId: `sheet-${sourceSha256.slice(0, 24)}-${ordinal + 1}`, name: (attr(sheet, "name") || `Aba ${ordinal + 1}`).slice(0, 120), ordinal, visible: !["hidden", "veryHidden"].includes(attr(sheet, "state")) }, headers, rows, locators };
  });
}

export class PassiveTabularReader {
  async enumerate(input: { bytes: Uint8Array; sourceSha256: string; sourceFormat: SourceFormat; limits: ParserLimits; csvParseOptions?: CsvParseOptions; allowPresentationSheets?: boolean; useCachedFormulaValues?: boolean }): Promise<TabularDocument> {
    const startedAt = Date.now();
    assertLimits(input.limits);
    if (input.bytes.byteLength > input.limits.maxSourceBytes) fail("TABULAR_LIMIT_EXCEEDED", "A fonte excedeu o orçamento de bytes.");
    if (input.sourceFormat === "CSV") {
      if (!input.csvParseOptions) fail("CSV_OPTIONS_UNSUPPORTED", "O contrato CSV não foi informado.");
      const result = parseCsv(input.bytes, input.csvParseOptions, input.limits, startedAt);
      return { format: "CSV", csv: result };
    }
    if (input.sourceFormat === "XLS") fail("XLS_BINARY_UNSUPPORTED", "XLS binário não é suportado nesta versão.");
    if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b) fail("WORKBOOK_INVALID", "O XLSX não possui contêiner ZIP válido.");
    return { format: "XLSX", sheets: parseXlsx(await unzip(input.bytes, input.limits, startedAt), input.sourceSha256, input.limits, startedAt, input.allowPresentationSheets, input.useCachedFormulaValues) };
  }

  read(input: { document: TabularDocument; sourceSha256: string; sheetSelection?: SheetSelection }): PassiveReadResult {
    if (input.document.format === "CSV") {
      if (input.sheetSelection || !input.document.csv) fail("CSV_OPTIONS_UNSUPPORTED", "CSV não possui seleção de aba.");
      return { document: input.document, headers: buildHeaderDescriptors(input.document.csv.headers, input.sourceSha256), rows: input.document.csv.rows };
    }
    if (!input.sheetSelection) fail("WORKBOOK_INVALID", "Escolha uma aba antes de preparar a prévia.");
    const selected = input.document.sheets?.find((sheet) => sheet.selection.sheetId === input.sheetSelection?.sheetId);
    if (!selected || JSON.stringify(selected.selection) !== JSON.stringify(input.sheetSelection)) fail("WORKBOOK_INVALID", "A aba escolhida não corresponde à enumeração vigente.");
    return { document: input.document, headers: buildHeaderDescriptors(selected.headers, input.sourceSha256), rows: selected.rows, locators: selected.locators, sheetSelection: selected.selection };
  }
}

// Kept only as a test-data helper; the production reader deliberately rejects XLS.
export function syntheticXlsFixture(sheets: Array<{ name: string; visible?: boolean; rows: string[][] }>) {
  return new TextEncoder().encode(`TRIA-XLS-SYNTHETIC-V1\n${JSON.stringify({ sheets })}`);
}
