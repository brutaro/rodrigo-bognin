import { createHash } from "node:crypto";
import { buildPublicationCsv } from "@/lib/demo-publication-export";
import { PublicationIntegrityError, readPublication } from "@/lib/workspace";

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { publicationId } = await context.params;
    const publication = await readPublication(publicationId);
    if (!publication) return new Response("Publicação não encontrada.", { status: 404 });
    const body = buildPublicationCsv(publication);
    const artifactHash = createHash("sha256").update(body).digest("hex");
    const publicationCode = `TRIA-V${publication.version}-${publication.contentHash.slice(0, 12).toUpperCase()}`;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${publicationCode.toLowerCase()}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
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
