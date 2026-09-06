import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { setFinancialProof } from "@/lib/financial-proof";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await apiAuthenticationStatus() !== "authenticated") return Response.json({error:"Entre novamente para continuar."},{status:401});
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return Response.json({error:"Gravação desativada."},{status:403});
  try {
    await assertSameOrigin(request);
    const input=z.object({entryId:z.uuid(),versionId:z.uuid().nullable(),expectedVersionId:z.uuid().nullable()}).parse(await request.json());
    await setFinancialProof((await params).id,input.entryId,input.versionId,input.expectedVersionId);
    return Response.json({saved:true},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const conflict=error instanceof Error && error.message.includes("vínculo mudou");
    return Response.json({error:conflict ? error.message : "Não foi possível vincular. Confira o lançamento e escolha um arquivo deste projeto."},{status:conflict ? 409 : 400});
  }
}
