import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {receiveFiscalPdf} from '@/lib/fiscal-pdf';
export async function POST(request:Request){
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401});
 try{await assertSameOrigin(request);return Response.json(await receiveFiscalPdf(request),{status:201,headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return Response.json({error:error instanceof Error&&!('severity' in error)?error.message:'Não foi possível proteger o PDF.'},{status:400});}
}
