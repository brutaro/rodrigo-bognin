import "server-only";
import { randomUUID } from "node:crypto";
import { getSql } from "./database";
import { withFileOperation } from "./file-repository";
export async function setFinancialProof(projectId: string, entryId: string, versionId: string | null, expectedVersionId: string | null) {
  return withFileOperation(() => getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const [entry] = await tx`SELECT id,description FROM manual_financial_entry WHERE id=${entryId} AND project_id=${projectId}`;
    if (!entry) throw new Error("Lançamento não encontrado.");
    const [current] = await tx`SELECT file_version_id::text FROM financial_entry_proof WHERE entry_id=${entryId}`;
    if ((current?.file_version_id ?? null) === versionId) return;
    if ((current?.file_version_id ?? null) !== expectedVersionId) throw new Error("O vínculo mudou. Recarregue o projeto antes de alterar.");
    let label = "Vínculo removido; arquivo preservado no projeto.";
    if (versionId) {
      const [file] = await tx`SELECT d.title,v.version FROM file_version v JOIN file_document d ON d.id=v.document_id WHERE v.id=${versionId} AND d.project_id=${projectId} AND d.document_kind='project' AND d.status='active' AND v.status='active'`;
      if (!file) throw new Error("Escolha um arquivo ativo deste projeto.");
      await tx`INSERT INTO financial_entry_proof(entry_id,file_version_id) VALUES(${entryId},${versionId}) ON CONFLICT(entry_id) DO UPDATE SET file_version_id=excluded.file_version_id`;
      label = `Arquivo ${file.title}, versão ${file.version}, associado ao lançamento.`;
    } else await tx`DELETE FROM financial_entry_proof WHERE entry_id=${entryId}`;
    await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=${projectId}`;
    await tx`INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at) VALUES(${randomUUID()},${projectId},'Comprovante atualizado',${`${entry.description}: ${label}`},'Rodrigo',now())`;
  }));
}
