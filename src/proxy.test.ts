import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isPublicPath } from "./proxy";

describe("fronteira pública", () => {
  it.each(["/entrar", "/api/health", "/_next/static/app.js", "/favicon.ico"])("mantém %s público", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });
  it.each(["/", "/projetos", "/notas-fiscais", "/publicacoes/x", "/api/backups/files", "/api/files/x/download", "/api/projects/x/files", "/api/reports/projects/x", "/api/reports/global"])("protege %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
