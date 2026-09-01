import { getSql, isDatabaseConfigured } from "@/lib/database";
import { fileQuotaBytes, reconcileFileStore, tryReconcileFileStore } from "@/lib/file-repository";
import { inspectFileStore, inspectStoredObjectMetadata } from "@/lib/file-store";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured()) return Response.json({ status: "unavailable" }, { status: 503 });
  try {
    await tryReconcileFileStore();
    const store = await inspectFileStore();
    if (!store.ok) return Response.json({ status: "unavailable" }, { status: 503 });
    const sql = getSql();
    const [row] = await sql<{ projects: number; quota_bytes: string; used_bytes: string; reserved_bytes: string; volume_uuid: string | null; catalog_bytes: string; object_keys: string[]; reserved_object_keys: string[] }[]>`
      SELECT (SELECT count(*)::int FROM project) projects, quota_bytes::text, used_bytes::text, reserved_bytes::text, volume_uuid::text,
        (SELECT coalesce(sum(size_bytes), 0)::text FROM file_version) catalog_bytes,
        (SELECT coalesce(array_agg(object_key::text ORDER BY object_key::text), ARRAY[]::text[]) FROM file_version) object_keys,
        (SELECT coalesce(array_agg(object_key::text ORDER BY object_key::text), ARRAY[]::text[]) FROM file_reservation
          WHERE status = 'reserved' AND expires_at > now()) reserved_object_keys
      FROM file_store_counter WHERE singleton`;
    const objects = await sql<{ object_key: string; size_bytes: string }[]>`
      SELECT object_key::text, size_bytes::text FROM file_version ORDER BY object_key`;
    const metadataValid = await inspectStoredObjectMetadata(objects.map((item) => ({ objectKey: item.object_key, sizeBytes: Number(item.size_bytes) })));
    const orphanKeys = store.objectKeys.filter((key) => !row.object_keys.includes(key) && !row.reserved_object_keys.includes(key));
    if (orphanKeys.length) {
      await reconcileFileStore();
      return Response.json({ status: "initializing" }, { status: 503 });
    }
    if (!metadataValid || row?.projects !== 59 || row.volume_uuid !== store.uuid || Number(row.quota_bytes) !== fileQuotaBytes || BigInt(row.used_bytes) !== BigInt(row.catalog_bytes) ||
        BigInt(row.used_bytes) + BigInt(row.reserved_bytes) >= BigInt(row.quota_bytes) || row.object_keys.some((key) => !store.objectKeys.includes(key)) ||
        store.objectKeys.some((key) => !row.object_keys.includes(key) && !row.reserved_object_keys.includes(key)) ||
        store.availableBytes < BigInt(row.quota_bytes) - BigInt(row.used_bytes) - BigInt(row.reserved_bytes)) {
      return Response.json({ status: "initializing" }, { status: 503 });
    }
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
