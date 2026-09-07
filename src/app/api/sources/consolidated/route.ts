import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import {
  ConsolidatedSourceUploadError,
  consolidatedSourceUploadEnabled,
  receiveConsolidatedSource,
  sanitizedConsolidatedSourceReceipt,
} from "@/lib/consolidated-source-repository";
import { FileRepositoryError } from "@/lib/file-repository";
import { FileStoreError } from "@/lib/file-store";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: responseHeaders });
}

function decodedHeader(request: Request, name: string) {
  const raw = request.headers.get(name) ?? "";
  try { return decodeURIComponent(raw); } catch { return ""; }
}

export async function POST(request: Request) {
  const authentication = await apiAuthenticationStatus();
  if (authentication === "invalid") return json({ error: "Não autenticado." }, 401);
  if (authentication === "unavailable") return json({ error: "Autenticação indisponível." }, 503);
  if (!consolidatedSourceUploadEnabled()) {
    return json({ error: "Recebimento disponível somente para fixtures sintéticas isoladas." }, 503);
  }
  try {
    await assertSameOrigin(request);
    const receipt = await receiveConsolidatedSource({
      originalName: decodedHeader(request, "x-tria-file-name"),
      declaredSize: request.headers.get("x-tria-file-size"),
      transportSize: request.headers.get("content-length"),
      mediaType: request.headers.get("content-type"),
      body: request.body,
    });
    return json(sanitizedConsolidatedSourceReceipt(receipt), 201);
  } catch (error) {
    if (error instanceof ConsolidatedSourceUploadError) {
      if (error.code === "disabled") return json({ error: "Recebimento disponível somente para fixtures sintéticas isoladas." }, 503);
      return json({ error: error.code === "too-large" ? "O arquivo excede o limite de 50 MiB." : "Escolha um arquivo XLS, XLSX ou CSV válido." }, error.code === "too-large" ? 413 : 400);
    }
    if (error instanceof FileRepositoryError) {
      return json({ error: error.code === "quota" ? "Não há quota disponível para este arquivo." : "Recebimento temporariamente indisponível." }, error.code === "quota" ? 413 : 503);
    }
    if (error instanceof FileStoreError) {
      return json({ error: error.code === "size" ? "O tamanho recebido diverge do tamanho declarado." : "Recebimento temporariamente indisponível." }, error.code === "size" ? 400 : 503);
    }
    if (error instanceof Error && error.message === "Origem inválida.") {
      return json({ error: "Requisição recusada." }, 403);
    }
    return json({ error: "Não foi possível proteger o arquivo." }, 503);
  }
}
