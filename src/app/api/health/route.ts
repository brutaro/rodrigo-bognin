import { getSql, isDatabaseConfigured } from "@/lib/database";
import { fileQuotaBytes } from "@/lib/file-repository";
import { inspectFileStore, inspectStoredObjectMetadata } from "@/lib/file-store";

export const dynamic = "force-dynamic";

// Disponibilidade verifica dependências; conferência da carga pertence ao db:validate.
export async function GET() {
  if (!isDatabaseConfigured()) return Response.json({ status: "unavailable", reason: "database" }, { status: 503 });
  try {
    const sql = getSql();
    const [counter] = await sql`SELECT quota_bytes::text, used_bytes::text, reserved_bytes::text, volume_uuid::text,
      (SELECT coalesce(sum(size_bytes),0)::text FROM file_version) catalog_bytes FROM file_store_counter WHERE singleton`;
    const store = await inspectFileStore({ probe: false });
    if (!store.ok || !counter || counter.volume_uuid !== store.uuid) return Response.json({ status: "unavailable", reason: "file-store" }, { status: 503 });
    const objects = await sql<{ object_key: string; size_bytes: string }[]>`SELECT object_key::text, size_bytes::text FROM file_version WHERE status = 'active'`;
    const valid = await inspectStoredObjectMetadata(objects.map(row => ({ objectKey: row.object_key, sizeBytes: Number(row.size_bytes) })));
    if (!valid || counter.used_bytes !== counter.catalog_bytes || Number(counter.quota_bytes) !== fileQuotaBytes) {
      return Response.json({ status: "unavailable", reason: "catalog" }, { status: 503 });
    }
    return Response.json({ status: process.env.TRIA_MAINTENANCE_MODE === "enabled" ? "maintenance" : "ok", release: process.env.TRIA_RELEASE_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
  } catch { return Response.json({ status: "unavailable", reason: "database" }, { status: 503 }); }
}
