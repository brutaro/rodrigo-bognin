import { assertSameOrigin, requireAuthenticatedApi } from "@/lib/auth";
import { FileRepositoryError, setFilePublicationInclusion } from "@/lib/file-repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAuthenticatedApi())) return Response.json({ error: "Não autenticado." }, { status: 401 });
  try {
    await assertSameOrigin(request);
    const input = await request.json() as { include?: unknown };
    if (typeof input.include !== "boolean") return Response.json({ error: "Escolha inválida." }, { status: 400 });
    const { id } = await context.params;
    return Response.json(await setFilePublicationInclusion(id, input.include), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FileRepositoryError && error.code === "not-found") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "Não foi possível alterar a inclusão." }, { status: 503 });
  }
}
