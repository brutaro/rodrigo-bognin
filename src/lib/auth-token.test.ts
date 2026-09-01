import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./auth-token";

describe("sessão autenticada", () => {
  const key = Buffer.alloc(32, 7);
  it("aceita a assinatura válida e recusa adulteração e expiração", () => {
    const token = createSessionToken(key, 1_000, 5_000);
    expect(verifySessionToken(token, key, 2_000)).toBe(true);
    expect(verifySessionToken(`${token}x`, key, 2_000)).toBe(false);
    expect(verifySessionToken(token, key, 6_001)).toBe(false);
    expect(verifySessionToken(token, Buffer.alloc(32, 8), 2_000)).toBe(false);
  });

  it("recusa token ausente, malformado, futuro e com payload inválido", () => {
    expect(verifySessionToken(undefined, key, 2_000)).toBe(false);
    expect(verifySessionToken("invalido", key, 2_000)).toBe(false);
    expect(verifySessionToken(createSessionToken(key, 3_000, 5_000), key, 2_000)).toBe(false);
    const token = createSessionToken(key, 1_000, 5_000);
    const [payload, signature] = token.split(".");
    expect(verifySessionToken(`${payload}.${signature}.extra`, key, 2_000)).toBe(false);
  });
});
