import { apiAuthenticationStatus, assertSameOrigin } from "@/lib/auth";
import { getSql } from "@/lib/database";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await apiAuthenticationStatus() !== "authenticated") return new Response(null, { status: 401 });
  try {
    await assertSameOrigin(request);
    await getSql()`UPDATE project SET last_opened_at=now() WHERE id=${(await params).id}`;
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 400 }); }
}
