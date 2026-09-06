import "server-only";

import { getSql, isDatabaseConfigured } from "@/lib/database";
import { readSessionKey } from "@/lib/auth-secret";
import { PostgresSourceReconciliationRepository } from "./adapters/postgres-reconciliation-repository";
import { SourceReconciliationService } from "./application/reconcile-import";

declare global { var triaSourceReconciliationService: SourceReconciliationService | undefined; }

export function getSourceReconciliationService() {
  if (!isDatabaseConfigured()) throw new Error("PostgreSQL não configurado.");
  if (!globalThis.triaSourceReconciliationService) globalThis.triaSourceReconciliationService = new SourceReconciliationService(new PostgresSourceReconciliationRepository(getSql(), readSessionKey()));
  return globalThis.triaSourceReconciliationService;
}
