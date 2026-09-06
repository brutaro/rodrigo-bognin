import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {getSql} from './database';
import {contractInput,type Contract} from './contract-domain';
export class ContractConflictError extends Error{}
export async function readContract(tx:Sql|TransactionSql,projectId:string):Promise<Contract|undefined>{
 const [row]=await tx<Contract[]>`SELECT revision::text, total_cents::text "totalCents",reference,receipts,reason,created_at::text "updatedAt" FROM current_project_contract WHERE project_id=${projectId}`;return row;
}
export async function saveContract(projectId:string,input:unknown){
 const value=contractInput.parse(input);
 return getSql().begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
  const [project]=await tx`SELECT id FROM project WHERE id=${projectId}`;if(!project)throw Error('Projeto não encontrado.');
  const current=await readContract(tx,projectId);
  if((current?.revision??'0')!==value.revision)throw new ContractConflictError('O contrato mudou. Recarregue o projeto antes de salvar.');
  if(current?.receipts.some(receipt=>!value.receipts.some(r=>r.id===receipt.id)))throw Error('Anule o recebimento para preservar o histórico.');
  const revision=(BigInt(value.revision)+1n).toString();
  await tx`INSERT INTO project_contract_revision(project_id,revision,total_cents,reference,receipts,reason) VALUES(${projectId},${revision},${value.totalCents},${value.reference},${tx.json(value.receipts)},${value.reason})`;
  await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id=${projectId}`;
  await tx`INSERT INTO history_event(id,project_id,action,detail,actor,occurred_at) VALUES(${randomUUID()},${projectId},'Contrato atualizado',${value.reference+' · Revisão '+revision+' · '+value.reason},'Rodrigo',now())`;
  return readContract(tx,projectId);
 });
}
