import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  realSourceUploadEnabled,
  consolidatedSourceUploadEnabled,
  consolidatedSourceUploadLimitBytes,
  receiveConsolidatedSource,
  validateConsolidatedSourceUploadMetadata,
} from "./consolidated-source-repository";

const originalMode = process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD;
const originalIsolation = process.env.TRIA_INTEGRATION_ISOLATED;
const originalNamespace = process.env.TRIA_INTEGRATION_NAMESPACE;
const originalRuntime = process.env.TRIA_RUNTIME;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("TRIA_CONSOLIDATED_SOURCE_UPLOAD", originalMode);
  restore("TRIA_INTEGRATION_ISOLATED", originalIsolation);
  restore("TRIA_INTEGRATION_NAMESPACE", originalNamespace);
  restore("TRIA_RUNTIME", originalRuntime);
});

describe("admissão da base consolidada", () => {
  it.each([
    ["base.xls", "XLS"],
    ["BASE.XLSX", "XLSX"],
    ["aplicacao.csv", "CSV"],
  ])("aceita %s sem inspecionar MIME e deriva o formato da extensão", (originalName, format) => {
    expect(validateConsolidatedSourceUploadMetadata({
      originalName,
      declaredSize: "17",
      transportSize: "17",
      mediaType: "application/x-unexpected",
    })).toEqual({ originalName, expectedSize: 17, format, mediaType: "application/x-unexpected" });
  });

  it.each([
    "base.xlsm",
    "base.xlsb",
    "base.zip",
    "base.exe",
    "base.xlsx.csv",
    "base.csv.exe",
    "base\u0000.csv",
    "../base.csv",
    "base/arquivo.csv",
  ])("recusa nome ou extensão perigosa: %s", (originalName) => {
    expect(() => validateConsolidatedSourceUploadMetadata({
      originalName,
      declaredSize: "1",
      transportSize: "1",
      mediaType: "text/plain",
    })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it.each([
    [null, "1"],
    ["1", null],
    ["", "1"],
    ["0", "0"],
    ["1.5", "1.5"],
    ["2", "1"],
  ])("recusa tamanho ausente, zero, inválido ou divergente (%s/%s)", (declaredSize, transportSize) => {
    expect(() => validateConsolidatedSourceUploadMetadata({
      originalName: "base.csv",
      declaredSize,
      transportSize,
      mediaType: "text/csv",
    })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("recusa a declaração acima de 50 MiB com erro específico", () => {
    const oversized = String(consolidatedSourceUploadLimitBytes + 1);
    expect(() => validateConsolidatedSourceUploadMetadata({
      originalName: "base.xlsx",
      declaredSize: oversized,
      transportSize: oversized,
      mediaType: null,
    })).toThrow(expect.objectContaining({ code: "too-large" }));
  });
});

describe("gate de fixtures sintéticas", () => {
  it("permanece desativado por padrão e com configuração parcial", () => {
    delete process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD;
    delete process.env.TRIA_INTEGRATION_ISOLATED;
    delete process.env.TRIA_INTEGRATION_NAMESPACE;
    expect(consolidatedSourceUploadEnabled()).toBe(false);
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    expect(consolidatedSourceUploadEnabled()).toBe(false);
  });

  it("abre somente no namespace isolado permitido", () => {
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "synthetic-fixtures-only";
    process.env.TRIA_INTEGRATION_ISOLATED = "confirmed";
    process.env.TRIA_INTEGRATION_NAMESPACE = "tria-evidence-fixture";
    expect(consolidatedSourceUploadEnabled()).toBe(true);
    process.env.TRIA_RUNTIME = "railway";
    expect(consolidatedSourceUploadEnabled()).toBe(false);
    delete process.env.TRIA_RUNTIME;
    process.env.TRIA_INTEGRATION_NAMESPACE = "production";
    expect(consolidatedSourceUploadEnabled()).toBe(false);
  });

  it("protege também a chamada direta ao repositório", async () => {
    delete process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD;
    delete process.env.TRIA_INTEGRATION_ISOLATED;
    delete process.env.TRIA_INTEGRATION_NAMESPACE;
    await expect(receiveConsolidatedSource({
      originalName: "fixture.csv",
      declaredSize: "1",
      transportSize: "1",
      mediaType: "text/csv",
      body: null,
    })).rejects.toMatchObject({ code: "disabled" });
  });
});


describe("importação do proprietário em produção", () => {
  it("exige habilitação explícita no Railway e mantém fixtures bloqueadas", () => {
    process.env.TRIA_RUNTIME = "railway";
    for (const mode of ["local-owner", "synthetic-fixtures-only", "disabled", ""]) {
      process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = mode;
      expect(realSourceUploadEnabled()).toBe(false);
      expect(consolidatedSourceUploadEnabled()).toBe(false);
    }
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "authenticated-owner";
    expect(realSourceUploadEnabled()).toBe(true);
    expect(consolidatedSourceUploadEnabled()).toBe(true);
    process.env.TRIA_RUNTIME = "local";
    expect(realSourceUploadEnabled()).toBe(false);
    process.env.TRIA_CONSOLIDATED_SOURCE_UPLOAD = "local-owner";
    expect(realSourceUploadEnabled()).toBe(true);
  });
});
