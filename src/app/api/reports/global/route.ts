import { apiAuthenticationStatus } from "@/lib/auth";
import { readGlobalReport } from "@/lib/reports/repository";
import { renderReport } from "@/lib/reports/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const baseHeaders = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  const authentication = await apiAuthenticationStatus();
  if (authentication === "invalid") return new Response("Não autenticado.", { status: 401, headers: baseHeaders });
  if (authentication === "unavailable") return new Response("Relatório indisponível.", { status: 503, headers: baseHeaders });
  try {
    const model = await readGlobalReport(); const report = await renderReport(model);
    return new Response(new Uint8Array(report.buffer), { headers: { ...baseHeaders, "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tria-relatorio-global-${model.meta.code.slice(-12)}.pdf"`,
      "Content-Length": String(report.buffer.length), "X-TRIA-Report-SHA256": report.sha256,
      "X-TRIA-Model-SHA256": model.meta.modelHash } });
  } catch { return new Response("Relatório indisponível.", { status: 503, headers: baseHeaders }); }
}
