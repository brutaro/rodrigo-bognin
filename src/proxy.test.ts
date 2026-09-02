import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isPublicPath, isRailwayHealthcheck } from "./proxy";

describe("fronteira pública", () => {
  it.each(["/entrar", "/api/health", "/_next/static/app.js", "/favicon.ico"])("mantém %s público", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });
  it.each(["/", "/projetos", "/notas-fiscais", "/publicacoes/x", "/api/backups/files", "/api/files/x/download", "/api/projects/x/files", "/api/reports/projects/x", "/api/reports/global"])("protege %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("healthcheck interno Railway", () => {
  const request = { pathname: "/api/health", host: "healthcheck.railway.app", forwardedHost: null, forwardedProtocol: null };

  it("aceita somente o probe interno exato no runtime Railway", () => {
    expect(isRailwayHealthcheck(request, "railway")).toBe(true);
    expect(isRailwayHealthcheck({ ...request, host: "healthcheck.railway.app:8080" }, "railway")).toBe(true);
    expect(isRailwayHealthcheck({ ...request, forwardedHost: "healthcheck.railway.app", forwardedProtocol: "http" }, "railway")).toBe(true);
  });

  it("recusa o atalho fora do runtime Railway", () => {
    expect(isRailwayHealthcheck(request, "local")).toBe(false);
  });

  it("recusa host, caminho ou headers encaminhados divergentes", () => {
    expect(isRailwayHealthcheck({ ...request, host: "tria-production-1710.up.railway.app" }, "railway")).toBe(false);
    expect(isRailwayHealthcheck({ ...request, pathname: "/entrar" }, "railway")).toBe(false);
    expect(isRailwayHealthcheck({ ...request, forwardedHost: "healthcheck.railway.app", forwardedProtocol: "https" }, "railway")).toBe(false);
    expect(isRailwayHealthcheck({ ...request, forwardedHost: "healthcheck.railway.app" }, "railway")).toBe(false);
  });
});
