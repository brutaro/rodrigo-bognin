import { describe, expect, it } from "vitest";
import { assertFiscalRelationTuple, assertRevision, durationSecondsToInput, parseDurationToSeconds, parseFiscalBrlDecimal, parseIsoDate, parseOptionalFiscalBrlDecimal, parseSignedBrlDecimal } from "./source-adjustment-validation";

describe("valores de ajustes", () => {
  it("preserva ausência, zero e horas acima de 24", () => {
    expect(parseDurationToSeconds("missing", "99:00")).toBeNull();
    expect(parseDurationToSeconds("present", "0:00")).toBe("0");
    expect(parseDurationToSeconds("present", "30:15")).toBe("108900");
    expect(parseDurationToSeconds("present", "30:15:59")).toBe("108959");
    expect(durationSecondsToInput("108959")).toBe("30:15:59");
  });
  it("aceita medição BRL assinada sem derivar das horas", () => {
    expect(parseSignedBrlDecimal("present", "-R$ 1.234,50")).toBe("-1234.50");
    expect(parseSignedBrlDecimal("present", "0,00")).toBe("0.00");
    expect(parseSignedBrlDecimal("present", "-12345678901234,1234567890123456")).toBe("-12345678901234.1234567890123456");
    expect(parseSignedBrlDecimal("missing", "0,00")).toBeNull();
  });
  it("mantém valor fiscal não negativo", () => {
    expect(parseFiscalBrlDecimal("1.234,56")).toBe("1234.56");
    expect(() => parseFiscalBrlDecimal("-1,00")).toThrow();
    expect(() => parseOptionalFiscalBrlDecimal("-1,00")).toThrow();
  });
  it("valida a coerência da relação fiscal", () => {
    expect(() => assertFiscalRelationTuple({ amount: "100.00", candidateProjectId: null, relationStrength: "Forte",
      relationState: "Informado", criterion: null, fullValueEligible: null, verifiedRelatedValue: null })).toThrow();
    expect(() => assertFiscalRelationTuple({ amount: "100.00", candidateProjectId: "P-1", relationStrength: "Forte",
      relationState: "Informado", criterion: null, fullValueEligible: true, verifiedRelatedValue: "99.99" })).toThrow();
    expect(() => assertFiscalRelationTuple({ amount: "100.00", candidateProjectId: "P-1", relationStrength: "Forte",
      relationState: "Informado", criterion: null, fullValueEligible: false, verifiedRelatedValue: "100.00" })).toThrow();
  });
  it("recusa minutos e formatos ambíguos", () => {
    expect(() => parseDurationToSeconds("present", "25:60")).toThrow();
    expect(() => parseSignedBrlDecimal("present", "1,234.567")).toThrow();
  });
  it("recusa datas civis e revisões fora de bigint", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(() => parseIsoDate("2025-02-29")).toThrow();
    expect(() => parseIsoDate("2025-02-31")).toThrow();
    expect(() => assertRevision("9223372036854775808")).toThrow();
  });

});
