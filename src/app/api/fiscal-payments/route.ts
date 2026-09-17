import {z} from 'zod';
import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {confirmInvoicePayments,saveInvoicePayment,FiscalPaymentError} from '@/lib/fiscal-payment-repository';
const reason=z.string().trim().min(3).max(500);
const inputSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('confirm-all'),basisHash:z.string().regex(/^[0-9a-f]{64}$/),reason,confirmed:z.literal(true)}),
 z.object({operation:z.literal('save'),id:z.string().min(1).max(120),revision:z.string().regex(/^\d{1,18}$/),status:z.enum(['confirmado','revertido']),projectId:z.string().min(1).max(120).nullable(),paidOn:z.iso.date().nullable(),paymentEntryId:z.uuid().nullable(),separatePayment:z.boolean(),reason}),
]);
export async function POST(request:Request){
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente.'},{status:401});
 if(process.env.TRIA_DEMO_WRITES!=='enabled')return Response.json({error:'Gravação desativada.'},{status:403});
 try{
  await assertSameOrigin(request);const input=inputSchema.parse(await request.json());
  const result=input.operation==='confirm-all'?await confirmInvoicePayments(input.basisHash,input.reason):await saveInvoicePayment(input);
  return Response.json({saved:true,...result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof FiscalPaymentError?error.message:'Não foi possível salvar. Confira os campos e tente novamente.'},{status:400});}
}
