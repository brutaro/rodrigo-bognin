import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authentication: vi.fn(),
  sameOrigin: vi.fn(),
  enabled: vi.fn(),
  receive: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  apiAuthenticationStatus: mocks.authentication,
  assertSameOrigin: mocks.sameOrigin,
}));
vi.mock("@/lib/file-repository", () => ({
  FileRepositoryError: class FileRepositoryError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  },
}));
vi.mock("@/lib/file-store", () => ({
  FileStoreError: class FileStoreError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  },
}));
vi.mock("@/lib/consolidated-source-repository", () => {
  class ConsolidatedSourceUploadError extends Error {
    constructor(message: string, readonly code: "invalid" | "too-large" | "disabled") { super(message); }
  }
  return {
    ConsolidatedSourceUploadError,
    consolidatedSourceUploadEnabled: mocks.enabled,
    receiveConsolidatedSource: mocks.receive,
    sanitizedConsolidatedSourceReceipt: (receipt: Record<string, unknown>) => ({
      receiptId: receipt.receiptId,
      format: receipt.format,
      sizeBytes: receipt.sizeBytes,
      receivedAt: receipt.receivedAt,
      status: "protected",
    }),
  };
});

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/sources/consolidated", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/octet-stream",
      "Content-Length": "3",
      "X-TRIA-File-Name": encodeURIComponent("fixture.XLSX"),
      "X-TRIA-File-Size": "3",
    },
    body: Buffer.from("abc"),
  });
}

beforeEach(() => {
  mocks.authentication.mockResolvedValue("authenticated");
  mocks.sameOrigin.mockResolvedValue(undefined);
  mocks.enabled.mockReturnValue(true);
  mocks.receive.mockResolvedValue({
    receiptId: "10000000-0000-4000-8000-000000000001",
    format: "XLSX",
    sizeBytes: 3,
    receivedAt: "2026-09-02T20:00:00.000Z",
    status: "protected",
    objectKey: "segredo",
    sha256: "segredo",
    originalName: "fixture.XLSX",
  });
});

afterEach(() => vi.clearAllMocks());

describe("POST /api/sources/consolidated", () => {
  it("falha fechado sem entregar o corpo ao repositório", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("exige sessão antes de avaliar o gate", async () => {
    mocks.authentication.mockResolvedValue("invalid");
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("exige mesma origem e responde sem cache", async () => {
    mocks.sameOrigin.mockRejectedValue(new Error("Origem inválida."));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("encaminha metadados e devolve somente o recibo sanitizado", async () => {
    const response = await POST(request());
    const receipt = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({
      originalName: "fixture.XLSX",
      declaredSize: "3",
      transportSize: "3",
      mediaType: "application/octet-stream",
    }));
    expect(receipt).toEqual({
      receiptId: "10000000-0000-4000-8000-000000000001",
      format: "XLSX",
      sizeBytes: 3,
      receivedAt: "2026-09-02T20:00:00.000Z",
      status: "protected",
    });
    expect(JSON.stringify(receipt)).not.toMatch(/objectKey|sha256|originalName|segredo/);
  });
});
