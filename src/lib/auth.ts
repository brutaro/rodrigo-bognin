import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql, isDatabaseConfigured } from "./database";
import { readLoginCode, readSessionKey } from "./auth-secret";
import { createSessionToken, sessionCookieName, sessionIdHash, verifySessionTokenPayload } from "./auth-token";
import { boundaryAllowsRequest, proxyTrustEnabled, resolveRequestBoundary, type RequestBoundary } from "./request-boundary";

const failureDelayMs = 750;
const blockMinutes = 15;
const maximumFailures = 5;

function constantTimeTextEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function clientHash(address: string) {
  return createHmac("sha256", readSessionKey()).update(address).digest("hex");
}

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function secureCookieForHost(host: string, protocol?: string | null) {
  const hostname = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "");
  if (loopback(hostname)) return false;
  if (protocol !== "https") throw new Error("TLS é obrigatório fora do loopback.");
  return true;
}

function boundaryFromHeaders(requestHeaders: Headers): RequestBoundary {
  return resolveRequestBoundary({
    host: requestHeaders.get("host"), directProtocol: "http",
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProtocol: requestHeaders.get("x-forwarded-proto"),
  });
}

export async function isAuthenticated() {
  try {
    const token = (await cookies()).get(sessionCookieName)?.value;
    const payload = verifySessionTokenPayload(token, readSessionKey());
    if (!payload || !isDatabaseConfigured()) return false;
    const sql = getSql();
    const [session] = await sql`SELECT 1 FROM owner_session
      WHERE id_hash = ${sessionIdHash(payload.jti, readSessionKey())} AND revoked_at IS NULL AND expires_at > now()`;
    return Boolean(session);
  } catch { return false; }
}

export async function requireAuthenticatedPage() {
  if (!(await isAuthenticated())) redirect("/entrar");
}

export async function requireAuthenticatedApi() {
  return isAuthenticated();
}

export function isTrustedRequestOrigin(
  origin: string | null, host: string | null, protocol: string | null, localOverride?: boolean, secureOverride?: boolean,
) {
  if (!origin || !host) return false;
  const protocolValue = (protocol ?? "http").replace(/:$/, "").toLowerCase();
  try {
    const parsed = new URL(origin);
    const local = localOverride ?? loopback(parsed.hostname);
    const secure = secureOverride ?? protocolValue === "https";
    return parsed.origin === origin && parsed.host === host &&
      ((local && (parsed.protocol === "http:" || parsed.protocol === "https:")) || (secure && parsed.protocol === "https:"));
  } catch { return false; }
}

export async function assertSameOrigin(request?: Request) {
  const requestHeaders = await headers();
  const boundary = boundaryFromHeaders(requestHeaders);
  const origin = request?.headers.get("origin") ?? requestHeaders.get("origin");
  if (!boundaryAllowsRequest(boundary) ||
      !isTrustedRequestOrigin(origin, boundary.host, boundary.protocol, boundary.local, boundary.secure)) {
    throw new Error("Origem inválida.");
  }
}

export async function verifyPermanentCode(candidate: string) {
  try {
    return constantTimeTextEqual(candidate, readLoginCode());
  } catch {
    return false;
  }
}

async function attemptPermanentCode(candidate: string, purpose: "login" | "purge") {
  const started = Date.now();
  let accepted = false;
  if (isDatabaseConfigured()) {
    const requestHeaders = await headers();
    const address = proxyTrustEnabled()
      ? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || "proxy-unknown"
      : "direct-local";
    const hashes = [clientHash(`${purpose}:${address}`), clientHash(`${purpose}:global`)];
    const sql = getSql();
    accepted = await sql.begin(async (tx) => {
      const rows = await tx<{ client_hash: string; failed_attempts: number; blocked: boolean }[]>`
        SELECT client_hash, failed_attempts, blocked_until > now() blocked
        FROM auth_login_throttle WHERE client_hash IN ${tx(hashes)} FOR UPDATE`;
      if (rows.some((row) => row.client_hash === hashes[0] && row.blocked)) return false;
      const codeMatches = await verifyPermanentCode(candidate);
      if (codeMatches) {
        await tx`DELETE FROM auth_login_throttle WHERE client_hash IN ${tx(hashes)}`;
        return true;
      }
      for (const [index, hash] of hashes.entries()) {
        const hardBlock = index === 0;
        await tx`INSERT INTO auth_login_throttle (client_hash, failed_attempts, blocked_until, updated_at)
          VALUES (${hash}, 1, NULL, now())
          ON CONFLICT (client_hash) DO UPDATE SET
            failed_attempts = auth_login_throttle.failed_attempts + 1,
            blocked_until = CASE WHEN ${hardBlock} AND auth_login_throttle.failed_attempts + 1 >= ${maximumFailures}
              THEN now() + (${blockMinutes} || ' minutes')::interval ELSE auth_login_throttle.blocked_until END,
            updated_at = now()`;
      }
      return false;
    });
  }
  if (!accepted) {
    const remaining = failureDelayMs - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return accepted;
}

export function attemptLogin(candidate: string) {
  return attemptPermanentCode(candidate, "login");
}

export function attemptPurgeConfirmation(candidate: string) {
  return attemptPermanentCode(candidate, "purge");
}

export async function establishSession() {
  const boundary = boundaryFromHeaders(await headers());
  if (!boundaryAllowsRequest(boundary)) throw new Error("TLS é obrigatório fora do ambiente local.");
  const secure = !boundary.local;
  const token = createSessionToken(readSessionKey());
  const payload = verifySessionTokenPayload(token, readSessionKey());
  if (!payload || !isDatabaseConfigured()) throw new Error("Sessão indisponível.");
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM owner_session WHERE expires_at <= now()`;
    await tx`INSERT INTO owner_session (id_hash, created_at, expires_at, revoked_at)
      VALUES (${sessionIdHash(payload.jti, readSessionKey())}, to_timestamp(${payload.iat} / 1000.0), to_timestamp(${payload.exp} / 1000.0), NULL)`;
  });
  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export async function endSession() {
  const boundary = boundaryFromHeaders(await headers());
  if (!boundaryAllowsRequest(boundary)) throw new Error("TLS é obrigatório fora do ambiente local.");
  const cookieStore = await cookies();
  const payload = verifySessionTokenPayload(cookieStore.get(sessionCookieName)?.value, readSessionKey());
  if (payload && isDatabaseConfigured()) {
    const sql = getSql();
    await sql`UPDATE owner_session SET revoked_at = now() WHERE id_hash = ${sessionIdHash(payload.jti, readSessionKey())} AND revoked_at IS NULL`;
  }
  cookieStore.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: !boundary.local,
    path: "/",
    maxAge: 0,
  });
}
