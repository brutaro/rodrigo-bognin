export function validateContextBackupDocument(document,owned,sources,publicationLinks=[],financialProofs=[]){
 const version=owned[0];
 if(document.project_id!==null||document.include_in_publication!==false||document.status!=='active'||sources.length!==0||owned.length!==1||
    version.evidence_asset_id!==null||version.version!==1||version.status!=='active'||version.media_type!=='application/pdf'||
    !/^.+\.pdf$/i.test(version.original_name??'')||/[\\/\u0000-\u001f\u007f]/.test(version.original_name)||version.original_name.length>255||
    !Number.isSafeInteger(Number(version.size_bytes))||Number(version.size_bytes)<=0||Number(version.size_bytes)>50*1024*1024||
    publicationLinks.some(link=>link.file_version_id===version.id)||financialProofs.some(link=>link.file_version_id===version.id)){
  throw Error('Shape de documento de contexto inválido.');
 }
}
export function validateContextBackupEnvelope(head,tail){
 if(!/^%PDF-[12]\.\d/.test(head.toString('ascii'))||!tail.toString('ascii').includes('%%EOF'))throw Error('PDF de contexto inválido no backup.');
}
