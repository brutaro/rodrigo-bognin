import { afterEach, describe, expect, it } from "vitest";
import { boundaryAllowsRequest, resolveRequestBoundary } from "./request-boundary";

const originalLocal = process.env.TRIA_LOCAL_HOSTS;
afterEach(() => { process.env.TRIA_LOCAL_HOSTS = originalLocal; });

describe("fronteira de transporte", () => {
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
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "tria.example", forwardedProtocol: "https" }, true);
    expect(boundary).toMatchObject({ host: "tria.example", protocol: "https", local: false, secure: true });
    expect(boundaryAllowsRequest(boundary)).toBe(true);
  });
  it("recusa conjunto encaminhado incompleto", () => {
    const missingHost = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedProtocol: "https" }, true);
    const missingProtocol = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "tria.example" }, true);
    expect(boundaryAllowsRequest(missingHost)).toBe(false); expect(boundaryAllowsRequest(missingProtocol)).toBe(false);
  });
  it("não trata host encaminhado como ambiente local", () => {
    process.env.TRIA_LOCAL_HOSTS = "app:3000";
    const boundary = resolveRequestBoundary({ host: "app:3000", directProtocol: "http", forwardedHost: "app:3000", forwardedProtocol: "https" }, true);
    expect(boundary).toMatchObject({ local: false, secure: true });
  });
});
