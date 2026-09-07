import "server-only";

import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { Preview, PreviewConfirmation } from "../domain/dtos";
import type { ImportPreparationRepository, RejectedPreparation, StoredConfirmation, StoredPreparedPreview } from "../application/repository";

export class ImportIdempotencyConflict extends Error {
  constructor() { super("A chave de idempotência já foi usada com outro pedido."); this.name = "ImportIdempotencyConflict"; }
}

function jsonValue(value: unknown) { return typeof value === "string" ? JSON.parse(value) : value; }

type PreviewRow = { preview: unknown; fingerprint: string; idempotency_key: string };
function storedPreview(row: PreviewRow | undefined) {
  return row ? { preview: jsonValue(row.preview) as Preview, fingerprint: row.fingerprint, idempotencyKey: row.idempotency_key } : undefined;
}

export class PostgresImportPreparationRepository implements ImportPreparationRepository {
  constructor(private readonly sql: Sql) {}

  async findPreparedByFingerprint(fingerprint: string) {
    const [row] = await this.sql<PreviewRow[]>`SELECT p.manifest preview, b.fingerprint, b.idempotency_key
      FROM src_import_batch b JOIN src_import_preview p ON p.batch_id = b.id
      WHERE b.status = 'Validado' AND b.fingerprint = ${fingerprint}`;
    return storedPreview(row);
  }

