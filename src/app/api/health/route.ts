import { getSql, isDatabaseConfigured } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured()) return Response.json({ status: "ok", mode: "demo" });
  try {
    const sql = getSql();
    const rows = await sql<{ projects: number }[]>`SELECT count(*)::int projects FROM project`;
    if (rows[0]?.projects !== 59) {
      return Response.json({ status: "initializing" }, { status: 503 });
    }
    return Response.json({ status: "ok", database: "available" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
