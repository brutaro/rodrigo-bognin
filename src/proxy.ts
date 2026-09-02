import { NextResponse, type NextRequest } from "next/server";
import { readSessionKey } from "./lib/auth-secret";
import { sessionCookieName, sessionIdHash, verifySessionTokenPayload } from "./lib/auth-token";
import { getSql, isDatabaseConfigured } from "./lib/database";
import { boundaryAllowsRequest, resolveRequestBoundary } from "./lib/request-boundary";

const publicAssets = new Set(["/favicon.ico", "/file.svg", "/vercel.svg", "/next.svg", "/globe.svg", "/window.svg"]);
export function isPublicPath(pathname: string) {
  return pathname === "/entrar" || pathname === "/api/health" || pathname.startsWith("/_next/") || publicAssets.has(pathname);
}

export function isRailwayHealthcheck(input: {
  pathname: string; host: string | null; forwardedHost: string | null; forwardedProtocol: string | null;
}, runtime = process.env.TRIA_RUNTIME) {
  const normalizeHost = (value: string | null) => value?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  const host = normalizeHost(input.host);
  const forwardedHost = normalizeHost(input.forwardedHost);
  const forwardedProtocol = input.forwardedProtocol?.split(",")[0]?.trim().toLowerCase() ?? "";
  const directProbe = !forwardedHost && !forwardedProtocol;
  const nextProbe = forwardedHost === "healthcheck.railway.app" && forwardedProtocol === "http";
  return runtime === "railway" && input.pathname === "/api/health" && host === "healthcheck.railway.app" && (directProbe || nextProbe);
}

export async function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const railwayHealthcheck = isRailwayHealthcheck({ pathname: request.nextUrl.pathname, host, forwardedHost, forwardedProtocol });
  const boundary = resolveRequestBoundary({
    host,
    directProtocol: request.nextUrl.protocol,
    forwardedHost,
    forwardedProtocol,
  });
  if (!railwayHealthcheck && !boundaryAllowsRequest(boundary)) return new NextResponse("TLS obrigatório.", { status: 426 });
  if (process.env.TRIA_MAINTENANCE_MODE === "enabled" && request.nextUrl.pathname !== "/api/health" && request.nextUrl.pathname !== "/api/backups/files") {
    return new NextResponse("Manutenção em andamento.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
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
  } catch { return new NextResponse("Autenticação indisponível.", { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
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
