import {fiscalNumberKey} from "./fiscal-pdf-domain";
import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {getSql} from "./database";
import {sourceDocument} from "./resource-import";
import {realSourceUploadEnabled} from "./consolidated-source-repository";
import {fiscalMapping,validateFiscalRows,type FiscalImportRow} from "./fiscal-import-domain";
function fiscalId(value:string){const h=createHash("sha256").update(`nfs:${value}`).digest("hex").slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export async function inspectFiscalSource(sourceId:string,delimiter?:","|";"|"\t") {
 const doc=await sourceDocument(sourceId,delimiter);return doc.sheets.map(sheet=>({name:sheet.selection.name,ordinal:sheet.selection.ordinal,headers:sheet.headers,mapping:fiscalMapping(sheet.headers),count:sheet.rows.length}));
}
export async function prepareFiscalImport(sourceId:string,ordinal:number,mapping:Record<string,number>,delimiter?:","|";"|"\t") {
 const doc=await sourceDocument(sourceId,delimiter),sheet=doc.sheets.find(sheet=>sheet.selection.ordinal===ordinal);if(!sheet)throw Error("Escolha uma aba válida.");
 const projects=await getSql()<Array<{id:string;title:string;sourceTitle:string}>>`SELECT id,title,resource_source_title "sourceTitle" FROM project`;
 const data=validateFiscalRows(sheet.rows,mapping,sheet.headers.length,projects,sheet.locators);
 return saveFiscalPreview(sourceId,doc.hash,sheet.selection.name,data.rows,data.errors,{ordinal,mapping});
}
export async function saveFiscalPreview(sourceId:string,sourceHash:string,sheetName:string,inputRows:Array<FiscalImportRow&{id?:string}>,inputErrors:string[],selection:unknown=null) {
 const originals=await getSql()`SELECT id,issue_year,issue_date::text,note_number,amount::text,category,declared_project_id FROM fiscal_note`;
 const effective=await getSql()`SELECT id,issue_year,issue_date::text,note_number,amount::text,category,declared_project_id FROM effective_fiscal_note`;
 const rows=inputRows.map(row=>({...row,id:row.id??fiscalId(row.sourceId)}));
 const comparisons=rows.map(row=>{
  const old=originals.find(note=>note.id===row.id);
  const collision=[...originals,...effective].find(note=>note.id!==row.id&&note.issue_year===row.year&&fiscalNumberKey(note.note_number)===fiscalNumberKey(row.number));
  const same=old && [old,effective.find(note=>note.id===row.id)].some(note=>note && note.issue_year===row.year&&note.issue_date===row.date&&note.note_number===row.number&&note.amount===row.amount&&note.category===row.category&&note.declared_project_id===row.projectId);
  return {...row,state:old?(same?"existing":"conflict"):collision?"conflict":"new",existingId:old?.id??collision?.id??null};
 });
 const conflicts=comparisons.filter(row=>row.state==="conflict");
 const errors=[...inputErrors,...conflicts.map(row=>`Nota ${row.number}: já existe uma nota com dados divergentes ou mesmo número/ano. Confira em Notas fiscais; a importação não sobrescreve ajustes.`)];
 const id=randomUUID(),hash=createHash("sha256").update(JSON.stringify({source:sourceHash,selection,rows})).digest("hex");
 await getSql()`INSERT INTO fiscal_import(id,source_file_id,content_hash,sheet_name,rows,errors) VALUES(${id},${sourceId},${hash},${sheetName},${getSql().json(rows)},${getSql().json(errors)})`;
 return {id,hash,count:rows.length,added:comparisons.filter(row=>row.state==="new").length,existing:comparisons.filter(row=>row.state==="existing").length,conflicts:conflicts.length,errorCount:errors.length,errors:errors.slice(0,30),rows:comparisons,total:rows.reduce((sum,row)=>sum+BigInt(row.amount.replace('.','')),0n).toString()};
}
export async function applyFiscalImport(id:string,hash:string) {
 if(!realSourceUploadEnabled())throw Error("Importação disponível no ambiente local do proprietário.");
 const [result]=await getSql()`SELECT apply_fiscal_import(${id},${hash}) count`;
 return {inserted:result.count as number};
}
