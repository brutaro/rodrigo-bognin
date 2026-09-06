#!/usr/bin/env node
// Operação local do proprietário. Não dá privilégios administrativos ao servidor web.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,readdir,lstat,chmod,cp} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const compose=['compose','-f','compose.yaml','-f','compose.local.yaml'];
async function command(args,{input,output}={}){
 const p=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(`Docker falhou (${args[0]}): ${stderr.slice(-800)}`)));});
 p.stderr.on('data',b=>stderr+=b);
 const transfer=output?pipeline(p.stdout,createWriteStream(output,{flags:'wx',mode:0o600})):Promise.resolve();
 if(!output)p.stdout.on('data',b=>stdout+=b);
 if(input)createReadStream(input).pipe(p.stdin);else p.stdin.end();
 await Promise.all([done,transfer]);return stdout.trim();
}
const dc=(args,options)=>command([...compose,...args],options);
async function sql(query,db='tria'){return dc(['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','tria_admin','-d',db,'-Atc',query]);}
async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function files(dir,base=dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Link simbólico recusado no backup.');if(entry.isDirectory())result.push(...await files(full,base));else if(entry.isFile())result.push(path.relative(base,full));else throw Error('Entrada inválida no backup.');}return result.sort();}
async function fingerprints(db='tria'){
 const tables=(await sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",db)).split('\n').filter(Boolean),result={};
 for(const table of tables){if(!/^[a-z_][a-z_0-9]*$/.test(table))throw Error('Nome de tabela incompatível.');result[table]=JSON.parse(await sql(`SET timezone='UTC'; SELECT json_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex')) FROM public."${table}" t`,db).then(s=>s.replace(/^SET\n/,'')));}
 return result;
}
async function readManifest(dir){const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));if(manifest.format!=='tria-local-complete-v1'||!Array.isArray(manifest.files))throw Error('Formato de backup incompatível.');return manifest;}
async function verify(dir){
 const manifest=await readManifest(dir),seen=new Set();
 await files(dir); // Recusa também links simbólicos em diretórios intermediários.
 for(const entry of manifest.files){if(!entry.path||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='..'||p==='.')||entry.path.includes('\\')||seen.has(entry.path))throw Error('Caminho inválido no manifesto.');seen.add(entry.path);const full=path.join(dir,entry.path),stat=await lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==entry.size||await hash(full)!==entry.sha256)throw Error(`Integridade inválida: ${entry.path}`);}
 if(!seen.has('database.dump')||!seen.has('files/.tria-volume')||!seen.has('secrets/file_store_uuid'))throw Error('Cópia incompleta.');
 const marker=(await readFile(path.join(dir,'files/.tria-volume'),'utf8')).trim();if(marker!==(await readFile(path.join(dir,'secrets/file_store_uuid'),'utf8')).trim())throw Error('Identificação do cofre diverge.');
 for(const object of manifest.objects){const item=manifest.files.find(f=>f.path===`files/objects/${object.object_key}`);if(!item||item.sha256!==object.sha256||item.size!==Number(object.size_bytes))throw Error('Banco e cofre divergem.');}
 console.log(`Cópia íntegra: ${Object.keys(manifest.tables).length} tabelas e ${manifest.objects.length} arquivos.`);return manifest;
}
async function create(dir){
 if(await exists(dir))throw Error('O destino deve ser novo.');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const appId=await dc(['ps','-q','app']);if(!appId)throw Error('Aplicação local não encontrada.');
 const [app]=JSON.parse(await command(['inspect',appId]));const running=app.State.Running;
 try{
  if(running){console.log('Pausando a aplicação para manter banco e cofre consistentes.');await dc(['stop','app']);}
  const transitional=await sql("SELECT (SELECT count(*) FROM file_document WHERE status<>'active')+(SELECT count(*) FROM file_version WHERE status<>'active')+(SELECT count(*) FROM file_reservation WHERE status='reserved')");if(transitional!=='0')throw Error('Cofre em transição; conclua as operações pendentes antes de copiar.');
  const before=await fingerprints();
  await dc(['exec','-T','db','pg_dump','-Fc','-U','tria_admin','-d','tria'],{output:path.join(dir,'database.dump')});
  await command(['cp',`${appId}:/data/files`,path.join(dir,'files')]);
  await mkdir(path.join(dir,'secrets'),{mode:0o700});
  for(const name of ['db_admin_password','db_app_password','db_migrator_password','db_importer_password','tria_login_code','tria_session_key','file_store_uuid'])await cp(path.join(root,'.secrets',name),path.join(dir,'secrets',name));
  const objects=JSON.parse(await sql("SELECT coalesce(json_agg(json_build_object('object_key',object_key,'size_bytes',size_bytes::text,'sha256',sha256) ORDER BY object_key),'[]'::json) FROM file_version WHERE status='active'"));
  const after=await fingerprints();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('O banco mudou durante a cópia; backup recusado.');
  const entries=[];for(const file of await files(dir)){const full=path.join(dir,file);await chmod(full,0o600);entries.push({path:file,size:(await lstat(full)).size,sha256:await hash(full)});}
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify({format:'tria-local-complete-v1',createdAt:new Date().toISOString(),image:app.Image,tables:before,objects,files:entries},null,2)+'\n',{flag:'wx',mode:0o600});
  await verify(dir);console.log(`Backup completo: ${dir}`);
 }finally{if(running){await command(['start',appId]);console.log('Aplicação local retomada.');}}
}
async function restoreTest(dir){
 const manifest=await verify(dir);const id=randomUUID().replaceAll('-','').slice(0,12),database=`tria_restore_${id}`,container=`tria-restore-${id}`,volume=`tria_restore_files_${id}`;
 const [live]=JSON.parse(await command(['inspect',await dc(['ps','-q','app'])]));const network=Object.keys(live.NetworkSettings.Networks)[0];
 const state={id,database,container,volume,url:null,createdAt:new Date().toISOString()};let dbCreated=false,volumeCreated=false,containerCreated=false;
 try{
  await dc(['exec','-T','db','createdb','-U','tria_admin','-T','template0',database]);dbCreated=true;
  await dc(['exec','-T','db','pg_restore','--exit-on-error','-U','tria_admin','-d',database],{input:path.join(dir,'database.dump')});
  if(JSON.stringify(await fingerprints(database))!==JSON.stringify(manifest.tables))throw Error('Tabelas restauradas divergem do backup.');
  await sql(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${database}" TO tria_app,tria_migrator,tria_importer; COMMENT ON DATABASE "${database}" IS 'tria-restore-test:${id}';`,database);
  await command(['volume','create','--label',`tria.restore-test=${id}`,volume]);volumeCreated=true;
  const env=live.Config.Env.filter(e=>!e.startsWith('PGDATABASE=')).flatMap(e=>['-e',e]);env.push('-e',`PGDATABASE=${database}`);
  const mounts=live.Mounts.filter(m=>m.Destination.startsWith('/run/secrets/')).flatMap(m=>['--mount',`type=bind,source=${path.join(dir,'secrets',path.basename(m.Destination))},target=${m.Destination},readonly`]);
  await command(['create','--name',container,'--label',`tria.restore-test=${id}`,'--network',network,'--read-only','--tmpfs','/tmp:size=64m','-p','127.0.0.1::3000','--mount',`type=volume,source=${volume},target=/data/files`,...mounts,...env,live.Image]);containerCreated=true;
  await command(['cp',path.join(dir,'files')+'/.',`${container}:/data/files`]);
  const uid=live.Config.User||'node';
  await command(['run','--rm','--user','0','--mount',`type=volume,source=${volume},target=/data/files`,'--entrypoint','chown',live.Image,'-R',uid+':'+uid,'/data/files']);
  await command(['start',container]);const [restored]=JSON.parse(await command(['inspect',container]));const port=restored.NetworkSettings.Ports['3000/tcp'][0].HostPort;state.url=`http://127.0.0.1:${port}`;
  await writeFile(path.join(dir,'restore-test.json'),JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(`Restauração isolada pronta: ${state.url}`);
 }catch(e){if(containerCreated)await command(['rm','-f',container]).catch(()=>{});if(volumeCreated)await command(['volume','rm',volume]).catch(()=>{});if(dbCreated)await dc(['exec','-T','db','dropdb','--force','-U','tria_admin',database]).catch(()=>{});throw e;}
}
async function cleanup(dir){
 const s=JSON.parse(await readFile(path.join(dir,'restore-test.json'),'utf8'));if(!/^[a-f0-9]{12}$/.test(s.id)||s.database!==`tria_restore_${s.id}`||s.container!==`tria-restore-${s.id}`||s.volume!==`tria_restore_files_${s.id}`)throw Error('Destino isolado inválido.');
 const [c]=JSON.parse(await command(['inspect',s.container]));const [v]=JSON.parse(await command(['volume','inspect',s.volume]));if(c.Config.Labels?.['tria.restore-test']!==s.id||v.Labels?.['tria.restore-test']!==s.id)throw Error('Marcador de restauração inválido.');
 const comment=await sql(`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${s.database}'`);if(comment!==`tria-restore-test:${s.id}`)throw Error('Banco não pertence à restauração de teste.');
 await command(['rm','-f',s.container]);await command(['volume','rm',s.volume]);await dc(['exec','-T','db','dropdb','--force','-U','tria_admin',s.database]);
 await writeFile(path.join(dir,'restore-test.json'),JSON.stringify({...s,cleanedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});console.log('Somente o ambiente temporário de restauração foi removido. Backup preservado.');
}
const [action,arg]=process.argv.slice(2);const dir=path.resolve(root,arg??`.local-backups/${new Date().toISOString().replace(/[:.]/g,'-')}`);
try{if(action==='create')await create(dir);else if(action==='verify'&&arg)await verify(dir);else if(action==='restore-test'&&arg)await restoreTest(dir);else if(action==='cleanup-test'&&arg)await cleanup(dir);else throw Error('Uso: node scripts/local-backup.mjs create [destino-novo] | verify|restore-test|cleanup-test <backup>');}catch(e){console.error(e instanceof Error?e.message:'Falha no backup local.');process.exitCode=1;}
