import {z} from 'zod';
import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {readFiscalDocument,prepareFiscalDocument} from '@/lib/fiscal-document';
import {readFiscalXmlFields} from '@/lib/fiscal-xml-domain';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(await apiAuthenticationStatus()!=='authenticated')return new Response('Não autenticado.',{status:401,headers});
 try{
  const id=z.uuid().parse((await params).id),file=await readFiscalDocument(id,'xml');
  return new Response(new Uint8Array(file.bytes),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="nota-fiscal.xml"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Content-Security-Policy':"sandbox; default-src 'none'",'X-TRIA-File-SHA256':file.hash}});
 }catch{return new Response('XML indisponível ou integridade inválida.',{status:404,headers});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401,headers});
 try{
  await assertSameOrigin(request);const id=z.uuid().parse((await params).id);
  const input=z.strictObject({category:z.string().trim().max(200),project:z.string().trim().max(300)}).parse(await request.json());
  const file=await readFiscalDocument(id,'xml'),fields=readFiscalXmlFields(file.bytes);
  return Response.json(await prepareFiscalDocument(id,{...fields,...input},'xml'),{headers});
 }catch(error){return Response.json({error:error instanceof z.ZodError?'Confira categoria e projeto. Os campos fiscais vêm do XML.':error instanceof Error&&!('severity' in error)?error.message:'Não foi possível preparar a prévia.'},{status:400,headers});}
}