  async findPreparedByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.sql<PreviewRow[]>`SELECT p.manifest preview, b.fingerprint, b.idempotency_key
      FROM src_import_batch b JOIN src_import_preview p ON p.batch_id = b.id
      WHERE b.status = 'Validado' AND (b.idempotency_key = ${idempotencyKey} OR EXISTS (SELECT 1 FROM src_import_request r WHERE r.operation='prepare' AND r.idempotency_key=${idempotencyKey} AND r.batch_id=b.id))`;
    return storedPreview(row);
  }

  async findRejectedByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.sql<Array<{ batch_id: string; source_file_id: string; file_version_id: string; source_sha256: string; source_format: string; actor: "Rodrigo"; idempotency_key: string; fingerprint: string; code: string; message: string; request_id: string }>>`SELECT id::text batch_id, source_file_id::text source_file_id, file_version_id::text file_version_id,
      source_sha256, source_format, actor, idempotency_key, fingerprint,
      coalesce(rejection_code, 'IMPORT_REJECTED') code, coalesce(rejection_message, 'A preparação foi rejeitada.') message,
      request_id::text
      FROM src_import_batch b WHERE status = 'Rejeitado' AND (idempotency_key = ${idempotencyKey} OR EXISTS (SELECT 1 FROM src_import_request r WHERE r.operation='prepare' AND r.idempotency_key=${idempotencyKey} AND r.batch_id=b.id))`;
    return row ? { batchId: row.batch_id, sourceFileId: row.source_file_id, fileVersionId: row.file_version_id, sourceSha256: row.source_sha256, sourceFormat: row.source_format, actor: row.actor, requestId: row.request_id, idempotencyKey: row.idempotency_key, fingerprint: row.fingerprint, code: row.code, message: row.message } : undefined;
  }

  async findPreview(previewId: string) {
    const [row] = await this.sql<PreviewRow[]>`SELECT p.manifest preview, b.fingerprint, b.idempotency_key
      FROM src_import_preview p JOIN src_import_batch b ON b.id = p.batch_id WHERE p.id = ${previewId}`;
    return storedPreview(row);
  }

  async savePrepared(value: StoredPreparedPreview) {
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:key:" + value.idempotencyKey}, 7824001))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:fingerprint:" + value.fingerprint}, 7824001))`;
      await this.claimKey(tx, 'prepare', value.idempotencyKey, value.fingerprint);
      const [byKey] = await tx<PreviewRow[]>`SELECT p.manifest preview, b.fingerprint, b.idempotency_key
        FROM src_import_batch b JOIN src_import_preview p ON p.batch_id = b.id
        WHERE b.idempotency_key = ${value.idempotencyKey}`;
      if (byKey) {
        if (byKey.fingerprint !== value.fingerprint) throw new ImportIdempotencyConflict();
        return storedPreview(byKey)!;
      }
      const [rejected] = await tx<Array<{ fingerprint: string }>>`SELECT fingerprint FROM src_import_batch WHERE status = 'Rejeitado' AND (idempotency_key = ${value.idempotencyKey} OR fingerprint = ${value.fingerprint})`;
      if (rejected) throw new ImportIdempotencyConflict();
      const [byFingerprint] = await tx<PreviewRow[]>`SELECT p.manifest preview, b.fingerprint, b.idempotency_key
        FROM src_import_batch b JOIN src_import_preview p ON p.batch_id = b.id WHERE b.fingerprint = ${value.fingerprint}`;
      if (byFingerprint) { const winner = storedPreview(byFingerprint)!; await this.bindKey(tx, 'prepare', value.idempotencyKey, value.fingerprint, winner.preview.batchId, winner.preview.previewId); return winner; }

      const [existingContract] = await tx<Array<{ id: string }>>`SELECT id::text FROM src_import_contract WHERE contract_hash = ${value.preview.contractHash}`;
      const insertedContracts = existingContract ? [] : await tx<Array<{ id: string }>>`INSERT INTO src_import_contract
        (id, contract_hash, source_format, sheet_selection, csv_parse_options, schema_id, parser_profile_id,
         transformation_id, limits_profile_id, schema_version, parser_version, transformation_version,
         transformation_hash, header_mapping, ignored_columns, limits, contract_payload)
        VALUES (${randomUUID()}, ${value.preview.contractHash}, ${value.preview.sourceFormat},
          ${value.preview.sheetSelection ? tx.json(value.preview.sheetSelection) : null},
          ${value.preview.csvParseOptions ? tx.json(value.preview.csvParseOptions) : null},
          ${value.preview.registry.schemaId}, ${value.preview.registry.parserProfileId}, ${value.preview.registry.transformationId},
          ${value.preview.registry.limitsProfileId}, ${value.preview.schemaVersion}, ${value.preview.parserVersion},
          ${value.preview.transformationVersion}, ${value.preview.transformationHash}, ${tx.json(value.preview.contract.headerMapping)},
          ${tx.json(value.preview.contract.ignoredColumns)}, ${tx.json(value.preview.contract.limits)}, ${tx.json(value.preview.contract)})
        ON CONFLICT (contract_hash) DO NOTHING RETURNING id::text`;
      let contractId = existingContract?.id ?? insertedContracts[0]?.id;
      if (!contractId) {
        const [retrieved] = await tx<Array<{ id: string }>>`SELECT id::text FROM src_import_contract WHERE contract_hash = ${value.preview.contractHash}`;
        if (!retrieved) throw new Error("Contrato de preparação não pôde ser persistido.");
        contractId = retrieved.id;
      }
      const [batch] = await tx<Array<{ id: string }>>`INSERT INTO src_import_batch
        (id, source_file_id, file_version_id, source_sha256, source_format, actor, prepared_at, retain_until, status,
         fingerprint, idempotency_key, contract_id, found_count, valid_count, error_count, rejected_count)
        VALUES (${value.preview.batchId}, ${value.preview.sourceFileId}, ${value.preview.fileVersionId}, ${value.preview.sourceSha256},
          ${value.preview.sourceFormat}, ${value.preview.actor}, ${value.preview.preparedAt}, ${value.preview.retainUntil}, 'Validado',
          ${value.fingerprint}, ${value.idempotencyKey}, ${contractId}, ${value.preview.summary.found}, ${value.preview.summary.valid},
          ${value.preview.summary.withError}, ${value.preview.summary.rejected})
        RETURNING id::text`;
      if (!batch) throw new Error("Batch não persistido");
      for (const row of value.preview.rows) await tx`INSERT INTO src_import_staging_row
        (id, batch_id, locator, source_row_hash, normalized_payload, source_values, decimal_sources, duration_sources, matching_attributes, status, field_errors, retain_until)
        VALUES (${randomUUID()}, ${value.preview.batchId}, ${row.locator}, ${row.sourceRowHash}, ${tx.json(row.normalizedPayload)}, ${tx.json(row.sourceValues)}, ${tx.json(row.decimalSources)}, ${row.durationSources === undefined ? null : tx.json(row.durationSources)}, ${tx.json(row.matchingAttributes ?? {})}, ${row.status}, ${tx.json(row.fieldErrors)}, ${value.preview.retainUntil})`;
      await tx`INSERT INTO src_import_preview
        (id, batch_id, source_file_id, file_version_id, source_sha256, source_format, contract_id, contract_hash, transformation_hash,
         content_hash, row_result_hash, preview_hash, manifest, summary, prepared_at, retain_until)
        VALUES (${value.preview.previewId}, ${value.preview.batchId}, ${value.preview.sourceFileId}, ${value.preview.fileVersionId},
          ${value.preview.sourceSha256}, ${value.preview.sourceFormat}, ${contractId}, ${value.preview.contractHash}, ${value.preview.transformationHash},
          ${value.preview.contentHash}, ${value.preview.rowResultHash}, ${value.preview.previewHash}, ${tx.json(value.preview)},
          ${tx.json(value.preview.summary)}, ${value.preview.preparedAt}, ${value.preview.retainUntil})`;
      await tx`INSERT INTO src_import_event
        (id, event_type, entity_id, batch_id, preview_id, actor, request_id, occurred_at, payload)
        VALUES (${randomUUID()}, 'source.import.preview_prepared.v1', ${value.preview.previewId}, ${value.preview.batchId},
          ${value.preview.previewId}, ${value.preview.actor}, ${value.requestId ?? null}, ${value.preview.preparedAt},
          ${tx.json({ contentHash: value.preview.contentHash, rowResultHash: value.preview.rowResultHash, previewHash: value.preview.previewHash })})`;
      await this.bindKey(tx, 'prepare', value.idempotencyKey, value.fingerprint, value.preview.batchId, value.preview.previewId);
      return value;
    });
  }

  private async claimKey(tx: TransactionSql, operation: string, key: string, fingerprint: string) {
    const [request] = await tx<Array<{ fingerprint: string }>>`SELECT fingerprint FROM src_import_request WHERE operation=${operation} AND idempotency_key=${key}`;
    if (request && request.fingerprint !== fingerprint) throw new ImportIdempotencyConflict();
  }

  private async bindKey(tx: TransactionSql, operation: string, key: string, fingerprint: string, batchId: string, previewId: string | null) {
    await tx`INSERT INTO src_import_request (operation,idempotency_key,fingerprint,batch_id,preview_id)
      VALUES (${operation},${key},${fingerprint},${batchId},${previewId}) ON CONFLICT (operation,idempotency_key) DO NOTHING`;
  }

  async findConfirmationByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.sql<Array<{ confirmation: unknown; payload_fingerprint: string; idempotency_key: string }>>`SELECT confirmation_payload confirmation, payload_fingerprint, idempotency_key
      FROM src_import_preview_confirmation c WHERE idempotency_key = ${idempotencyKey} OR EXISTS (SELECT 1 FROM src_import_request r WHERE r.operation='confirm' AND r.idempotency_key=${idempotencyKey} AND r.preview_id=c.preview_id)`;
    return row ? { confirmation: jsonValue(row.confirmation) as PreviewConfirmation, payloadFingerprint: row.payload_fingerprint, idempotencyKey: row.idempotency_key } : undefined;
  }

  async findConfirmationByPreview(previewId: string) {
    const [row] = await this.sql<Array<{ confirmation: unknown; payload_fingerprint: string; idempotency_key: string }>>`SELECT confirmation_payload confirmation, payload_fingerprint, idempotency_key
      FROM src_import_preview_confirmation WHERE preview_id = ${previewId}`;
    return row ? { confirmation: jsonValue(row.confirmation) as PreviewConfirmation, payloadFingerprint: row.payload_fingerprint, idempotencyKey: row.idempotency_key } : undefined;
  }

  async saveConfirmation(value: StoredConfirmation) {
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:confirmation-key:" + value.idempotencyKey}, 7824001))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:preview:" + value.confirmation.previewId}, 7824001))`;
      await this.claimKey(tx, 'confirm', value.idempotencyKey, value.payloadFingerprint);
      const [byKey] = await tx<Array<{ confirmation: unknown; payload_fingerprint: string; idempotency_key: string }>>`SELECT confirmation_payload confirmation, payload_fingerprint, idempotency_key FROM src_import_preview_confirmation WHERE idempotency_key = ${value.idempotencyKey}`;
      if (byKey) {
        if (byKey.payload_fingerprint !== value.payloadFingerprint) throw new ImportIdempotencyConflict();
        return { confirmation: { ...(jsonValue(byKey.confirmation) as PreviewConfirmation), reused: true }, payloadFingerprint: byKey.payload_fingerprint, idempotencyKey: byKey.idempotency_key };
      }
      const [inserted] = await tx<Array<{ id: string }>>`INSERT INTO src_import_preview_confirmation
        (id, preview_id, batch_id, source_file_id, file_version_id, source_sha256, contract_id, contract_hash,
         transformation_hash, content_hash, row_result_hash, source_format, preview_hash, actor, confirmed_at, idempotency_key, payload_fingerprint, confirmation_payload)
        SELECT ${value.confirmation.confirmationId}, p.id, p.batch_id, p.source_file_id, p.file_version_id, p.source_sha256,
          p.contract_id, p.contract_hash, p.transformation_hash, p.content_hash, p.row_result_hash, p.source_format, p.preview_hash, ${value.confirmation.actor}, ${value.confirmation.confirmedAt},
          ${value.idempotencyKey}, ${value.payloadFingerprint}, ${tx.json(value.confirmation)}
        FROM src_import_preview p WHERE p.id = ${value.confirmation.previewId}
        ON CONFLICT DO NOTHING RETURNING id::text`;
      if (!inserted) {
        const [existing] = await tx<Array<{ confirmation: unknown; payload_fingerprint: string; idempotency_key: string }>>`SELECT confirmation_payload confirmation, payload_fingerprint, idempotency_key FROM src_import_preview_confirmation WHERE preview_id = ${value.confirmation.previewId} OR idempotency_key = ${value.idempotencyKey}`;
        if (!existing) throw new Error("Confirmação concorrente não pôde ser recuperada.");
        if (existing.idempotency_key === value.idempotencyKey && existing.payload_fingerprint !== value.payloadFingerprint) throw new ImportIdempotencyConflict();
        await this.bindKey(tx, 'confirm', value.idempotencyKey, value.payloadFingerprint, value.confirmation.batchId, value.confirmation.previewId);
        return { confirmation: { ...(jsonValue(existing.confirmation) as PreviewConfirmation), reused: true }, payloadFingerprint: existing.payload_fingerprint, idempotencyKey: existing.idempotency_key };
      }
      await tx`INSERT INTO src_import_event
        (id, event_type, entity_id, batch_id, preview_id, actor, request_id, occurred_at, payload)
        VALUES (${randomUUID()}, 'source.import.preview_confirmed.v1', ${value.confirmation.previewId}, ${value.confirmation.batchId},
          ${value.confirmation.previewId}, ${value.confirmation.actor}, ${value.requestId ?? null}, ${value.confirmation.confirmedAt},
          ${tx.json({ previewHash: value.confirmation.previewHash })})`;
      await this.bindKey(tx, 'confirm', value.idempotencyKey, value.payloadFingerprint, value.confirmation.batchId, value.confirmation.previewId);
      return value;
    });
  }

  async recordRejected(value: RejectedPreparation) {
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:key:" + value.idempotencyKey}, 7824001))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"source-import:fingerprint:" + value.fingerprint}, 7824001))`;
      await this.claimKey(tx, 'prepare', value.idempotencyKey, value.fingerprint);
      const [existing] = await tx<Array<{ id: string; fingerprint: string; status: string }>>`SELECT id::text,fingerprint,status FROM src_import_batch WHERE idempotency_key=${value.idempotencyKey} OR fingerprint=${value.fingerprint}`;
      if (existing) {
        if (existing.fingerprint!==value.fingerprint || existing.status!=='Rejeitado') throw new ImportIdempotencyConflict();
        await this.bindKey(tx, 'prepare', value.idempotencyKey, value.fingerprint, existing.id, null);
        return;
      }
      const [inserted] = await tx<Array<{ id: string }>>`INSERT INTO src_import_batch
      (id, source_file_id, file_version_id, source_sha256, source_format, actor, prepared_at, retain_until, status,
       fingerprint, idempotency_key, contract_id, found_count, valid_count, error_count, rejected_count, rejection_code, rejection_message, request_id)
      VALUES (${value.batchId}, ${value.sourceFileId}, ${value.fileVersionId}, ${value.sourceSha256}, ${value.sourceFormat}, ${value.actor}, now(), now() + interval '30 days', 'Rejeitado',
        ${value.fingerprint}, ${value.idempotencyKey}, NULL, 0, 0, 0, 0, ${value.code}, ${value.message}, ${value.requestId})
      RETURNING id::text`;
      if (!inserted) throw new Error("Rejeição não persistida");
      await tx`INSERT INTO src_import_event
        (id, event_type, entity_id, batch_id, preview_id, actor, request_id, occurred_at, payload)
        VALUES (${randomUUID()}, 'source.import.preview_rejected.v1', ${value.batchId}, ${value.batchId}, NULL,
          ${value.actor}, ${value.requestId}, now(), ${tx.json({ code: value.code })})`;
      await this.bindKey(tx, 'prepare', value.idempotencyKey, value.fingerprint, value.batchId, null);
    });
  }
}
