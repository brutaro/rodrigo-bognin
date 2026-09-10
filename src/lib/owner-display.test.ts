import { describe, expect, it } from "vitest";
import { ownerDisplay } from "./owner-display";

describe("nome comercial exibido", () => {
  it("apresenta a identidade antiga como XCON sem alterar o registro original", () => {
    const record = { actor: "Rodrigo", origin: "Informado por Rodrigo" };
    expect(ownerDisplay(record.actor)).toBe("XCON");
    expect(ownerDisplay(record.origin)).toBe("Informado por XCON");
    expect(record).toEqual({ actor: "Rodrigo", origin: "Informado por Rodrigo" });
  });

  it("preserva outros nomes e aceita campos vazios", () => {
    expect(ownerDisplay("Mariana")).toBe("Mariana");
    expect(ownerDisplay("Rodrigues")).toBe("Rodrigues");
    expect(ownerDisplay(null)).toBe("");
    expect(ownerDisplay(undefined)).toBe("");
  });
});
