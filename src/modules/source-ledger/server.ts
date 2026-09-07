import "server-only";

import { getSql, isDatabaseConfigured } from "@/lib/database";
import { DatabaseSourceFileReader } from "./adapters/database-source-file-reader";
import { PostgresImportPreparationRepository } from "./adapters/postgres-import-preparation-repository";
import { createSourceLedgerService, type SourceLedgerService } from "./public";

declare global { var triaSourceLedgerService: SourceLedgerService | undefined; }

export function getSourceLedgerService() {
  if (!isDatabaseConfigured()) throw new Error("PostgreSQL não configurado.");
  if (!globalThis.triaSourceLedgerService) {
    globalThis.triaSourceLedgerService = createSourceLedgerService({
      reader: new DatabaseSourceFileReader(),
      repository: new PostgresImportPreparationRepository(getSql()),
    });
  }
  return globalThis.triaSourceLedgerService;
}
