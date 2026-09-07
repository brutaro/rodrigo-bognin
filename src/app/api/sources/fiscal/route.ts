import {z} from "zod";
import {apiAuthenticationStatus,assertSameOrigin} from "@/lib/auth";
import {inspectFiscalSource,prepareFiscalImport,applyFiscalImport} from "@/lib/fiscal-import";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("inspect"),sourceId:z.uuid(),delimiter:z.enum([",",";","\t"]).optional()}),
 z.object({action:z.literal("prepare"),sourceId:z.uuid(),ordinal:z.number().int().min(0).max(31),mapping:z.record(z.string(),z.number().int().min(-1).max(255)),delimiter:z.enum([",",";","\t"]).optional()}),
 z.object({action:z.literal("apply"),id:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}),
]);
export async function POST(request:Request){
 if(await apiAuthenticationStatus()!=="authenticated")return Response.json({error:"Entre novamente para continuar."},{status:401});
 try{
  await assertSameOrigin(request);const input=schema.parse(await request.json());
  const result=input.action==="inspect"?await inspectFiscalSource(input.sourceId,input.delimiter):input.action==="prepare"?await prepareFiscalImport(input.sourceId,input.ordinal,input.mapping,input.delimiter):await applyFiscalImport(input.id,input.hash);
  return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const message=error instanceof z.ZodError?"Seleção inválida.":error instanceof Error&&!('severity' in error)?error.message:"A base mudou ou existe uma divergência. Prepare uma nova prévia e confira as notas.";return Response.json({error:message},{status:400});}
}
