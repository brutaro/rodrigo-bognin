import { assertSameOrigin, requireAuthenticatedApi } from "@/lib/auth";
import { FileRepositoryError } from "@/lib/file-repository";
import { FileStoreError } from "@/lib/file-store";
import { uploadContextDocument } from "@/lib/context-repository";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 if(!await requireAuthenticatedApi())return Response.json({error:"Não autenticado."},{status:401});
 try{
  await assertSameOrigin(request);
  const name=decodeURIComponent(request.headers.get('x-tria-file-name')??'');
  const result=await uploadContextDocument({name,size:Number(request.headers.get('content-length')),body:request.body});
  return Response.json(result,{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof FileRepositoryError||error instanceof FileStoreError?error.message:'Não foi possível guardar o PDF.'},{status:error instanceof FileRepositoryError&&error.code==='quota'?413:400});}
}
