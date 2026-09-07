import {z} from 'zod';
import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {prepareFiscalPdf,readFiscalPdf} from '@/lib/fiscal-pdf';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(await apiAuthenticationStatus()!=='authenticated')return new Response('Não autenticado.',{status:401,headers});
 try{
  const id=z.uuid().parse((await params).id);const pdf=await readFiscalPdf(id);
  return new Response(new Uint8Array(pdf.bytes),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`${new URL(request.url).searchParams.has('download')?'attachment':'inline'}; filename="nota-fiscal.pdf"; filename*=UTF-8''${encodeURIComponent(pdf.name)}`,'Content-Security-Policy':"sandbox; frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN','X-TRIA-File-SHA256':pdf.hash}});
 }catch{return new Response('PDF indisponível ou integridade inválida.',{status:404,headers});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401,headers});
 try{
  await assertSameOrigin(request);const id=z.uuid().parse((await params).id);
  const input=z.object({number:z.string().trim().min(1).max(100),date:z.iso.date(),amount:z.string().trim().min(1).max(30),category:z.string().trim().max(200),project:z.string().trim().max(300)}).parse(await request.json());
  return Response.json(await prepareFiscalPdf(id,input),{headers});
 }catch(error){return Response.json({error:error instanceof z.ZodError?'Confira os campos obrigatórios.':error instanceof Error&&!('severity' in error)?error.message:'Não foi possível preparar a prévia.'},{status:400,headers});}
}
