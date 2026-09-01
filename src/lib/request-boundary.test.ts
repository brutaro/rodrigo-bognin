import { afterEach, describe, expect, it } from "vitest";
import { boundaryAllowsRequest, resolveRequestBoundary } from "./request-boundary";

const originalLocal = process.env.TRIA_LOCAL_HOSTS;
const originalPublic = process.env.TRIA_PUBLIC_HOSTS;
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
afterEach(() => { restore("TRIA_LOCAL_HOSTS", originalLocal); restore("TRIA_PUBLIC_HOSTS", originalPublic); });

describe("fronteira de transporte", () => {
  function trust(host = "tria.example") { process.env.TRIA_PUBLIC_HOSTS = host; }
  it("ignora cabeçalhos encaminhados no modo direto", () => {
    const boundary = resolveRequestBoundary({ host: "tria.example", directProtocol: "http", forwardedHost: "localhost", forwardedProtocol: "https" }, false);
    expect(boundary).toMatchObject({ host: "tria.example", protocol: "http", local: false, secure: false });
    expect(boundaryAllowsRequest(boundary)).toBe(false);
  });
  it("aceita somente host local configurado no Compose", () => {
    process.env.TRIA_LOCAL_HOSTS = "app:3000";
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedProtocol: "https" }, false);
    expect(boundary.local).toBe(true); expect(boundaryAllowsRequest(boundary)).toBe(true);
  });
  it("usa host e HTTPS encaminhados somente no modo proxy explícito", () => {
    trust();
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "tria.example", forwardedProtocol: "https" }, true);
    expect(boundary).toMatchObject({ host: "tria.example", protocol: "https", local: false, secure: true });
    expect(boundaryAllowsRequest(boundary)).toBe(true);
  });
  it("recusa qualquer ausência de headers quando a confiança no proxy está ativa", () => {
    trust();
    const missingBoth = resolveRequestBoundary({ host: "app:3000", directProtocol: "http" }, true);
    expect(boundaryAllowsRequest(missingBoth)).toBe(false);
  });
  it("recusa conjunto encaminhado incompleto", () => {
    trust();
    const missingHost = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedProtocol: "https" }, true);
    const missingProtocol = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "tria.example" }, true);
    expect(boundaryAllowsRequest(missingHost)).toBe(false); expect(boundaryAllowsRequest(missingProtocol)).toBe(false);
  });
  it("recusa host encaminhado fora da lista pública", () => {
    trust("tria.example");
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "evil.example", forwardedProtocol: "https" }, true);
    expect(boundaryAllowsRequest(boundary)).toBe(false);
  });
  it("não trata host encaminhado como ambiente local", () => {
    process.env.TRIA_LOCAL_HOSTS = "app:3000";
    trust("app:3000");
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "app:3000", forwardedProtocol: "https" }, true);
    expect(boundary).toMatchObject({ local: false, secure: true });
  });
});
