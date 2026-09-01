import { NextResponse, type NextRequest } from "next/server";
import { readSessionKey } from "./lib/auth-secret";
import { sessionCookieName, sessionIdHash, verifySessionTokenPayload } from "./lib/auth-token";
import { getSql, isDatabaseConfigured } from "./lib/database";
import { boundaryAllowsRequest, resolveRequestBoundary } from "./lib/request-boundary";

const publicAssets = new Set(["/favicon.ico", "/file.svg", "/vercel.svg", "/next.svg", "/globe.svg", "/window.svg"]);
export function isPublicPath(pathname: string) {
  return pathname === "/entrar" || pathname === "/api/health" || pathname.startsWith("/_next/") || publicAssets.has(pathname);
}

export async function proxy(request: NextRequest) {
  const boundary = resolveRequestBoundary({
    host: request.headers.get("host") ?? request.nextUrl.host,
    directProtocol: request.nextUrl.protocol,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProtocol: request.headers.get("x-forwarded-proto"),
  });
  if (!boundaryAllowsRequest(boundary)) return new NextResponse("TLS obrigatório.", { status: 426 });
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  let valid = false;
  try {
    const key = readSessionKey();
    const payload = verifySessionTokenPayload(request.cookies.get(sessionCookieName)?.value, key);
    if (payload && isDatabaseConfigured()) {
      const [session] = await getSql()`SELECT 1 FROM owner_session
        WHERE id_hash = ${sessionIdHash(payload.jti, key)} AND revoked_at IS NULL AND expires_at > now()`;
      valid = Boolean(session);
    }
  } catch { return new NextResponse("Autenticação indisponível.", { status: 503 }); }
  if (valid) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "Não autenticado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const login = new URL("/entrar", request.url);
  return NextResponse.redirect(login);
}

export const config = { matcher: "/:path*" };
