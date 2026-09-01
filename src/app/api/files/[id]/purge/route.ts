import { assertSameOrigin, attemptPurgeConfirmation, requireAuthenticatedApi } from "@/lib/auth";
import { FileRepositoryError, purgeFileDocument } from "@/lib/file-repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAuthenticatedApi())) return Response.json({ error: "Não autenticado." }, { status: 401 });
  try {
    await assertSameOrigin(request);
    const input = await request.json() as { codigo?: unknown; confirmacao?: unknown };
    if (input.confirmacao !== "EXCLUIR" || typeof input.codigo !== "string" || !(await attemptPurgeConfirmation(input.codigo))) {
      return Response.json({ error: "Confirmação inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const { id } = await context.params;
    const result = await purgeFileDocument(id);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FileRepositoryError && error.code === "not-found") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "O expurgo ficou pendente e pode ser retomado." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
