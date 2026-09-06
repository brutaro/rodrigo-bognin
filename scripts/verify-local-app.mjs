import { readFile } from 'node:fs/promises';
const base='http://127.0.0.1:3100';
const health=await fetch(base+'/api/health');
if(!health.ok || (await health.json()).status!=='ok') throw new Error('Ambiente local não está saudável.');
const html=await (await fetch(base+'/entrar')).text();
const action=html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
if(!action) throw new Error('Formulário de entrada indisponível.');
const form=new FormData();form.set(action,'');form.set('codigo',(await readFile('.secrets/tria_login_code','utf8')).trim());
const login=await fetch(base+'/entrar',{method:'POST',headers:{Origin:base},body:form,redirect:'manual'});
const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
if(!cookie) throw new Error('Não foi possível entrar.');
for(const route of ['/','/projetos','/fontes/base-consolidada','/notas-fiscais','/publicacoes','/api/reports/global']) {
 const response=await fetch(base+route,{headers:{Cookie:cookie},redirect:'manual'});
 if(response.status!==200) throw new Error(`${route}: HTTP ${response.status}`);
 if(route.includes('/api/')) { const bytes=Buffer.from(await response.arrayBuffer()); if(bytes.subarray(0,5).toString()!=='%PDF-') throw new Error('PDF inválido'); }
 console.log(`${route}: OK`);
}
const denied=await fetch(base+'/api/reports/global',{redirect:'manual'});
if(denied.status!==401) throw new Error('Relatório acessível sem sessão.');
console.log('Verificação local concluída: login, páginas, PDF e acesso privado.');
