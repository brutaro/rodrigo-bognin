import { z } from "zod";
import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { inspectResourceSource, prepareResources, applyResources, resolveResources } from "@/lib/resource-import";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), sourceId: z.uuid(), delimiter: z.enum([",", ";", "\t"]).optional() }),
  z.object({ action: z.literal("prepare"), sourceId: z.uuid(), ordinal: z.number().int().min(0).max(31), includeActivities: z.boolean().optional(), projectId: z.string().min(1).max(120).optional(), mapping: z.record(z.string(), z.number().int().min(-1).max(255)), delimiter: z.enum([",", ";", "\t"]).optional() }),
  z.object({ action: z.literal("resolve"), id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), decisions: z.record(z.string().max(120), z.enum(["keep", "incoming"])) }),
  z.object({ action: z.literal("apply"), id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }),
]);
export async function POST(request: Request) {
  if (await apiAuthenticationStatus() !== "authenticated") return Response.json({ error: "Entre novamente para continuar." }, { status: 401 });
  try {
    await assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const result = input.action === "inspect" ? await inspectResourceSource(input.sourceId, input.delimiter) : input.action === "prepare" ? await prepareResources(input.sourceId, input.ordinal, input.mapping, input.delimiter, input.projectId, input.includeActivities) : input.action === "resolve" ? await resolveResources(input.id,input.hash,input.decisions) : await applyResources(input.id, input.hash);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Importação:", error instanceof Error ? error.name : "erro");
    return Response.json({ error: error instanceof z.ZodError ? "Seleção inválida." : error instanceof Error && !('severity' in error) ? error.message : "Não foi possível salvar a importação. Tente novamente." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
