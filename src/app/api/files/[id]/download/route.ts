import { requireAuthenticatedApi } from "@/lib/auth";
import { Readable } from "node:stream";
import { FileRepositoryError, prepareFileDownload } from "@/lib/file-repository";
import { FileStoreError } from "@/lib/file-store";

export const dynamic = "force-dynamic";

function disposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "arquivo";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAuthenticatedApi())) return new Response("Não autenticado.", { status: 401 });
  const { id } = await context.params;
  try {
    const prepared = await prepareFileDownload(id);
    if (!prepared) return new Response("Arquivo não encontrado.", { status: 404 });
    const { version, source, finish } = prepared;
    source.once("end", finish); source.once("close", finish); source.once("error", finish);
    return new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition(version.originalName),
        "Content-Length": String(version.sizeBytes),
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "X-TRIA-File-SHA256": version.sha256,
      },
    });
  } catch (error) {
    if (error instanceof FileStoreError) return new Response("A integridade do arquivo falhou.", { status: 409 });
    if (error instanceof FileRepositoryError && error.code === "not-found") return new Response("Arquivo não encontrado.", { status: 404 });
    return new Response("Cofre indisponível.", { status: 503 });
  }
}
