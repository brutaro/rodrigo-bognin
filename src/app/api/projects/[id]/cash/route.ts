import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { confirmCost, saveCashReview, CashInputError, CashConflictError } from "@/lib/cash-repository";
const revision=z.string().regex(/^\d{1,18}$/);
const reason=z.string().trim().min(3).max(500);
const coverage=z.enum(['nao_conferido','completo','sem_movimento']);
const inputSchema=z.discriminatedUnion('operation',[
  z.object({operation:z.literal('confirm'),entryId:z.uuid(),revision,reason,status:z.enum(['nao_informado','confirmado','revertido']),effectiveOn:z.iso.date().nullable(),costEntryId:z.uuid().nullable()})
    .refine(v=>(v.status==='confirmado')===(v.effectiveOn!==null) && (v.status==='confirmado' || v.costEntryId===null)),
  z.object({operation:z.literal('review'),revision,reason,basisHash:z.string().regex(/^[0-9a-f]{64}$/),costs:coverage,payments:coverage,reimbursements:coverage}),
]);
export async function PUT(request: Request,{params}:{params:Promise<{id:string}>}) {
  if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401});
  if(process.env.TRIA_DEMO_WRITES!=='enabled')return Response.json({error:'Gravação desativada.'},{status:403});
  try{
    await assertSameOrigin(request);
    const input=inputSchema.parse(await request.json()),{id}=await params;
    if(input.operation==='confirm')await confirmCost(id,input.entryId,input,input.reason);
    else await saveCashReview(id,input);
    return Response.json({saved:true},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof CashInputError ? error.message : 'Confira os campos e a data. Confirmações exigem data válida, até hoje.'},{status:error instanceof CashConflictError ? 409 : 400});}
}
