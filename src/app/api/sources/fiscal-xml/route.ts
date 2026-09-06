import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {receiveFiscalDocument} from '@/lib/fiscal-document';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401,headers});
 try{await assertSameOrigin(request);return Response.json(await receiveFiscalDocument(request,'xml'),{status:201,headers});}
 catch(error){return Response.json({error:error instanceof Error&&!('severity' in error)?error.message:'Não foi possível proteger o XML.'},{status:400,headers});}
}
