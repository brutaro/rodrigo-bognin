// Fixtures somente na pilha descartável do teste de importação.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TRIA_PROJECT_IMPORT_TEST_URL;
if(base!=='http://127.0.0.1:3111'||process.env.TRIA_INTEGRATION_NAMESPACE!=='tria-project-import-test')throw Error('Use a pilha descartável.');
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'||message.type()==='warn')console.log('Browser:',message.type(),message.text());});
page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')console.log('Request failed:',request.url(),request.failure()?.errorText);});
const db=query=>execFileSync('docker',['exec','tria-project-import-test-db-1','psql','-U','tria_admin','-d','tria','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'}).trim();
async function post(path,data,ok=true){const response=await page.request.post(base+path,{headers:{Origin:base},data});const body=await response.json();assert.equal(response.ok(),ok,JSON.stringify(body));return body;}
async function source(csv){const bytes=Buffer.from(csv);const response=await page.request.post(base+'/api/sources/consolidated',{headers:{Origin:base,'Content-Type':'text/csv','X-TRIA-File-Name':'requisitos.csv','X-TRIA-File-Size':String(bytes.length)},data:bytes});assert.equal(response.status(),201,await response.text());return (await response.json()).receiptId;}
async function create(title){await page.goto(base+'/projetos/novo');await page.getByLabel('Nome do projeto').fill(title);await page.getByRole('button',{name:'Criar projeto',exact:true}).click();await page.waitForURL(/\/projetos\/manual-/);return page.url().split('/').pop();}
async function apply(preview,chosen={}){if(preview.differences.length){preview=await post('/api/sources/resources',{action:'resolve',id:preview.id,hash:preview.hash,decisions:Object.fromEntries(preview.differences.map(d=>[d.id,chosen[d.id]??(d.after?'incoming':'keep')]))});}return post('/api/sources/resources',{action:'apply',id:preview.id,hash:preview.hash,confirmed:true});}
async function executorList(id){await page.goto(base+'/projetos/'+id);return (await page.getByRole('region',{name:'Executores',exact:true}).getByRole('listitem').allTextContents()).map(name=>name.toLocaleLowerCase('pt-BR'));}
function multipagePdf(){
 const stream=number=>`BT /F1 24 Tf 70 700 Td (Contexto de teste - pagina ${number}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
 `<< /Length ${stream(1).length} >>\nstream\n${stream(1)}\nendstream`,
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
 `<< /Length ${stream(2).length} >>\nstream\n${stream(2)}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf);
}
try {
 await page.goto(base+'/entrar');await page.locator('input[name=codigo]').fill('synthetic-project-import-login');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(base+'/');
 await page.getByRole('navigation',{name:'Navegação principal',exact:true}).getByRole('link',{name:'Contexto',exact:true}).click();
 await page.getByRole('heading',{name:'Contexto',exact:true}).waitFor();
 const protectedBefore=db('SELECT used_bytes FROM file_store_counter');
 for(const [name,bytes] of [['invalido.txt',Buffer.from('texto')],['falso.pdf',Buffer.from('%PDF-1.4\nnao e um documento\n%%EOF')]]){
  const response=await page.request.post(base+'/api/contexto',{headers:{Origin:base,'Content-Type':'application/pdf','x-tria-file-name':name},data:bytes});assert.equal(response.ok(),false);
 }
 assert.equal(db('SELECT used_bytes FROM file_store_counter'),protectedBefore);
 assert.equal(db('SELECT reserved_bytes FROM file_store_counter'),'0');
 await page.getByLabel('PDF de contexto').setInputFiles({name:'Contexto multipagina.pdf',mimeType:'application/pdf',buffer:multipagePdf()});
 await page.getByRole('button',{name:'Guardar PDF',exact:true}).click();await page.getByRole('status').filter({hasText:'PDF guardado.'}).waitFor();
 await page.reload();await page.getByRole('button',{name:/^Contexto multipagina.pdf/}).click();
 const modal=page.getByRole('dialog',{name:'Contexto multipagina.pdf',exact:true});await modal.waitFor();
 await page.getByLabel('Página 2 de 2',{exact:true}).waitFor();
 await modal.getByText('Carregando páginas…',{exact:true}).waitFor({state:'hidden'});
 assert.equal(await modal.getByRole('img').count(),2);
 await page.getByLabel('Página 2 de 2',{exact:true}).scrollIntoViewIfNeeded();
 await modal.locator('[aria-label="Página 2 de 2"][data-rendered=true]').waitFor();
 assert.ok(await modal.locator('[aria-label="Página 2 de 2"] canvas').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<100&&pixels[i+3]>0)dark++;return dark>100;}));
 const scroll=modal.getByLabel('Páginas do PDF');await scroll.evaluate(element=>{element.scrollTop=element.scrollHeight;});assert.ok(await scroll.evaluate(element=>element.scrollTop)>0);
 await page.screenshot({path:'/tmp/tria-local-contexto-desktop.png'});
 await modal.getByRole('button',{name:'Fechar',exact:true}).click();await modal.waitFor({state:'detached'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^Contexto multipagina.pdf/}).click();await page.getByLabel('Página 2 de 2',{exact:true}).waitFor();
 await page.getByLabel('Página 2 de 2',{exact:true}).scrollIntoViewIfNeeded();await page.locator('[aria-label="Página 2 de 2"][data-rendered=true]').waitFor();
 assert.ok(await page.getByRole('dialog').evaluate(element=>element.getBoundingClientRect().width)<=390);
 await page.screenshot({path:'/tmp/tria-local-contexto-mobile.png'});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 await page.setViewportSize({width:1440,height:1000});
 const backup=await page.request.get(base+'/api/backups/files');assert.equal(backup.status(),200);
 const backupDir=mkdtempSync(join(tmpdir(),'tria-context-backup-'));
 try {const bundle=join(backupDir,'cofre.zip');writeFileSync(bundle,await backup.body());execFileSync(process.execPath,['scripts/restore-file-backup.mjs','--target',join(backupDir,'restaurado'),bundle],{encoding:'utf8'});}finally{rmSync(backupDir,{recursive:true,force:true});}
 console.log('OK: Contexto persiste PDF multipágina, recusa conteúdo inválido sem consumir quota, abre/rola/fecha em desktop e mobile.');
 const contextId=db("SELECT v.id FROM file_version v JOIN file_document d ON d.id=v.document_id WHERE d.document_kind='context' LIMIT 1");
 const retained=await page.request.post(base+'/api/contexto',{headers:{Origin:base,'Content-Type':'application/pdf','x-tria-file-name':'Preservado.pdf'},data:multipagePdf()});assert.equal(retained.status(),201);
 const bytesBefore=BigInt(db('SELECT used_bytes FROM file_store_counter'));
 assert.equal((await fetch(base+'/api/contexto/'+contextId,{method:'DELETE'})).status,401);
 assert.equal((await page.request.delete(base+'/api/contexto/'+contextId,{headers:{Origin:'https://invalid.example'}})).status(),403);
 await page.reload();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Excluir Contexto multipagina.pdf',exact:true}).click();
 assert.equal(db("SELECT count(*) FROM file_version WHERE id='"+contextId+"'"),'1');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Excluir Contexto multipagina.pdf',exact:true}).click();
 await page.getByRole('status').filter({hasText:'PDF excluído.'}).waitFor();
 assert.equal(db("SELECT count(*) FROM file_version WHERE id='"+contextId+"'"),'0');
 assert.equal(BigInt(db('SELECT used_bytes FROM file_store_counter')),bytesBefore-BigInt(multipagePdf().length));
 assert.equal((await page.request.delete(base+'/api/contexto/'+contextId,{headers:{Origin:base}})).status(),200);
 await page.reload();assert.equal(await page.getByRole('button',{name:'Excluir Preservado.pdf',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Excluir Contexto multipagina.pdf',exact:true}).count(),0);
 console.log('OK: excluir PDF exige sessão/origem válida, permite cancelar, libera quota e preserva outro PDF. Repetição é segura.');
 const a=await create('Equipe Alfa sintética'),b=await create('Equipe Beta sintética');
 const mapping={id:0,project:1,date:2,activity:3,amount:4,executor:5};
 const sourceId=await source('ID;Projeto;Data;Atividade;Valor;Executor\nE1;Equipe Alfa sintética;2026-09-09;Primeira;10,00;Ana Silva\nE2;Equipe Alfa sintética;2026-09-09;Segunda;20,00;ana  silva\nE3;Equipe Alfa sintética;2026-09-09;Terceira;30,00;Bruno Lima\nE4;Equipe Beta sintética;2026-09-09;Quarta;40,00;Carla Souza\n');
 await apply(await post('/api/sources/resources',{action:'prepare',sourceId,ordinal:0,mapping}));
 assert.deepEqual(await executorList(a),['ana silva','bruno lima']);assert.deepEqual(await executorList(b),['carla souza']);
 const noNames=await source('ID;Data;Atividade;Valor\nE1;2026-09-09;Primeira;10,00\nE2;2026-09-09;Segunda;20,00\nE3;2026-09-09;Terceira;30,00\n');
 await apply(await post('/api/sources/resources',{action:'prepare',sourceId:noNames,ordinal:0,projectId:a,mapping:{id:0,date:1,activity:2,amount:3}}));
 assert.deepEqual(await executorList(a),['ana silva','bruno lima']);
 const renamed=await source('ID;Data;Atividade;Valor;Executor\nE1;2026-09-09;Primeira;10,00;\nE2;2026-09-09;Segunda;20,00;\nE3;2026-09-09;Terceira;30,00;Daniel Alves\n');
 const changed=await post('/api/sources/resources',{action:'prepare',sourceId:renamed,ordinal:0,projectId:a,mapping:{id:0,date:1,activity:2,amount:3,executor:4}});
 assert.deepEqual(changed.differences.map(d=>d.id),['E3']);await apply(changed);
 assert.deepEqual(await executorList(a),['ana silva','daniel alves']);assert.deepEqual(await executorList(b),['carla souza']);
 await page.screenshot({path:'/tmp/tria-local-executores.png'});
 console.log('OK: executores globais/por projeto, deduplicação, vazios/ausência preservados e alteração com decisão.');
 const replacement=await source('ID;Projeto;Data;Atividade;Valor;Executor\nE1;Equipe Alfa sintética;2026-09-09;Primeira;10,00;Ana Silva\n');
 await apply(await post('/api/sources/resources',{action:'prepare',sourceId:replacement,ordinal:0,projectId:a,mapping}),{E2:'incoming',E3:'incoming'});
 assert.deepEqual(await executorList(a),['ana silva']);
 assert.deepEqual(await executorList(b),['carla souza']);
 console.log('OK: executores de linhas removidas não reaparecem a partir do histórico.');
 const fiscalSource=await source('ID;Número;Data;Valor;Projeto\nNF-E2E-1;99001;2026-09-09;100,00;Equipe Alfa sintética\nNF-E2E-2;99002;2026-09-09;25,00;Equipe Beta sintética\n');
 const fiscalPreview=await post('/api/sources/fiscal',{action:'prepare',sourceId:fiscalSource,ordinal:0,mapping:{sourceId:0,number:1,date:2,amount:3,project:4}});
 assert.equal(fiscalPreview.errorCount,0);await post('/api/sources/fiscal',{action:'apply',id:fiscalPreview.id,hash:fiscalPreview.hash,confirmed:true});
 const noteId=fiscalPreview.rows.find(row=>row.number==='99001').id;
 db(`WITH batch AS (INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES(gen_random_uuid(),'financial_relations','synthetic-e2e',repeat('c',64),1,'completed') RETURNING id) INSERT INTO financial_relation(fiscal_note_id,batch_id,candidate_project_id,strength,state,verified_related_value) SELECT '${noteId}',id,'${b}','Verificada','Confirmada',40 FROM batch`);
 const fiscalTotals=()=>JSON.parse(db(`SELECT json_build_object('total',(SELECT coalesce(sum(amount),0)::text FROM effective_fiscal_note),'a',(SELECT coalesce(sum(amount),0)::text FROM effective_fiscal_note WHERE declared_project_id='${a}'),'b',(SELECT coalesce(sum(amount),0)::text FROM effective_fiscal_note WHERE declared_project_id='${b}'),'related',(SELECT coalesce(sum(verified_related_value),0)::text FROM effective_fiscal_note WHERE candidate_project_id='${b}'))`));
 assert.deepEqual(Object.values(fiscalTotals()).map(Number),[125,100,25,40]);
 async function reportText(path){const response=await page.request.get(base+path);assert.equal(response.status(),200,await response.text().then(text=>text.slice(0,80)));return execFileSync('docker',['exec','-i','tria-project-import-test-app-1','pdftotext','-','-'],{input:await response.body(),encoding:'utf8'});}
 assert.match(await reportText('/api/reports/projects/'+a),/100,00/);
 await page.goto(base+'/notas-fiscais?nota='+noteId);
 // Confirmação explícita da nota sintética pelo fluxo visível.
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('summary').filter({hasText:/^Excluir$/}).first().click();
 const deletion=page.locator('form').filter({has:page.getByRole('button',{name:'Confirmar exclusão',exact:true})}).first();
 await deletion.getByLabel('Motivo da exclusão').fill('Nota sintética excluída no teste local');
 await deletion.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('excluída')||document.body.innerText.includes('não foi encontrada'));
 assert.deepEqual(Object.values(fiscalTotals()).map(Number),[25,0,25,0]);
 assert.equal(db(`SELECT count(*) FROM fiscal_note WHERE id='${noteId}'`),'1');
 const newGlobal=await reportText('/api/reports/global');assert.match(newGlobal,/25,00/);
 const newProject=await reportText('/api/reports/projects/'+a);assert.doesNotMatch(newProject,/100,00/);
 await page.goto(base+'/notas-fiscais');assert.match(await page.locator('main').innerText(),/99002/);assert.doesNotMatch(await page.locator('main').innerText(),/99001/);
 console.log('OK: excluir nota via UI recalcula vínculos e total geral; relatórios novos refletem exclusão; fonte e nota restante preservadas.');
 assert.equal((await fetch(base+'/api/contexto',{method:'POST',body:Buffer.from('teste')})).status,401);
 assert.deepEqual(errors,[]);
} catch(error){console.log('UI failure:',await page.locator('body').innerText());console.log('Page errors:',errors);await page.screenshot({path:'/tmp/tria-local-requirements-failure.png',fullPage:true});throw error;} finally {await browser.close();}
