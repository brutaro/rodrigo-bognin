import { requireAuthenticatedApi } from "@/lib/auth";
import { createHash } from "node:crypto";
import { buildPublicationHtml } from "@/lib/demo-publication-export";
import { PublicationIntegrityError, readPublication } from "@/lib/workspace";

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  if (!(await requireAuthenticatedApi())) return new Response("Não autenticado.", { status: 401 });
  try {
    const { publicationId } = await context.params;
    const publication = await readPublication(publicationId);
    if (!publication) return new Response("Publicação não encontrada.", { status: 404 });
    const body = buildPublicationHtml(publication);
    const artifactHash = createHash("sha256").update(body).digest("hex");
    const publicationCode = `TRIA-V${publication.version}-${publication.contentHash.slice(0, 12).toUpperCase()}`;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${publicationCode.toLowerCase()}.html"`,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Content-Type": "text/html; charset=utf-8",
        ETag: `"${artifactHash}"`,
        "X-Content-Type-Options": "nosniff",
        "X-TRIA-Artifact-SHA256": artifactHash,
        "X-TRIA-Publication-SHA256": publication.contentHash,
      },
    });
  } catch (error) {
    if (error instanceof PublicationIntegrityError) {
      return new Response("A integridade da publicação não pôde ser verificada.", { status: 409 });
    }
    return new Response("Falha interna ao gerar a exportação.", { status: 500 });
  }
}
