import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import yazl from 'yazl';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.STORY32_BASE_URL;
if(!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Loopback browser target required');
const output=process.env.STORY32_EVIDENCE_DIR;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const page=await context.newPage();
const errors=[]; let action;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
page.on('request',r=>{if(r.headers()['next-action']){try{if(JSON.parse(r.postData())?.[0]?.previewHash)action={headers:r.headers(),body:r.postData()};}catch{}}});
async function upload(name,buffer){await page.getByLabel('Arquivo sintético',{exact:true}).setInputFiles({name,mimeType:name.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});await page.getByRole('button',{name:'Receber e proteger',exact:true}).click();await page.getByRole('article',{name:'Recibo de proteção'}).waitFor();}
async function map(){for(const field of ['codigo','data','valor']) await page.getByLabel(`Coluna ${field}`,{exact:true}).selectOption(field);}
async function prepare(){await page.getByRole('button',{name:'Preparar prévia',exact:true}).click();await page.getByRole('article',{name:'Prévia preparada',exact:true}).waitFor();}
async function confirm(){assert.equal(await page.getByRole('button',{name:'Confirmar esta prévia',exact:true}).isDisabled(),true);await page.getByLabel('Conferi as contagens e as linhas desta prévia').check();await page.getByRole('button',{name:'Confirmar esta prévia',exact:true}).click();await page.getByRole('article',{name:'Resultado da confirmação'}).waitFor();}
async function tabTo(target){
  for(let count=0;count<70;count++){
    if(await target.evaluate(element=>element===document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Control unreachable through sequential keyboard navigation');
}
async function activate(target){await tabTo(target);await page.keyboard.press('Enter');}
async function chooseWithKeyboard(target,value){
  await tabTo(target);
  const label=await target.locator('option').evaluateAll((options,value)=>options.find(option=>option.value===value)?.textContent,value);
  assert.ok(label);await page.keyboard.type(label,{delay:30});
  await page.keyboard.press('Tab');assert.equal(await target.inputValue(),value);
}
async function keyboardJourney(){
  await page.goto(`${base}/fontes/base-consolidada`);
  const file=page.getByLabel('Arquivo sintético',{exact:true});await tabTo(file);
  const choosing=page.waitForEvent('filechooser');await page.keyboard.press('Space');
  await (await choosing).setFiles({name:'keyboard.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFFcodigo;data;valor\nK-1;2026-01-01;10.50\nK-2;bad;abc\n')});
  await activate(page.getByRole('button',{name:'Receber e proteger',exact:true}));await page.getByRole('article',{name:'Recibo de proteção'}).waitFor();
  await chooseWithKeyboard(page.getByLabel('Codificação',{exact:true}),'utf-8-bom');
  await chooseWithKeyboard(page.getByLabel('Delimitador',{exact:true}),';');
  await activate(page.getByRole('button',{name:'Inspecionar estrutura',exact:true}));await page.getByLabel('Coluna codigo',{exact:true}).waitFor();
  for(const field of ['codigo','data','valor'])await chooseWithKeyboard(page.getByLabel(`Coluna ${field}`,{exact:true}),field);
  await activate(page.getByRole('button',{name:'Preparar prévia',exact:true}));await page.getByRole('article',{name:'Prévia preparada',exact:true}).waitFor();
  await activate(page.getByRole('button',{name:'Com erro: 1',exact:true}));
  await activate(page.getByText('row:3 — 2 erro(s)',{exact:true}));await page.getByText(/Original: bad; normalizado/).waitFor();
  const agreement=page.getByLabel('Conferi as contagens e as linhas desta prévia');await tabTo(agreement);await page.keyboard.press('Space');assert.equal(await agreement.isChecked(),true);
  await activate(page.getByRole('button',{name:'Confirmar esta prévia',exact:true}));await page.getByRole('article',{name:'Resultado da confirmação'}).waitFor();
  await page.reload();await page.getByRole('article',{name:'Resultado da confirmação'}).waitFor({timeout:45000});assert.equal(await page.locator('[aria-current="step"]').count(),1);
  await page.screenshot({path:`${output}/keyboard-confirmed.png`,fullPage:true});
}
async function workbook(){const z=new yazl.ZipFile();const entries={
'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Sintética" r:id="r1"/></sheets></workbook>',
'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>codigo</t></is></c><c r="B1" t="inlineStr"><is><t>data</t></is></c><c r="C1" t="inlineStr"><is><t>valor</t></is></c></row><row r="7"><c r="A7" t="inlineStr"><is><t>X-1</t></is></c><c r="B7" t="inlineStr"><is><t>2026-01-01</t></is></c></row></sheetData></worksheet>'};for(const [path,value]of Object.entries(entries))z.addBuffer(Buffer.from(value),path);z.end();return await new Promise((resolve,reject)=>{const chunks=[];z.outputStream.on('data',b=>chunks.push(b));z.outputStream.on('error',reject);z.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));});}
try{
  const anon=await browser.newContext();const denied=await anon.request.post(`${base}/api/sources/consolidated`,{data:'codigo\nA',headers:{'Content-Type':'text/csv','X-TRIA-File-Name':'synthetic.csv','X-TRIA-File-Size':'8',origin:base}});assert.equal(denied.status(),401);await anon.close();
  await page.goto(`${base}/fontes/base-consolidada`);await page.waitForURL('**/entrar');
  await page.getByLabel('Código de acesso').fill(process.env.STORY32_LOGIN_CODE);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(base+'/');
  await page.goto(`${base}/fontes/base-consolidada`);
  await upload('synthetic-bom.csv',Buffer.from('\uFEFFcodigo;curso;curso;trilha;data;valor\nS-1;discard;discard;discard;2026-01-01;10.500\nS-2;x;x;x;bad;abc\n'));
  await page.getByLabel('Codificação',{exact:true}).selectOption('utf-8-bom');await page.getByLabel('Delimitador',{exact:true}).selectOption(';');
  await page.getByRole('button',{name:'Inspecionar estrutura',exact:true}).click();await page.getByText('Mapeie cada coluna funcional para continuar.',{exact:true}).waitFor();await map();await prepare();
  assert.equal(await page.locator('[aria-current="step"]').count(),1);
  await page.getByRole('button',{name:'Com erro: 1',exact:true}).click();await page.getByText('row:3 — 2 erro(s)',{exact:true}).click();await page.getByText(/Original: bad; normalizado/).waitFor();
  await page.getByLabel('Coluna valor',{exact:true}).selectOption('');assert.equal(await page.getByRole('article',{name:'Prévia preparada',exact:true}).count(),0);await page.getByLabel('Coluna valor',{exact:true}).selectOption('valor');await prepare();
  // Delayed server responses must not restore a preview invalidated by new input.
  await page.getByLabel('Coluna valor',{exact:true}).selectOption('valor');
  let release;const hold=new Promise(resolve=>{release=resolve;});let capturedResolve;const captured=new Promise(resolve=>{capturedResolve=resolve;});
  await page.route('**/fontes/base-consolidada',async route=>{if(route.request().method()==='POST' && route.request().headers()['next-action']){const response=await route.fetch();capturedResolve();await hold;await route.fulfill({response});}else await route.continue();});
  await page.getByRole('button',{name:'Preparar prévia',exact:true}).click();await captured;await page.getByLabel('Coluna valor',{exact:true}).selectOption('');release();await page.unrouteAll({behavior:'wait'});await page.waitForTimeout(150);assert.equal(await page.getByRole('article',{name:'Prévia preparada',exact:true}).count(),0);
  await page.getByLabel('Coluna valor',{exact:true}).selectOption('valor');await prepare();await confirm();
  await page.screenshot({path:`${output}/desktop-confirmed.png`,fullPage:true});
  await page.reload();await page.getByRole('article',{name:'Resultado da confirmação'}).waitFor({timeout:45000});assert.equal(await page.getByLabel('Codificação',{exact:true}).inputValue(),'utf-8-bom');assert.equal(await page.getByLabel('Delimitador',{exact:true}).inputValue(),';');assert.equal(await page.getByLabel('Coluna valor',{exact:true}).inputValue(),'valor');assert.equal(await page.locator('[aria-current="step"]').count(),1);
  await page.screenshot({path:`${output}/reload-confirmed.png`,fullPage:true});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:640,height:450,deviceScaleFactor:2,mobile:false});
  assert.deepEqual(await page.evaluate(()=>({width:innerWidth,scale:devicePixelRatio})),{width:640,scale:2});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.screenshot({path:`${output}/zoom-200.png`,fullPage:true});
  await cdp.send('Emulation.clearDeviceMetricsOverride');await page.setViewportSize({width:320,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.screenshot({path:`${output}/mobile-320.png`,fullPage:true});
  await page.getByLabel('Codificação',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Delimitador',{exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.setViewportSize({width:1280,height:900});await upload('synthetic.xlsx',await workbook());assert.equal(await page.getByRole('article',{name:'Resultado da confirmação'}).count(),0);
  await page.getByRole('button',{name:'Inspecionar estrutura',exact:true}).click();await page.getByLabel('Aba',{exact:true}).waitFor();assert.equal(await page.getByLabel('Aba',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'Preparar prévia',exact:true}).count(),0);
  await page.getByLabel('Aba',{exact:true}).selectOption({label:'Sintética'});await page.getByLabel('Coluna codigo',{exact:true}).waitFor();await map();await prepare();await confirm();await page.reload();await page.getByRole('article',{name:'Resultado da confirmação'}).waitFor({timeout:45000});
  assert.equal(await page.getByLabel('Aba',{exact:true}).locator('option:checked').textContent(),'Sintética');
  await keyboardJourney();
  // Replay the observed real Action transport without authentication, then with a foreign Origin.
  if(!action)throw new Error('No real Server Action observed');const outsider=await browser.newContext();
  const headers={...action.headers,origin:base};delete headers.cookie;delete headers['content-length'];delete headers.host;
  const response=await outsider.request.post(`${base}/fontes/base-consolidada`,{headers,data:action.body,maxRedirects:0});assert.equal(response.status(),307);assert.match(response.headers().location,/\/entrar$/);await outsider.close();
  const altered=JSON.parse(action.body);altered[0].schema={fields:['forged']};
  const rejected=await context.request.post(`${base}/fontes/base-consolidada`,{headers,data:JSON.stringify(altered)});assert.match(await rejected.text(),/CONFIRMATION_INVALID/);
  const wrong=await context.request.post(`${base}/fontes/base-consolidada`,{headers:{...headers,origin:'https://invalid.test'},data:action.body});assert.ok(wrong.status()>=400 || /Invalid Server Actions|SOURCE_PREPARATION_UNAVAILABLE/.test(await wrong.text()));
  await page.addInitScript(()=>{Storage.prototype.getItem=function(){throw new Error('storage blocked');};});await page.reload();
  await page.getByRole('status').filter({hasText:'Armazenamento local indisponível'}).waitFor({timeout:45000});
  assert.equal(await page.getByRole('article',{name:'Prévia preparada',exact:true}).count(),0);
  assert.deepEqual(errors,[]);await writeFile(`${output}/browser-result.json`,JSON.stringify({verdict:'PASS',journeys:['CSV BOM upload→attestation→inspect→map→preview→explicit confirmation→reload','XLSX explicit sheet→map→preview→confirmation→reload','Sequential Tab/keyboard upload→CSV options→mapping→preview→error drill-down→confirmation; persisted reload'],checks:['stale mapping','delayed action','one aria-current','owner auth','foreign origin','320px','640 CSS px with DPR 2 (200% emulation, not browser zoom)','full keyboard controls journey'],errors},null,2));
  console.log(`G-13 browser PASS: ${output}`);
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/failure.txt`,String(error)+'\n'+await page.locator('body').innerText().catch(()=>''));throw error;}finally{await browser.close();}
