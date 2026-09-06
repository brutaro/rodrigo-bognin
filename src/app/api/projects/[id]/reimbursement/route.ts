import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { setReimbursementStatus } from "@/lib/reimbursement-repository";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await apiAuthenticationStatus() !== "authenticated") return Response.json({error:"Entre novamente para continuar."},{status:401});
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return Response.json({error:"Gravação desativada."},{status:403});
  try {
    await assertSameOrigin(request);
    const input = z.object({entryId:z.uuid(),status:z.enum(['nao_informado','sinalizado_pendente','recebido_confirmado','revertido']),receivedOn:z.iso.date().nullable(),revision:z.string().regex(/^\d{1,18}$/),reason:z.string().trim().min(3).max(500)})
      .refine(value => (value.status === 'recebido_confirmado') === (value.receivedOn !== null))
      .parse(await request.json());
    await setReimbursementStatus((await params).id,input.entryId,input,input.reason);
    return Response.json({saved:true},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const conflict = error instanceof Error && error.message.includes("situação mudou");
    return Response.json({error:conflict ? error.message : "Confira o reembolso, o motivo e a data. Recebimento exige uma data válida, até hoje."},{status:conflict ? 409 : 400});
  }
}
