import "server-only";
import { randomUUID } from "node:crypto";
import { getSql } from "./database";
import { reimbursementLabel, type ReimbursementStatus } from "./reimbursement-status";
export async function setReimbursementStatus(projectId: string, entryId: string, value: ReimbursementStatus, reason: string) {
  return getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const [entry] = await tx`SELECT description FROM manual_financial_entry WHERE id=${entryId} AND project_id=${projectId} AND kind='Reembolso'`;
    if (!entry) throw new Error("Reembolso não encontrado neste projeto.");
    const [current] = await tx`SELECT revision::text,status,received_on::text FROM current_reimbursement_status WHERE entry_id=${entryId}`;
    if (current?.status === value.status && current.received_on === value.receivedOn) return;
    if ((current?.revision ?? "0") !== value.revision) throw new Error("A situação mudou. Recarregue o projeto antes de alterar.");
    const revision = (BigInt(value.revision) + 1n).toString();
    await tx`INSERT INTO reimbursement_status_history(entry_id,revision,status,received_on,reason) VALUES(${entryId},${revision},${value.status},${value.receivedOn},${reason})`;
    await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=${projectId}`;
    await tx`INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at) VALUES(${randomUUID()},${projectId},'Situação do reembolso atualizada',${`${entry.description}: ${reimbursementLabel(value)}. Motivo: ${reason}`},'Rodrigo',now())`;
  });
}
