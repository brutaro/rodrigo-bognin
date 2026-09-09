import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres,{type Sql} from 'postgres';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
let app:Sql,admin:Sql;
const prefix=`local-${randomUUID()}`, a=`${prefix}-a`, b=`${prefix}-b`, c=`${prefix}-c`, note=`${prefix}-note`, other=`${prefix}-other`;
const request=randomUUID(), batch=randomUUID(),relationBatch=randomUUID(),publication=randomUUID(),payment=randomUUID();
let preserved:unknown;
async function state(){
 return {
  fiscal:await app`SELECT id,amount::text FROM effective_fiscal_note WHERE id IN (${note},${other}) ORDER BY id`,
  projects:await app`SELECT project_id,revision::text FROM project_draft WHERE project_id IN (${a},${b},${c}) ORDER BY project_id`,
  deleted:await app`SELECT * FROM fiscal_note_deletion WHERE fiscal_note_id=${note}`,
 };
}
async function retained(){return {
 source:await app`SELECT id,amount::text FROM fiscal_note WHERE id=${note}`,
 links:await app`SELECT candidate_project_id,verified_related_value::text FROM financial_relation WHERE fiscal_note_id=${note}`,
 payment:await app`SELECT * FROM manual_financial_entry WHERE id=${payment}`,
 publication:await app`SELECT snapshot FROM publication WHERE id=${publication}`,
 };}
