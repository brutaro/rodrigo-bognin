import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "tria_session";

function encode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, key: Buffer) {
  return encode(createHmac("sha256", key).update(payload).digest());
}

export function sessionIdHash(jti: string, key: Buffer) {
  return createHmac("sha256", key).update(`session:${jti}`).digest("hex");
}

export function createSessionToken(key: Buffer, now = Date.now(), lifetimeMs = 12 * 60 * 60 * 1000) {
  const payload = encode(JSON.stringify({ sub: "Rodrigo", iss: "tria-plano-b", aud: "tria-owner", ver: 1,
    iat: now, exp: now + lifetimeMs, jti: randomUUID() }));
  return `${payload}.${sign(payload, key)}`;
}

export type SessionTokenPayload = { sub: "Rodrigo"; iss: "tria-plano-b"; aud: "tria-owner"; ver: 1; iat: number; exp: number; jti: string };

export function verifySessionTokenPayload(token: string | undefined, key: Buffer, now = Date.now()): SessionTokenPayload | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return parsed.sub === "Rodrigo" && parsed.iss === "tria-plano-b" && parsed.aud === "tria-owner" && parsed.ver === 1 &&
      typeof parsed.iat === "number" && Number.isSafeInteger(parsed.iat) && parsed.iat <= now &&
      typeof parsed.exp === "number" && Number.isSafeInteger(parsed.exp) && parsed.exp > now &&
      typeof parsed.jti === "string" && /^[0-9a-f-]{36}$/i.test(parsed.jti) ? parsed as SessionTokenPayload : null;
  } catch { return null; }
}

export function verifySessionToken(token: string | undefined, key: Buffer, now = Date.now()) {
  return verifySessionTokenPayload(token, key, now) !== null;
}
