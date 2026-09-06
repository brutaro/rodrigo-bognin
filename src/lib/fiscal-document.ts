import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {getSql} from './database';
import {persistOpaqueUpload} from './file-repository';
import {verifiedStoredObjectNodeStream} from './file-store';
import {realSourceUploadEnabled} from './consolidated-source-repository';
import {fiscalPdfLimitBytes,validatePdfEnvelope,fiscalNumberKey} from './fiscal-pdf-domain';
import {validateFiscalRows,type FiscalImportRow} from './fiscal-import-domain';
import {readFiscalXmlFields,fiscalXmlLimitBytes} from './fiscal-xml-domain';
import {saveFiscalPreview} from './fiscal-import';
class DocumentAlreadyStored extends Error { constructor(readonly sourceId:string){super("Arquivo já protegido");} }
function enabled(){if(!realSourceUploadEnabled())throw Error('Cadastro fiscal disponível no ambiente local do proprietário.');}
export async function receiveFiscalDocument(request:Request,format:'pdf'|'xml') {
 enabled();const limit=format==='pdf'?fiscalPdfLimitBytes:fiscalXmlLimitBytes;
 let name='';try{name=decodeURIComponent(request.headers.get('x-tria-file-name')??'').normalize('NFC');}catch{}
 const declared=request.headers.get('x-tria-file-size'),transport=request.headers.get('content-length');
 if(!declared||!/^\d+$/.test(declared)||declared!==transport||Number(declared)<=0||Number(declared)>limit)throw Error(`Envie um ${format.toUpperCase()} de até ${limit/1024/1024} MiB, com tamanho válido.`);
 if(name.length>255||name.trim()!==name||!name.toLowerCase().endsWith('.'+format)||name.length<=4||/[\\/\u0000-\u001f\u007f]/.test(name))throw Error(`Escolha um arquivo ${format.toUpperCase()} com nome válido.`);
 if(!request.body)throw Error('Arquivo vazio.');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>Number(declared)){await reader.cancel();throw Error('O tamanho recebido diverge do declarado.');}chunks.push(value);}}finally{reader.releaseLock();}
 if(length!==Number(declared))throw Error('O tamanho recebido diverge do declarado.');
 const bytes=Buffer.concat(chunks);if(format==='pdf')validatePdfEnvelope(bytes);else readFiscalXmlFields(bytes);
 // Byte-identical retries reuse the protected original rather than consuming the vault twice.
 const hash=createHash('sha256').update(bytes).digest('hex');
 const [existing]=await getSql()`SELECT sf.id FROM source_file sf JOIN file_version v ON v.id=sf.file_version_id WHERE sf.source_format=${format} AND v.sha256=${hash} AND v.size_bytes=${length} AND v.status='active'`;
 if(existing)return {sourceId:existing.id as string};
 try { return await persistOpaqueUpload({expectedSize:length,beforeStore:async()=>{
  const [same]=await getSql()`SELECT sf.id FROM source_file sf JOIN file_version v ON v.id=sf.file_version_id WHERE sf.source_format=${format} AND v.sha256=${hash} AND v.size_bytes=${length} AND v.status='active'`;
  if(same)throw new DocumentAlreadyStored(same.id as string);
 },body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),catalog:async(tx,artifact)=>{
  const sourceId=randomUUID(),documentId=randomUUID(),versionId=randomUUID();
  await tx`INSERT INTO file_document(id,project_id,title,status,created_at,updated_at,include_in_publication,document_kind) VALUES(${documentId},NULL,${format==='pdf'?'Nota fiscal em PDF':'Nota fiscal em XML'},'active',${artifact.createdAt},${artifact.createdAt},false,'source')`;
  await tx`INSERT INTO file_version(id,document_id,version,object_key,original_name,media_type,size_bytes,sha256,status,created_at) VALUES(${versionId},${documentId},1,${artifact.objectKey},${name},${format==='pdf'?'application/pdf':'application/xml'},${length},${artifact.sha256},'active',${artifact.createdAt})`;
  await tx`INSERT INTO source_file(id,document_id,file_version_id,source_format,received_by,received_at) VALUES(${sourceId},${documentId},${versionId},${format},'Rodrigo',${artifact.createdAt})`;
  await tx`INSERT INTO source_file_event(id,source_file_id,operation,byte_count,actor,occurred_at) VALUES(${randomUUID()},${sourceId},'source.file.received.v1',${length},'Rodrigo',${artifact.createdAt})`;
  return {sourceId};
 }}); } catch(error){if(error instanceof DocumentAlreadyStored)return {sourceId:error.sourceId};throw error;}
}
export async function fiscalDocumentSource(sourceId:string,format:'pdf'|'xml') {
 enabled();
 const [file]=await getSql()`SELECT sf.id,v.object_key::text,v.original_name,v.size_bytes::text,v.sha256 FROM source_file sf JOIN file_version v ON v.id=sf.file_version_id JOIN file_document d ON d.id=sf.document_id WHERE sf.id=${sourceId} AND sf.source_format=${format} AND v.status='active' AND d.status='active'`;
 if(!file)throw Error('Arquivo fiscal protegido não encontrado.');return file;
}
export async function readFiscalDocument(sourceId:string,format:'pdf'|'xml'){
 const file=await fiscalDocumentSource(sourceId,format);const parts:Buffer[]=[];
 for await(const chunk of await verifiedStoredObjectNodeStream(file.object_key,Number(file.size_bytes),file.sha256))parts.push(Buffer.from(chunk));
 return {name:file.original_name as string,bytes:Buffer.concat(parts),hash:file.sha256 as string};
}
export async function prepareFiscalDocument(sourceId:string,input:{number:string;date:string;amount:string;category:string;project:string},format:'pdf'|'xml') {
 const file=await readFiscalDocument(sourceId,format);
 const projects=await getSql()<Array<{id:string;title:string;sourceTitle:string}>>`SELECT id,title,resource_source_title "sourceTitle" FROM project`;
 const data=validateFiscalRows([[`${format}:${input.date.slice(0,4)}|${fiscalNumberKey(input.number)}`,input.number,input.date,input.amount,input.category,input.project]],{sourceId:0,number:1,date:2,amount:3,category:4,project:5},6,projects);
 const rows:Array<FiscalImportRow&{id?:string}>=data.rows;
 if(rows.length){
  const row=rows[0];
  const candidates=await getSql()`SELECT id,note_number,issue_year FROM effective_fiscal_note UNION SELECT id,note_number,issue_year FROM fiscal_note`;
  const matches=candidates.filter(n=>n.issue_year===row.year && fiscalNumberKey(n.note_number)===fiscalNumberKey(row.number));
  if(new Set(matches.map(n=>n.id)).size>1)data.errors.push('Há mais de uma nota com número equivalente neste ano. Confira o cadastro fiscal antes de continuar.');
  else if(matches.length){row.id=matches[0].id;row.number=matches[0].note_number;}
 }
 return saveFiscalPreview(sourceId,file.hash,`${format.toUpperCase()} conferido`,rows,data.errors);
}