beforeAll(async()=>{
 const namespace=process.env.TRIA_INTEGRATION_NAMESPACE;
 if(process.env.TRIA_INTEGRATION_ISOLATED!=='confirmed'||namespace!=='tria-project-import-test'||process.env.TRIA_RUNTIME==='railway')throw Error('Teste exige ambiente descartável tria-project-import-test.');
 const options={host:process.env.PGHOST??'db',port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE??'tria',prepare:false,max:3};
 const secret=async(path:string|undefined)=>{if(!path)throw Error('Segredo de teste ausente');return(await readFile(path,'utf8')).trim();};
 app=postgres({...options,username:'tria_app',password:await secret(process.env.TRIA_APP_PASSWORD_FILE)});
 const [marker]=await app`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
 if(marker?.namespace!==namespace)throw Error('Namespace PostgreSQL incompatível.');
 admin=postgres({...options,username:'tria_admin',password:await secret(process.env.TRIA_ADMIN_PASSWORD_FILE)});
 await admin`INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES(${batch},'fiscal_notes','synthetic-local',${randomUUID().replaceAll('-','').repeat(2)},2,'completed'),(${relationBatch},'financial_relations','synthetic-local',${randomUUID().replaceAll('-','').repeat(2)},1,'completed')`;
 for(const id of [a,b,c]){
  await admin`INSERT INTO project(id,source_project_id,title,evidence_status,import_batch_id) VALUES(${id},${id},${id},'Não informado',${batch})`;
  await admin`INSERT INTO project_draft(project_id,revision) VALUES(${id},0)`;
 }
 await admin`INSERT INTO fiscal_note(id,batch_id,source_note_id,issue_year,note_number,issue_date,amount,declared_project_id) VALUES(${note},${batch},'one',2026,${note},'2026-09-09',100,${a}),(${other},${batch},'two',2026,${other},'2026-09-09',25,${c})`;
 await admin`INSERT INTO financial_relation(fiscal_note_id,batch_id,candidate_project_id,strength,state,full_value_eligible,verified_related_value) VALUES(${note},${relationBatch},${b},'Verificada','Confirmada',false,40)`;
 await app`INSERT INTO manual_financial_entry(id,request_id,project_id,kind,description,amount_cents,origin,document_state,created_at) VALUES(${payment},${payment},${a},'Pagamento','Pagamento sintético preservado',3000,'Informado por Rodrigo','Sem arquivo associado',now())`;
 const now=new Date().toISOString(),hash='a'.repeat(64),snapshot={id:publication,projectId:a,version:1,priorPublicationId:null,createdAt:now,createdBy:'Rodrigo',contentHash:hash,recordHash:hash,fiscalAmount:'100.00'};
 await app`INSERT INTO publication(id,project_id,version,created_at,created_by,content_hash,record_hash,snapshot) VALUES(${publication},${a},1,${now},'Rodrigo',${hash},${hash},${app.json(snapshot)})`;
 preserved=await retained();
});
afterAll(async()=>{await Promise.all([app?.end({timeout:2}),admin?.end({timeout:2})]);});
describe('Exclusão fiscal em PostgreSQL real',()=>{
 it('recusa revisão obsoleta sem marca ou invalidação parcial',async()=>{
  const before=await state();
  await expect(app`SELECT delete_owner_fiscal_note(${note},1,${randomUUID()},'Revisão obsoleta')`).rejects.toMatchObject({code:'40001'});
  expect(await state()).toEqual(before);
 });
 it('rollback integral quando um dos projetos vinculados não pode ser invalidado',async()=>{
  await admin`UPDATE project_draft SET revision=9223372036854775807 WHERE project_id=${b}`;
  const before=await state();
  await expect(app`SELECT delete_owner_fiscal_note(${note},0,${randomUUID()},'Falha no segundo vínculo')`).rejects.toMatchObject({code:'22003'});
  expect(await state()).toEqual(before);
  await admin`UPDATE project_draft SET revision=0 WHERE project_id=${b}`;
 });
 it('exclui uma vez sob repetição concorrente e recalcula bruto e vínculos distintos',async()=>{
  await Promise.all([app`SELECT delete_owner_fiscal_note(${note},0,${request},'Exclusão sintética válida')`,app`SELECT delete_owner_fiscal_note(${note},0,${request},'Exclusão sintética válida')`]);
  expect(await app`SELECT coalesce(sum(amount),0)::text total FROM effective_fiscal_note WHERE id IN (${note},${other})`).toEqual([{total:'25.00'}]);
  expect(await app`SELECT count(*)::int count FROM effective_fiscal_note WHERE declared_project_id=${a} OR candidate_project_id=${b}`).toEqual([{count:0}]);
  expect(await app`SELECT project_id,revision::text FROM project_draft WHERE project_id IN (${a},${b},${c}) ORDER BY project_id`).toEqual([{project_id:a,revision:'1'},{project_id:b,revision:'1'},{project_id:c,revision:'0'}]);
  expect(await app`SELECT count(*)::int count FROM history_event WHERE project_id IN (${a},${b}) AND action='NFS-e excluída'`).toEqual([{count:2}]);
  expect(await retained()).toEqual(preserved);
 });
 it('repetir com nova tentativa não invalida nem desconta novamente; UUID divergente é recusado',async()=>{
  const before=await state();
  await app`SELECT delete_owner_fiscal_note(${note},0,${randomUUID()},'Repetição independente')`;
  expect(await state()).toEqual(before);
  await expect(app`SELECT delete_owner_fiscal_note(${other},0,${request},'Exclusão sintética válida')`).rejects.toMatchObject({code:'22023'});
 });
 it('não permite restauração, ajuste novo ou alteração direta da marca',async()=>{
  await expect(app`SELECT restore_owner_fiscal_note(${note},0,${randomUUID()},'Restaurar excluída',false)`).rejects.toThrow();
  await expect(app`SELECT apply_owner_fiscal_note_adjustment(${note},0,${randomUUID()},'Ajustar excluída',2026::smallint,${note},'2026-09-09'::date,90::numeric,NULL,${a},NULL,'Sem relação verificável','Não informado',NULL,NULL,NULL,false)`).rejects.toThrow();
  await expect(app`DELETE FROM fiscal_note_deletion WHERE fiscal_note_id=${note}`).rejects.toMatchObject({code:'42501'});
  expect(await retained()).toEqual(preserved);
 });
 it('reimportação reconhece fonte preservada sem ressuscitar nota excluída',async()=>{
  const [source]=await app`SELECT id FROM source_file ORDER BY received_at LIMIT 1`;
  if(!source)throw Error('Execute este teste depois do E2E de recursos que guarda fontes sintéticas.');
  const id=randomUUID(),hash='b'.repeat(64),rows=[{id:note,sourceId:'one',year:2026,number:note,date:'2026-09-09',amount:'100.00',category:'',projectId:a}];
  await app`INSERT INTO fiscal_import(id,source_file_id,content_hash,sheet_name,rows,errors) VALUES(${id},${source.id},${hash},'CSV',${app.json(rows)},'[]')`;
  expect(await app`SELECT apply_fiscal_import(${id},${hash}) inserted`).toEqual([{inserted:0}]);
  expect(await app`SELECT count(*)::int count FROM effective_fiscal_note WHERE id=${note}`).toEqual([{count:0}]);
  expect(await retained()).toEqual(preserved);
 });
});
