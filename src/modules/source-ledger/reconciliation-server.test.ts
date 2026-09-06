import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database", () => ({ isDatabaseConfigured: () => true, getSql: () => ({}) }));
vi.mock("@/lib/auth-secret", () => ({ readSessionKey: () => { throw new Error("Secret obrigatório ausente: TRIA_SESSION_KEY_FILE."); } }));

import { getSourceReconciliationService } from "./reconciliation-server";

describe("composição server-only da reconciliação", () => {
  beforeEach(() => { globalThis.triaSourceReconciliationService = undefined; });

  it("falha fechada quando a chave server-side não está disponível", () => {
    expect(() => getSourceReconciliationService()).toThrow("Secret obrigatório ausente: TRIA_SESSION_KEY_FILE.");
    expect(globalThis.triaSourceReconciliationService).toBeUndefined();
  });
});
