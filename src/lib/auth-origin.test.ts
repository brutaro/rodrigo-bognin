import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isTrustedRequestOrigin } from "./auth";

describe("origem de mutações", () => {
  it("aceita loopback HTTP com host exato", () => {
    expect(isTrustedRequestOrigin("http://127.0.0.1:3100", "127.0.0.1:3100", null)).toBe(true);
    expect(isTrustedRequestOrigin("http://localhost:3100", "localhost:3100", "http")).toBe(true);
  });
  it("exige HTTPS encaminhado fora do loopback", () => {
    expect(isTrustedRequestOrigin("https://tria.example", "tria.example", "https")).toBe(true);
    expect(isTrustedRequestOrigin("https://tria.example", "tria.example", "http")).toBe(false);
    expect(isTrustedRequestOrigin("http://tria.example", "tria.example", "https")).toBe(false);
  });
  it("recusa origem ausente, malformada ou host diferente", () => {
    expect(isTrustedRequestOrigin(null, "tria.example", "https")).toBe(false);
    expect(isTrustedRequestOrigin("não-é-url", "tria.example", "https")).toBe(false);
    expect(isTrustedRequestOrigin("https://tria.example/path", "tria.example", "https")).toBe(false);
    expect(isTrustedRequestOrigin("ftp://127.0.0.1:3100", "127.0.0.1:3100", "ftp")).toBe(false);
    expect(isTrustedRequestOrigin("https://evil.example", "tria.example", "https")).toBe(false);
  });
});
