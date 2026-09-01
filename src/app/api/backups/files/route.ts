import { requireAuthenticatedApi } from "@/lib/auth";
import { createVerifiedFileBackup } from "@/lib/file-backup";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuthenticatedApi())) return new Response("Não autenticado.", { status: 401 });
  try {
    const backup = await createVerifiedFileBackup();
    const date = backup.manifest.createdAt.slice(0, 10);
    return new Response(backup.body, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="tria-file-backup-${date}.zip"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Backup cancelado: o cofre não passou na verificação.", { status: 503 });
  }
}
