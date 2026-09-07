import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalStringify, sha256Canonical, sha256ImportCanonical } from "../shared/hash-canonical";

describe("RFC 8785 do source-ledger", () => {
  it("ordena propriedades e usa a representação numérica JCS", () => {
    expect(canonicalStringify({ b: 2, a: 1, zero: -0, text: "é" })).toBe('{"a":1,"b":2,"text":"é","zero":0}');
    const canonical = canonicalStringify({ value: 1e-7 });
    expect(canonical).toBe('{"value":1e-7}');
    expect(sha256Canonical({ a: 1 })).toBe(createHash("sha256").update('{"a":1}', "utf8").digest("hex"));
  });

  it("preserva ordem de arrays JCS e ordena conjuntos por regra declarada", () => {
    expect(canonicalStringify({a:[2,1]})).toBe('{"a":[2,1]}');
    const options = { arrayComparatorForPath: (path: string) => path === "$.items" ? (left: unknown, right: unknown) => Number((left as { ordinal: number }).ordinal) - Number((right as { ordinal: number }).ordinal) : undefined };
    const first = canonicalStringify({ items: [{ ordinal: 2, value: "b" }, { ordinal: 1, value: "a" }] }, options);
    const second = canonicalStringify({ items: [{ value: "a", ordinal: 1 }, { value: "b", ordinal: 2 }] }, options);
    expect(first).toBe(second);
    expect(sha256ImportCanonical({ rows: [{ locator: "row:3" }, { locator: "row:2" }] })).toBe(sha256ImportCanonical({ rows: [{ locator: "row:2" }, { locator: "row:3" }] }));
  });

  it("rejeita números não reproduzíveis", () => {
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow();
    expect(() => canonicalStringify({ value: BigInt(1) })).toThrow();
  });
});
