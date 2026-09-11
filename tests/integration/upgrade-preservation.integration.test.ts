import {expect,it} from 'vitest';
import postgres from 'postgres';
import {readFile,readdir,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

it.each([45,50])('atualiza banco preenchido da migração %i preservando dados e arquivos; repetir é inócuo',async(baseVersion)=>{
 if(process.env.TRIA_INTEGRATION_ISOLATED!=='confirmed'||process.env.TRIA_INTEGRATION_NAMESPACE!=='tria-project-import-test'||process.env.TRIA_RUNTIME==='railway')throw Error('Exige pilha sintética isolada.');
 const password=(await readFile(process.env.TRIA_ADMIN_PASSWORD_FILE!,'utf8')).trim();
 const options={host:process.env.PGHOST??'db',port:Number(process.env.PGPORT??5432),username:'tria_admin',password,max:1,prepare:false};
 const admin=postgres({...options,database:'tria'});
 const name='upgrade_'+randomUUID().replaceAll('-','');
 let sql:ReturnType<typeof postgres>|undefined;
 const vault=await mkdtemp(join(tmpdir(),'tria-upgrade-vault-'));
 const volumeId=randomUUID();
 const objects:Array<{key:string;bytes:Buffer}>=[];
 try{
  const [marker]=await admin`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
  expect(marker.namespace).toBe('tria-project-import-test');
  await admin.unsafe(`CREATE DATABASE ${name}`);
  sql=postgres({...options,database:name});
  await sql`CREATE TABLE schema_migration(name text PRIMARY KEY,sha256 char(64) NOT NULL,applied_at timestamptz DEFAULT now())`;
  const files=(await readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort();
  for(const file of files.filter(n=>Number(n.slice(0,3))<=baseVersion)){
   const body=await readFile('db/migrations/'+file,'utf8');
   await sql.begin(async tx=>{await tx.unsafe(body);await tx`INSERT INTO schema_migration(name,sha256) VALUES(${file},${createHash('sha256').update(body).digest('hex')})`;});
  }
  await sql`INSERT INTO runtime_instance_marker(singleton,namespace) VALUES(true,'tria-project-import-test')`;
  const batch=randomUUID(),relationBatch=randomUUID(),payment=randomUUID(),publication=randomUUID(),doc=randomUUID(),version=randomUUID(),source=randomUUID(),importId=randomUUID();
  await sql.begin(async tx=>{
   await tx`INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES(${batch},'fiscal_notes','synthetic-upgrade',${'a'.repeat(64)},1,'completed'),(${relationBatch},'financial_relations','synthetic-upgrade',${'b'.repeat(64)},1,'completed')`;
   await tx`INSERT INTO project(id,source_project_id,title,evidence_status,import_batch_id) VALUES('upgrade','upgrade','Projeto sintético','Não informado',${batch})`;
   await tx`INSERT INTO project_draft(project_id,narrative,revision) VALUES('upgrade','Texto editado pelo proprietário',7)`;
   await tx`INSERT INTO bm_activity(id,batch_id,project_id,source_id,source_sheet,source_excel_row,bm_code,activity,duration_seconds,measured_value) VALUES('activity',${batch},'upgrade','synthetic','CSV',2,'BM1','Entrega',3600,123.45)`;
   await tx`INSERT INTO fiscal_note(id,batch_id,source_note_id,issue_year,note_number,issue_date,amount,declared_project_id) VALUES('note',${batch},'one',2026,'9001','2026-09-09',123.45,'upgrade')`;
   await tx`INSERT INTO financial_relation(fiscal_note_id,batch_id,candidate_project_id,strength,state,verified_related_value) VALUES('note',${relationBatch},'upgrade','Verificada','Confirmada',45)`;
   await tx`INSERT INTO manual_financial_entry(id,request_id,project_id,kind,description,amount_cents,origin,document_state,created_at) VALUES(${payment},${payment},'upgrade','Pagamento','Pagamento preservado',3000,'Informado por Rodrigo','Sem arquivo associado',now())`;
   const now=new Date().toISOString(),hash='a'.repeat(64);
   const snapshot={id:publication,projectId:'upgrade',version:1,priorPublicationId:null,createdAt:now,createdBy:'Rodrigo',contentHash:hash,recordHash:hash,notes:['note']};
   await tx`INSERT INTO publication(id,project_id,version,created_at,created_by,content_hash,record_hash,snapshot) VALUES(${publication},'upgrade',1,${now},'Rodrigo',${hash},${hash},${tx.json(snapshot)})`;
   await tx`INSERT INTO file_document(id,project_id,document_kind,title,status,include_in_publication,created_at,updated_at) VALUES(${doc},NULL,'source','Base consolidada de aplicação de recursos','active',false,${now},${now})`;
   await tx`INSERT INTO file_version(id,document_id,version,object_key,original_name,media_type,size_bytes,sha256,status,created_at) VALUES(${version},${doc},1,${randomUUID()},'origem.csv','text/csv',10,${hash},'active',${now})`;
   await tx`INSERT INTO source_file(id,document_id,file_version_id,source_format,received_by,received_at) VALUES(${source},${doc},${version},'csv','Rodrigo',${now})`;
   await tx`INSERT INTO source_file_event(id,source_file_id,operation,byte_count,actor,occurred_at) VALUES(${randomUUID()},${source},'source.file.received.v1',10,'Rodrigo',${now})`;
   await tx`UPDATE file_store_counter SET used_bytes=10`;
   await tx`INSERT INTO resource_import(id,source_file_id,content_hash,sheet_name,rows,errors,applied_at) VALUES(${importId},${source},${hash},'CSV','[{"id":"one","project":"Projeto sintético","activity":"Entrega","amount":"123.45","hours":"1","date":"","nature":""}]','[]',now())`;
   await tx`INSERT INTO resource_import_current(singleton,import_id) VALUES(true,${importId})`;
  });
  // Simula evidência enviada ao projeto e PDF global de Contexto existentes na release atual.
  if(baseVersion>=50){
   for(const kind of ['project','context'] as const){
    const documentId=randomUUID(),versionId=randomUUID(),key=randomUUID();
    const bytes=Buffer.from(`%PDF-1.4\nArquivo sintético preservado: ${kind}\n%%EOF`);
    objects.push({key,bytes});
    const digest=createHash('sha256').update(bytes).digest('hex'),now=new Date().toISOString();
    await sql`INSERT INTO file_document(id,project_id,document_kind,title,status,include_in_publication,created_at,updated_at)
     VALUES(${documentId},${kind==='project'?'upgrade':null},${kind},${'PDF '+kind},'active',${kind==='project'},${now},${now})`;
    await sql`INSERT INTO file_version(id,document_id,version,object_key,original_name,media_type,size_bytes,sha256,status,created_at)
     VALUES(${versionId},${documentId},1,${key},${kind+'.pdf'},'application/pdf',${bytes.length},${digest},'active',${now})`;
    if(kind==='project'){
     await sql`INSERT INTO publication_file(publication_id,file_version_id) VALUES(${publication},${versionId})`;
     const evidenceBatch=randomUUID();
     await sql`INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES(${evidenceBatch},'project_evidence','synthetic-evidence',${digest},1,'completed')`;
     await sql`INSERT INTO evidence_asset(id,sha256,file_type,private_path,batch_id) VALUES(${digest},${digest},'pdf','synthetic.pdf',${evidenceBatch})`;
     await sql`INSERT INTO project_evidence(project_id,evidence_asset_id,strength,status,batch_id) VALUES('upgrade',${digest},'Verificada','Disponível',${evidenceBatch})`;
    }
   }
  }
  await mkdir(join(vault,'objects'));
  await writeFile(join(vault,'.tria-volume'),volumeId+'\n',{mode:0o600});
  const uuidFile=join(vault,'uuid');await writeFile(uuidFile,volumeId,{mode:0o600});
  for(const object of objects)await writeFile(join(vault,'objects',object.key),object.bytes,{mode:0o600});
  await sql`UPDATE file_store_counter SET volume_uuid=${volumeId}::uuid,used_bytes=10+${objects.reduce((sum,o)=>sum+o.bytes.length,0)}`;
  const tables=await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migration' ORDER BY tablename`;
  const snapshot=async()=>{
   const result:Record<string,unknown>={};
   for(const {tablename} of tables)result[tablename]=await sql!.unsafe(`SELECT to_jsonb(t) ${tablename === "resource_import" ? "- 'project_plan'" : ""} row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`);
   result.effectiveNotes=await sql!`SELECT * FROM effective_fiscal_note ORDER BY id`;
   result.effectiveActivities=await sql!`SELECT * FROM effective_bm_activity ORDER BY id`;
   return result;
  };
  const before=await snapshot();
  const migrate=()=>execFileSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,PGHOST:options.host,PGPORT:String(options.port),PGDATABASE:name,PGUSER:options.username,PGPASSWORD_FILE:process.env.TRIA_ADMIN_PASSWORD_FILE,TRIA_INSTANCE_NAMESPACE:'tria-project-import-test'},stdio:'pipe'});
  migrate();
  execFileSync(process.execPath,['scripts/init-file-store.mjs'],{env:{...process.env,PGHOST:options.host,PGPORT:String(options.port),PGDATABASE:name,PGUSER:options.username,PGPASSWORD_FILE:process.env.TRIA_ADMIN_PASSWORD_FILE,TRIA_INSTANCE_NAMESPACE:'tria-project-import-test',TRIA_FILE_STORE_PATH:vault,TRIA_FILE_STORE_UUID_FILE:uuidFile},stdio:'pipe'});
  expect(await snapshot()).toEqual(before);
  for(const object of objects)expect(await readFile(join(vault,'objects',object.key))).toEqual(object.bytes);
  migrate();
  execFileSync(process.execPath,['scripts/init-file-store.mjs'],{env:{...process.env,PGHOST:options.host,PGPORT:String(options.port),PGDATABASE:name,PGUSER:options.username,PGPASSWORD_FILE:process.env.TRIA_ADMIN_PASSWORD_FILE,TRIA_INSTANCE_NAMESPACE:'tria-project-import-test',TRIA_FILE_STORE_PATH:vault,TRIA_FILE_STORE_UUID_FILE:uuidFile},stdio:'pipe'});
  expect(await snapshot()).toEqual(before);
  for(const object of objects)expect(await readFile(join(vault,'objects',object.key))).toEqual(object.bytes);
  expect(await sql`SELECT project_plan FROM resource_import WHERE id=${importId}`).toEqual([{project_plan:null}]);
  expect(await sql`SELECT count(*)::int count FROM fiscal_note_deletion`).toEqual([{count:0}]);
  // A proteção antiga continua válida após corrigir o trigger compartilhado.
  await expect(sql`UPDATE file_version SET status='purging' WHERE id=${version}`).rejects.toThrow('source file parents are immutable');
 }finally{
  await sql?.end({timeout:2});
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end({timeout:2});
  await rm(vault,{recursive:true,force:true});
 }
},60000);
