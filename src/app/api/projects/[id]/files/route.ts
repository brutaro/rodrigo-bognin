import { assertSameOrigin, requireAuthenticatedApi } from "@/lib/auth";
import { FileRepositoryError, uploadProjectFile } from "@/lib/file-repository";
import { FileStoreError } from "@/lib/file-store";

export const dynamic = "force-dynamic";

function decodedHeader(request: Request, name: string) {
  const raw = request.headers.get(name) ?? "";
  try { return decodeURIComponent(raw); } catch { return ""; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAuthenticatedApi())) return Response.json({ error: "Não autenticado." }, { status: 401 });
  try {
    await assertSameOrigin(request);
    const { id } = await context.params;
    const contentLength = Number(request.headers.get("content-length"));
    const result = await uploadProjectFile({
      projectId: id,
      documentId: request.headers.get("x-tria-document-id"),
      title: decodedHeader(request, "x-tria-file-title"),
      originalName: decodedHeader(request, "x-tria-file-name"),
      mediaType: request.headers.get("content-type"),
      expectedSize: contentLength,
      body: request.body,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FileRepositoryError) {
      const status = error.code === "quota" ? 413 : error.code === "not-found" ? 404 : error.code === "unavailable" ? 503 : 400;
      return Response.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof FileStoreError) {
      return Response.json({ error: error.message }, { status: error.code === "size" ? 400 : 503, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Não foi possível guardar o arquivo." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
