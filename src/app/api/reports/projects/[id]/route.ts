import { apiAuthenticationStatus } from "@/lib/auth";
import { readProjectReport, ReportNotFoundError } from "@/lib/reports/repository";
import { renderReport } from "@/lib/reports/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const baseHeaders = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authentication = await apiAuthenticationStatus();
  if (authentication === "invalid") return new Response("Não autenticado.", { status: 401, headers: baseHeaders });
  if (authentication === "unavailable") return new Response("Relatório indisponível.", { status: 503, headers: baseHeaders });
  try {
    const { id } = await params;
    const model = await readProjectReport(id);
    const report = await renderReport(model);
    return new Response(new Uint8Array(report.buffer), { headers: { ...baseHeaders, "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tria-relatorio-projeto-${model.meta.code.slice(-12)}.pdf"`,
      "Content-Length": String(report.buffer.length), "X-TRIA-Report-SHA256": report.sha256,
      "X-TRIA-Model-SHA256": model.meta.modelHash } });
  } catch (error) {
    if (error instanceof ReportNotFoundError) return new Response("Projeto não encontrado.", { status: 404, headers: baseHeaders });
    return new Response("Relatório indisponível.", { status: 503, headers: baseHeaders });
  }
}
