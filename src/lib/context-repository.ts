import "server-only";
import { randomUUID } from "node:crypto";
import { getSql } from "./database";
import { FileRepositoryError, persistOpaqueUpload } from "./file-repository";
import { verifiedStoredObjectNodeStream } from "./file-store";
import { validatePdfEnvelope } from "./fiscal-pdf-domain";
export const contextLimitBytes = 50 * 1024 * 1024;
export type ContextDocument = { id:string; title:string; size:string; created:string; status:'active'|'purging' };
export async function listContextDocuments() {
 return getSql()<ContextDocument[]>`SELECT v.id::text,d.title,v.size_bytes::text size,d.created_at::text created,d.status
 FROM file_document d JOIN file_version v ON v.document_id=d.id
 WHERE d.document_kind='context' ORDER BY d.created_at DESC,d.id`;
}
export async function validateContextPdf(bytes:Uint8Array) {
 validatePdfEnvelope(bytes);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0});
 try {
  const document=await task.promise;
  if(document.numPages<1) throw Error("PDF sem páginas.");
  for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i);await page.getOperatorList();page.cleanup();}
 } catch {throw new FileRepositoryError("O PDF está inválido ou exige senha. Envie um PDF legível.");}
 finally {await task.destroy();}
}
export async function uploadContextDocument(input:{name:string;size:number;body:ReadableStream<Uint8Array>|null}) {
 if(!/\.pdf$/i.test(input.name)||input.size>contextLimitBytes)throw new FileRepositoryError("Envie um PDF de até 50 MiB.");
 return persistOpaqueUpload({expectedSize:input.size,body:input.body,catalog:async(tx,artifact)=>{
  const chunks:Buffer[]=[];
  for await(const chunk of await verifiedStoredObjectNodeStream(artifact.objectKey,artifact.size,artifact.sha256))chunks.push(Buffer.from(chunk));
  await validateContextPdf(Buffer.concat(chunks));
  const id=randomUUID(),versionId=randomUUID();
  const name=input.name.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim().slice(0,200)||'Contexto.pdf';
  await tx`INSERT INTO file_document(id,project_id,document_kind,title,status,include_in_publication,created_at,updated_at)
   VALUES(${id},NULL,'context',${name},'active',false,${artifact.createdAt},${artifact.createdAt})`;
  await tx`INSERT INTO file_version(id,document_id,version,object_key,original_name,media_type,size_bytes,sha256,status,created_at)
   VALUES(${versionId},${id},1,${artifact.objectKey},${name},'application/pdf',${artifact.size},${artifact.sha256},'active',${artifact.createdAt})`;
  await tx`INSERT INTO file_operation_event(id,project_id,operation,byte_count,version_count,publication_count,actor,occurred_at)
   VALUES(${randomUUID()},NULL,'upload_version',${artifact.size},1,0,'Rodrigo',${artifact.createdAt})`;
  return {id:versionId};
 }});
}
