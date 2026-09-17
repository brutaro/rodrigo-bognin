import {beforeEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ResourceSummary} from './resource-summary';
const data=vi.hoisted(()=>({rows:[{id:'A1',project:'Origem A',activity:'Atividade A',date:'2024-05-01',executor:'Ana',amount:'10',hours:'2',nature:''},{id:'B1',project:'Origem B',activity:'Outra atividade',date:'',executor:'',amount:'20',hours:'0',nature:''}]}));
vi.mock('@/lib/database',()=>({isDatabaseConfigured:()=>true}));
vi.mock('@/lib/resource-project-import',()=>({resourceProjectCatalog:async()=>[{id:'BMP-001',title:'Nome atual',source_title:'Origem A'},{id:'BMP-002',title:'Outro projeto',source_title:'Origem B'}]}));
vi.mock('@/lib/resource-import',()=>({currentResources:async()=>({id:'11111111-1111-4111-8111-111111111111',rows:data.rows,appliedAt:'2026-09-11T12:00:00Z',sheet:'Base'})}));
vi.mock('@/lib/workspace',()=>({formatBrlFromCents:(s:string)=>`BRL ${s}`}));
beforeEach(()=>vi.clearAllMocks());
it('mostra as colunas na ordem pedida e mantém a exportação global',async()=>{
 const before=JSON.stringify(data.rows);const html=renderToStaticMarkup(await ResourceSummary({}));
 const headers=[...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1].replace(/<[^>]*>/g,''));
 expect(headers).toEqual(['ID','Projeto / atividade','Data','Executor','Valor/hora','Valor']);
 expect(html).toContain('01/05/2024');expect(html).toContain('Ana');expect(html).toContain('BRL 500');expect(html).toContain('Não informado');
 expect(html).not.toContain('&amp;projectId=');expect(html).toContain('BRL 3000');expect(JSON.stringify(data.rows)).toBe(before);
});
it('mantém o recorte por nome de origem e inclui o ID do projeto no download',async()=>{
 const html=renderToStaticMarkup(await ResourceSummary({projectId:'BMP-001',projectTitle:'Origem A'}));
 expect(html).toContain('&amp;projectId=BMP-001');expect(html).toContain('Atividade A');expect(html).not.toContain('Outra atividade');expect(html).toContain('BRL 1000');
});
