// Run only against the disposable instance configured for this test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {chromium}=require('playwright');
const base=process.env.TRIA_PROJECT_IMPORT_TEST_URL;
if(base!=='http://127.0.0.1:3111'||process.env.TRIA_INTEGRATION_NAMESPACE!=='tria-project-import-test')throw Error('Use the disposable project import instance.');
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(base+'/entrar');
 await page.locator('input[name=codigo]').fill('synthetic-project-import-login');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(base+'/');
 async function create(title){await page.goto(base+'/projetos/novo');await page.getByLabel('Nome do projeto').fill(title);await page.getByRole('button',{name:'Criar projeto',exact:true}).click();await page.waitForURL(/\/projetos\/manual-/);return page.url().split('/').pop();}
 const a=await create('Projeto A sintético'),b=await create('Projeto B sintético');
 async function api(data,ok=true){const response=await page.request.post(base+'/api/sources/resources',{headers:{Origin:base},data});const body=await response.json();assert.equal(response.ok(),ok,JSON.stringify(body));return body;}
 async function upload(csv){const bytes=Buffer.from(csv);const response=await page.request.post(base+'/api/sources/consolidated',{headers:{Origin:base,'Content-Type':'text/csv','X-TRIA-File-Name':'teste-projeto.csv','X-TRIA-File-Size':String(bytes.length)},data:bytes});assert.equal(response.status(),201,await response.text());return (await response.json()).receiptId;}
 const mapping={id:0,date:1,activity:2,amount:3,project:-1};
 const csv='ID;Data;Atividade;Valor\nA1;2026-09-07;Entrega A;25,50\nA2;2026-09-07;Entrega extra;10,00\n';
 await page.goto(base+`/projetos/${a}`);
 await page.getByRole('link',{name:'Importar planilha neste projeto',exact:true}).click();
 await page.waitForLoadState('networkidle');
 await page.locator('input[type=file]').setInputFiles({name:'projeto-a.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await page.getByRole('button',{name:'Receber e proteger',exact:true}).click();
 await page.getByRole('button',{name:'Ler abas e colunas',exact:true}).click();
 await page.getByRole('button',{name:'Preparar prévia',exact:true}).click();
 await page.getByText('2 linhas válidas · 0 erros',{exact:true}).waitFor();
 const applyButton=page.getByRole('button',{name:'Confirmar e aplicar neste projeto',exact:true});
 assert.equal(await applyButton.isDisabled(),true);
 await page.getByRole('checkbox',{name:/Conferi os lançamentos/}).check();await applyButton.click();
 await page.getByRole('status').filter({hasText:'Planilha aplicada neste projeto'}).waitFor();
 const sourceB=await upload('ID;Data;Atividade;Valor\nB1;2026-09-07;Entrega B;80,00\n');
 const prepare=(sourceId,projectId)=>api({action:'prepare',sourceId,projectId,ordinal:0,mapping});
 const apply=preview=>api({action:'apply',id:preview.id,hash:preview.hash,confirmed:true});
 const pb=await prepare(sourceB,b);assert.equal(pb.count,1);assert.equal(pb.absent,0);assert.deepEqual(pb.differences,[]);await apply(pb);
 const revisions=()=>JSON.parse(execFileSync('docker',['exec','tria-project-import-test-db-1','psql','-U','tria_admin','-d','tria','-Atc',"SELECT json_object_agg(p.title,d.revision::text) FROM project p JOIN project_draft d ON d.project_id=p.id"],{encoding:'utf8'}));
 const beforeRevision=revisions();
 const sourceUpdate=await upload('ID;Data;Atividade;Valor\nA1;2026-09-07;Entrega A;30,00\n');
 const update=await prepare(sourceUpdate,a);assert.equal(update.totalCents,'3000');assert.deepEqual(update.differences.map(d=>d.id),['A1','A2']);
 const unresolved=await api({action:'apply',id:update.id,hash:update.hash,confirmed:true},false);assert.match(unresolved.error,/diferenças/);
 const resolved=await api({action:'resolve',id:update.id,hash:update.hash,decisions:{A1:'incoming',A2:'keep'}});
 assert.equal(resolved.totalCents,'4000');assert.equal(resolved.count,2);await apply(resolved);
 assert.equal((await apply(resolved)).reused,true);
 const afterRevision=revisions();assert.equal(afterRevision['Projeto B sintético'],beforeRevision['Projeto B sintético']);assert.equal(BigInt(afterRevision['Projeto A sintético']),BigInt(beforeRevision['Projeto A sintético'])+1n);
 const exportResponse=await page.request.get(base+`/api/sources/resources/export?id=${resolved.id}`);const exported=await exportResponse.text();
 assert.match(exported,/"B1";"Projeto B sintético".*"80.00"/);assert.match(exported,/"A2"/);assert.match(exported,/"A1".*"30.00"/);
 const collision=await api({action:'prepare',sourceId:sourceB,projectId:a,ordinal:0,mapping},false);assert.match(collision.error,/já pertence a outro projeto/);
 const unknown=await api({action:'prepare',sourceId:sourceB,projectId:'missing-project',ordinal:0,mapping},false);assert.match(unknown.error,/Projeto não encontrado/);
 const stale=await prepare(sourceUpdate,a);
 const newB=await upload('ID;Data;Atividade;Valor\nB1;2026-09-07;Entrega B;90,00\n');
 const bp=await prepare(newB,b);const br=await api({action:'resolve',id:bp.id,hash:bp.hash,decisions:{B1:'incoming'}});await apply(br);
 const conflict=await api({action:'resolve',id:stale.id,hash:stale.hash,decisions:{A2:'keep'}},false);assert.match(conflict.error,/base mudou/i);
 const staleApply=await api({action:'apply',id:stale.id,hash:stale.hash,confirmed:true},false);assert.match(staleApply.error,/base mudou/i);
 // XLSX uses the same project scope, including automatic project assignment.
 const {ZipFile}=require('yazl');const zip=new ZipFile();
 zip.addBuffer(Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="Recursos" r:id="rId1"/></sheets></workbook>'),'xl/workbook.xml');
 zip.addBuffer(Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/_rels/workbook.xml.rels');
 const values=[['ID','Data','Atividade','Valor'],['A1','2026-09-07','Entrega A','30.00'],['A2','2026-09-07','Entrega extra','10.00']];
 zip.addBuffer(Buffer.from('<worksheet><sheetData>'+values.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('')+'</sheetData></worksheet>'),'xl/worksheets/sheet1.xml');
 const xlsxPromise=new Promise((resolve,reject)=>{const chunks=[];zip.outputStream.on('data',c=>chunks.push(c));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject);});zip.end();const bytes=await xlsxPromise;
 const xr=await page.request.post(base+'/api/sources/consolidated',{headers:{Origin:base,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','X-TRIA-File-Name':'recursos.xlsx','X-TRIA-File-Size':String(bytes.length)},data:bytes});assert.equal(xr.status(),201,await xr.text());
 const xp=await prepare((await xr.json()).receiptId,a);assert.equal(xp.count,2);assert.equal(xp.totalCents,'4000');assert.deepEqual(xp.errors,[]);assert.equal((await apply(xp)).reused,true);
 // Existing resources can acquire activities without changing or duplicating their financial rows.
 const activityPreview=await api({action:'prepare',sourceId:sourceUpdate,projectId:a,ordinal:0,mapping,includeActivities:true});
 assert.equal(activityPreview.activities.added,1);
 const activityResolved=await api({action:'resolve',id:activityPreview.id,hash:activityPreview.hash,decisions:{A2:'keep'}});
 await apply(activityResolved);
 const db=query=>execFileSync('docker',['exec','tria-project-import-test-db-1','psql','-U','tria_admin','-d','tria','-Atc',query],{encoding:'utf8'}).trim();
 const state=()=>JSON.parse(db("SELECT json_build_object('count',(SELECT count(*) FROM bm_activity),'amount',a.effective_measured_value::text,'seconds',a.effective_duration_seconds::text,'base',a.source_measured_value::text,'revision',a.adjustment_revision::text) FROM effective_bm_activity a JOIN resource_activity_link l ON l.activity_id=a.id WHERE l.resource_id='A1'"));
 assert.equal(state().count,1);assert.equal(Number(state().amount),30);
 const repeat=await api({action:'prepare',sourceId:sourceUpdate,projectId:a,ordinal:0,mapping,includeActivities:true});
 assert.equal(repeat.activities.unchanged,1);
 const repeatResolved=await api({action:'resolve',id:repeat.id,hash:repeat.hash,decisions:{A2:'keep'}});assert.equal((await apply(repeatResolved)).reused,true);
 assert.equal(state().count,1);
 await page.goto(base+`/projetos/${a}`);await page.waitForLoadState('networkidle');
 const editor=page.locator('form').filter({has:page.locator('input[name=measurement]')}).first();
 await editor.locator('input[name=measurement]').fill('99');await editor.locator('input[name=hoursMode][value=present]').check();await editor.locator('input[name=hours]').fill('02:00:00');
 await editor.locator('input[name=reason]').fill('Ajuste manual a preservar');await editor.getByRole('button',{name:'Salvar ajuste',exact:true}).click();
 await page.getByRole('status').filter({hasText:/salvo/i}).first().waitFor();
 assert.equal(Number(state().amount),99);assert.equal(state().seconds,'7200');
 const changedSource=await upload('ID;Data;Atividade;Valor;Horas;Boletim\nA1;2026-09-07;Entrega revisada;45,00;1,5;BM-2\n');
 const changedMapping={...mapping,hours:4,bm:5};
 const changedPreview=await api({action:'prepare',sourceId:changedSource,projectId:a,ordinal:0,mapping:changedMapping,includeActivities:true});
 assert.equal(changedPreview.activities.updated,1);assert.equal(changedPreview.activities.adjusted,1);
 const changedResolved=await api({action:'resolve',id:changedPreview.id,hash:changedPreview.hash,decisions:{A1:'incoming',A2:'keep'}});await apply(changedResolved);
 assert.equal(state().count,1);assert.equal(Number(state().base),45);assert.equal(Number(state().amount),99);assert.equal(state().seconds,'7200');
 await page.reload();await page.waitForLoadState('networkidle');
 const restore=page.locator('form').filter({has:page.getByRole('button',{name:'Restaurar importado',exact:true})}).first();
 await restore.locator('input[name=reason]').fill('Usar medição da última planilha');const restored=page.waitForResponse(r=>r.request().method()==='POST' && r.url().includes('/projetos/'+a));await restore.getByRole('button',{name:'Restaurar importado',exact:true}).click();await restored;
 assert.equal(Number(state().amount),45);assert.equal(state().seconds,'5400');
 await page.getByRole('heading',{name:'Atividades e medições',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tria-activities-desktop.png'});
 assert.equal(db("SELECT count(*) FROM bm_activity WHERE project_id='"+b+"'"),'0');
 const bad=await api({action:'prepare',sourceId:await upload('ID;Data;Atividade;Valor;Horas;Boletim\nA1;2026-09-07;;45,00;1,5;BM-2\n'),projectId:a,ordinal:0,mapping:changedMapping,includeActivities:true},false);
 assert.match(bad.error,/preencha Atividade/);assert.equal(Number(state().amount),45);
 // The global importer still sees both projects, including deletions requiring a decision.
 const global=await api({action:'prepare',overwrite:true,sourceId:await upload('ID;Projeto;Data;Atividade;Valor\nA1;Projeto A sintético;2026-09-07;Entrega A;30,00\n'),ordinal:0,mapping:{id:0,project:1,date:2,activity:3,amount:4}});
 assert.deepEqual(global.differences.map(d=>d.id).sort(),['A1','A2','B1']);
 await page.goto(base+`/projetos/${a}`);assert.match(await page.locator('main').innerText(),/55,00/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('link',{name:'Importar planilha neste projeto',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/tria-project-import-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 assert.equal((await fetch(base+'/api/sources/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);

 // Substituição integral: zero e executor vazio são dados novos; ausentes saem da base.
 const zeroSource=await upload('ID;Projeto;Data;Atividade;Valor;Horas;Executor\nA1;Projeto A sintético;2026-09-07;Entrega zerada;;;\n');
 const zeroPreview=await api({action:'prepare',overwrite:true,sourceId:zeroSource,ordinal:0,mapping:{id:0,project:1,date:2,activity:3,amount:4,hours:5,executor:6}});
 assert.equal(zeroPreview.errorCount,0);assert.equal(zeroPreview.totalCents,'0');
 const zeroResolved=await api({action:'resolve',id:zeroPreview.id,hash:zeroPreview.hash,decisions:Object.fromEntries(zeroPreview.differences.map(d=>[d.id,'incoming']))});
 assert.equal(zeroResolved.count,1);await apply(zeroResolved);
 const stored=JSON.parse(db('SELECT i.rows FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id WHERE c.singleton'));
 assert.equal(stored.length,1);assert.equal(stored[0].amount,'0');assert.equal(stored[0].hours,'0');assert.equal(stored[0].executor,'');
 assert.equal((await apply(zeroResolved)).reused,true);
 console.log('OK: substituição integral persiste zeros, remove ausentes, preserva histórico e não soma nem duplica registros.');

 // Novos projetos só nascem ao aplicar. Carga normal mantém os ausentes.
 const lifecycleMapping={id:0,project:1,date:2,activity:3,amount:4,hours:5};
 const lifecycleCsv='ID;Projeto;Data;Atividade;Valor;Horas\nNEW1;Projeto Novo Importado;2026-09-11;Entrega nova;0;0\nNEW2;Projeto Excedente Importado;2026-09-11;Outra entrega;20;1\n';
 const newSource=await upload(lifecycleCsv);
 const lifecycle=await api({action:'prepare',sourceId:newSource,ordinal:0,mapping:lifecycleMapping,includeActivities:true});
 assert.equal(lifecycle.projects.create.length,2);assert.equal(db("SELECT count(*) FROM project WHERE title='Projeto Novo Importado'"),'0');
 await apply(lifecycle);assert.equal(db("SELECT count(*) FROM project WHERE title='Projeto Novo Importado'"),'1');
 assert.equal((await apply(lifecycle)).reused,true);
 // Um arquivo enviado deve continuar disponível mesmo se a nova carga arquivar o projeto.
 const excessId=lifecycle.projects.create.find(p=>p.title==='Projeto Excedente Importado').id;
 const evidenceBytes=await (await page.request.get(base+'/api/reports/projects/'+excessId)).body();
 const evidenceUpload=await page.request.post(base+'/api/projects/'+excessId+'/files',{headers:{Origin:base,'Content-Type':'application/pdf','x-tria-file-title':'Evidência preservada','x-tria-file-name':'evidencia.pdf'},data:evidenceBytes});
 assert.equal(evidenceUpload.status(),201);
 const evidenceVersion=(await evidenceUpload.json()).versionId;
 const preservedDownload=async()=>{
  const response=await page.request.get(base+'/api/files/'+evidenceVersion+'/download');
  assert.equal(response.status(),200);assert.deepEqual(await response.body(),evidenceBytes);
 };
 await preservedDownload();
 const partialSource=await upload('ID;Projeto;Data;Atividade;Valor;Horas\nNEW1;Projeto Novo Importado;2026-09-11;Entrega nova;0;0\n');
 const partial=await api({action:'prepare',sourceId:partialSource,ordinal:0,mapping:lifecycleMapping});
 assert.equal(partial.projects.archive.length,0);assert.equal(partial.absent,0);await apply(partial);
 const overwrite=await api({action:'prepare',sourceId:partialSource,ordinal:0,mapping:lifecycleMapping,overwrite:true});
 assert.ok(overwrite.projects.archive.some(p=>p.title==='Projeto Excedente Importado'));
 assert.equal(db("SELECT archived_at IS NULL FROM project WHERE title='Projeto Excedente Importado'"),'t');
 const overwriteResolved=await api({action:'resolve',id:overwrite.id,hash:overwrite.hash,decisions:Object.fromEntries(overwrite.differences.map(d=>[d.id,'incoming']))});
 await apply(overwriteResolved);await preservedDownload();assert.equal(db("SELECT archived_at IS NOT NULL FROM project WHERE title='Projeto Excedente Importado'"),'t');
 assert.equal(db("SELECT count(*) FROM bm_activity a JOIN project p ON p.id=a.project_id WHERE p.title='Projeto Excedente Importado'"),'1');
 const restoredProject=await api({action:'prepare',sourceId:newSource,ordinal:0,mapping:lifecycleMapping});
 assert.equal(restoredProject.projects.create.length,0);assert.equal(restoredProject.projects.restore.length,1);await apply(restoredProject);await preservedDownload();
 assert.equal(db("SELECT archived_at IS NULL FROM project WHERE title='Projeto Excedente Importado'"),'t');
 const staleProjects=await api({action:'prepare',sourceId:partialSource,ordinal:0,mapping:lifecycleMapping,overwrite:true});
 await create('Projeto criado depois da prévia');
 const staleProjectResult=await api({action:'resolve',id:staleProjects.id,hash:staleProjects.hash,decisions:Object.fromEntries(staleProjects.differences.map(d=>[d.id,'incoming']))},false);
 assert.match(staleProjectResult.error,/projetos mudaram/i);
 console.log('OK: novos projetos e atividades atômicos, prévia sem criação, carga normal preserva ausentes, sobrescrita arquiva, retorno reativa e catálogo alterado bloqueia prévia antiga.');
 console.log('OK: envio UI CSV/XLSX, projeto automático, prévia, decisões, preservação de outro projeto, repetição, colisão, concorrência, importação global, atividades sem duplicação, ajustes manuais preservados, restauração, mobile e autenticação.');
} catch(error) {await page.screenshot({path:'/tmp/tria-project-import-failure.png',fullPage:true});throw error;} finally {await browser.close();}
