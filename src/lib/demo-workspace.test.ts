import { describe, expect, it } from "vitest";
import { formatBrlFromCents, parseBrlToCents } from "./demo-workspace";

describe("parseBrlToCents", () => {
  it.each([
    ["0", "0"],
    ["0,00", "0"],
    ["345,00", "34500"],
    ["1.234,56", "123456"],
    ["R$ 15.748,00", "1574800"],
    ["99.5", "9950"],
  ])("converte %s sem usar ponto flutuante", (input, expected) => {
    expect(parseBrlToCents(input)).toBe(expected);
  });

  it.each(["", "-1,00", "abc", "1,234", "1,2,3"])("rejeita %s", (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });
});

describe("formatBrlFromCents", () => {
  it.each([
    ["0", "R$ 0,00"],
    ["34500", "R$ 345,00"],
    ["123456", "R$ 1.234,56"],
    ["1574800", "R$ 15.748,00"],
  ])("formata %s como %s", (input, expected) => {
    expect(formatBrlFromCents(input)).toBe(expected);
  });
});
