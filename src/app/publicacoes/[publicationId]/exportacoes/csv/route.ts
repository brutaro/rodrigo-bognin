import { createHash } from "node:crypto";
import { buildPublicationCsv, toPublicPublicationV1 } from "@/lib/demo-publication-export";
import { readDemoPublication } from "@/lib/demo-workspace";

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { publicationId } = await context.params;
    const publication = await readDemoPublication(publicationId);
    if (!publication) return new Response("Publicação não encontrada.", { status: 404 });
    const body = buildPublicationCsv(publication);
    const artifactHash = createHash("sha256").update(body).digest("hex");
    const view = toPublicPublicationV1(publication);
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${view.publicationCode.toLowerCase()}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        ETag: `"${artifactHash}"`,
        "X-Content-Type-Options": "nosniff",
        "X-TRIA-Artifact-SHA256": artifactHash,
        "X-TRIA-Publication-SHA256": publication.contentHash,
      },
    });
  } catch {
    return new Response("A integridade da publicação não pôde ser verificada.", { status: 409 });
  }
}
