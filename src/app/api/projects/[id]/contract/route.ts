import {z} from 'zod';
import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {saveContract,ContractConflictError} from '@/lib/contract-repository';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store'};
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente.'},{status:401,headers});
 try{await assertSameOrigin(request);}catch{return Response.json({error:'Origem inválida.'},{status:403,headers});}
 try{return Response.json(await saveContract((await params).id,await request.json()),{headers});}
 catch(error){return Response.json({error:error instanceof z.ZodError?'Confira valores, referências e datas dos recebimentos.':error instanceof ContractConflictError?error.message:'Não foi possível salvar. Recarregue e confira os dados.'},{status:error instanceof ContractConflictError?409:400,headers});}
}
