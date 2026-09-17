import {beforeEach,expect,it,vi} from 'vitest';
import {parse} from 'csv-parse/sync';
import {GET} from '@/app/api/sources/resources/export/route';
const state=vi.hoisted(()=>({authenticated:true,exists:true,project:'Projeto A' as string|null,calls:[] as string[]}));
const rows=vi.hoisted(()=>[
 {id:'A1',project:'Projeto A',activity:'=texto;"teste"',date:'2026-01-01',executor:'Ana',amount:'10',hours:'2',nature:''},
 {id:'B1',project:'Projeto B',activity:'B',date:'2026-02-01',executor:'Bia',amount:'20',hours:'1',nature:''},
 ...Array.from({length:110},(_,i)=>({id:`A${i+2}`,project:'Projeto A',activity:'A',date:'',executor:'',amount:'0',hours:'0',nature:''})),
]);
vi.mock('@/lib/auth',()=>({apiAuthenticationStatus:async()=>state.authenticated?'authenticated':'unauthenticated'}));
vi.mock('@/lib/database',()=>({getSql:()=>async(parts:TemplateStringsArray)=>{
 const query=parts.join('');state.calls.push(query);
 return query.includes('FROM resource_import')?(state.exists?[{rows}]:[]):(state.project===null?[]:[{id:'BMP-001',title:'Projeto renomeado',source_title:state.project},{id:'manual-1',title:'Outro cadastro',source_title:'Outra origem'}]);
}}));
const id='11111111-1111-4111-8111-111111111111';
const request=(suffix='')=>new Request(`http://localhost/api/sources/resources/export?id=${id}${suffix}`);
beforeEach(()=>{state.authenticated=true;state.exists=true;state.project='Projeto A';state.calls=[];});
it('exporta toda a base global e protege textos CSV sem alterar os valores',async()=>{
 const before=JSON.stringify(rows);const response=await GET(request());
 const data=parse(await response.text(),{bom:true,delimiter:';',columns:true}) as Record<string,string>[];
 expect(data).toHaveLength(112);expect(data[0]['Atividade']).toBe(`'=texto;"teste"`);
 expect(data[0]['Valor (R$)']).toBe('10');expect(JSON.stringify(rows)).toBe(before);
 expect(state.calls).toHaveLength(1);
});
it('exporta todos e somente os lançamentos do projeto, além da amostra de 100',async()=>{
 const response=await GET(request('&projectId=BMP-001'));
 const data=parse(await response.text(),{bom:true,delimiter:';',columns:true}) as Record<string,string>[];
 expect(data).toHaveLength(111);expect(data.every(r=>r.Projeto==='Projeto A')).toBe(true);
 expect(response.headers.get('Content-Disposition')).toContain('projeto-BMP-001');
 expect(state.calls.every(q=>q.trim().startsWith('SELECT'))).toBe(true);
});
it('usa o nome de origem do projeto e nunca retorna a base global para recorte vazio',async()=>{
 state.project='Nome original';const response=await GET(request('&projectId=manual-1'));
 expect(parse(await response.text(),{bom:true,delimiter:';',columns:true})).toEqual([]);
});
it('bloqueia acesso sem sessão, parâmetros inválidos, versão e projeto ausentes',async()=>{
 state.authenticated=false;expect((await GET(request())).status).toBe(401);expect(state.calls).toEqual([]);
 state.authenticated=true;expect((await GET(request('&projectId='))).status).toBe(400);
 expect((await GET(new Request('http://localhost/?id=invalid'))).status).toBe(400);
 state.exists=false;expect((await GET(request())).status).toBe(404);
 state.exists=true;state.project=null;expect((await GET(request('&projectId=inexistente'))).status).toBe(404);
});
