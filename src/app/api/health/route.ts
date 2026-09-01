import { getSql, isDatabaseConfigured } from "@/lib/database";
import { fileQuotaBytes, reconcileFileStore, tryReconcileFileStore } from "@/lib/file-repository";
import { inspectFileStore, inspectStoredObjectMetadata } from "@/lib/file-store";

export const dynamic = "force-dynamic";

const isolated = process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" && /^tria-evidence-[a-z0-9_-]+$/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? "");
const expected = isolated ? {
  projects: Number(process.env.TRIA_EVIDENCE_EXPECTED_PROJECTS ?? 2), assets: Number(process.env.TRIA_EVIDENCE_EXPECTED_COUNT ?? 2),
  links: Number(process.env.TRIA_EVIDENCE_EXPECTED_LINKS ?? 3), bytes: String(process.env.TRIA_EVIDENCE_EXPECTED_TOTAL_BYTES ?? 5),
} : { projects: 59, assets: 53, links: 72, bytes: "1126834973" };


export async function GET() {
  if (!isDatabaseConfigured()) return Response.json({ status: "unavailable" }, { status: 503 });
  try {
    await tryReconcileFileStore();
    const store = await inspectFileStore();
    if (!store.ok) return Response.json({ status: "unavailable" }, { status: 503 });
    const sql = getSql();
    const [row] = await sql<{ projects: number; evidence_assets: number; evidence_links: number; evidence_versions: number;
      evidence_objects: number; evidence_bytes: string; resolvable_links: number; quota_bytes: string; used_bytes: string;
      reserved_bytes: string; volume_uuid: string | null; catalog_bytes: string; object_keys: string[]; reserved_object_keys: string[] }[]>`
      SELECT (SELECT count(*)::int FROM project) projects,
        (SELECT count(*)::int FROM evidence_asset) evidence_assets,
        (SELECT count(*)::int FROM project_evidence) evidence_links,
        (SELECT count(*)::int FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_versions,
        (SELECT count(DISTINCT object_key)::int FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_objects,
        (SELECT coalesce(sum(size_bytes), 0)::text FROM file_version WHERE evidence_asset_id IS NOT NULL AND status = 'active') evidence_bytes,
        (SELECT count(*)::int FROM project_evidence pe JOIN file_version v ON v.evidence_asset_id = pe.evidence_asset_id
          JOIN file_document d ON d.id = v.document_id WHERE v.status = 'active' AND d.status = 'active' AND d.document_kind = 'evidence') resolvable_links,
        quota_bytes::text, used_bytes::text, reserved_bytes::text, volume_uuid::text,
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
    if (!metadataValid || row?.projects !== expected.projects || row.evidence_assets !== expected.assets || row.evidence_links !== expected.links ||
        row.evidence_versions !== expected.assets || row.evidence_objects !== expected.assets || row.evidence_bytes !== expected.bytes || row.resolvable_links !== expected.links ||
        row.volume_uuid !== store.uuid || Number(row.quota_bytes) !== fileQuotaBytes || BigInt(row.used_bytes) !== BigInt(row.catalog_bytes) ||
        BigInt(row.used_bytes) + BigInt(row.reserved_bytes) >= BigInt(row.quota_bytes) || row.object_keys.some((key) => !store.objectKeys.includes(key)) ||
        store.objectKeys.some((key) => !row.object_keys.includes(key) && !row.reserved_object_keys.includes(key)) ||
        store.availableBytes < BigInt(row.quota_bytes) - BigInt(row.used_bytes) - BigInt(row.reserved_bytes)) {
      return Response.json({ status: "initializing" }, { status: 503 });
    }
    return Response.json({ status: process.env.TRIA_MAINTENANCE_MODE === "enabled" ? "maintenance" : "ok", release: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
