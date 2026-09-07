import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { saveNarrative } from "@/lib/workspace";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await apiAuthenticationStatus() !== "authenticated") return Response.json({ error: "Entre novamente para salvar." }, { status: 401 });
  if (process.env.TRIA_DEMO_WRITES !== "enabled") return Response.json({ error: "Gravação desativada." }, { status: 403 });
  try {
    await assertSameOrigin(request);
    const { narrative, revision } = z.object({ narrative: z.string().max(20000), revision: z.string().regex(/^\d{1,18}$/) }).parse(await request.json());
    const result = await saveNarrative((await params).id, narrative, revision);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const conflict = error instanceof Error && error.message.includes("mudou depois");
    return Response.json({ error: conflict ? "O projeto mudou em outra operação. Copie seu texto e recarregue para conferir antes de salvar." : "Não foi possível salvar. Seu texto continua nesta tela." }, { status: conflict ? 409 : 400 });
  }
}
