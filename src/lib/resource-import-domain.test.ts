import { describe, expect, it } from "vitest";
import { validateResourceRows, suggestResourceMapping, compareResources, cents, resourceTotalCents } from "./resource-import-domain";
const headers = ["ID", "Projeto", "Data", "Atividade", "Valor (R$)", "Horas", "Executor", "Curso", "Trilha"];
const mapping = suggestResourceMapping(headers);
describe("Carga real de recursos", () => {
 it("preserva precisão e negativos com executor e sem cursos", () => {
   const result = validateResourceRows([["L01","Projeto A","22/08/2024","Atividade","-1.234,5678","1.5","privado","curso","trilha"]],mapping,headers.length);
   expect(result.errors).toEqual([]); expect(result.rows[0].amount).toBe("-1234.5678");
   expect(cents(result.rows[0].amount)).toBe(-123457n); expect(result.rows[0].executor).toBe("privado"); expect(JSON.stringify(result.rows)).not.toContain("curso");
 });
 it("não aceita ID duplicado, fórmula, data impossível ou mapeamento duplicado",()=>{
   const row=["L01","Projeto A","2024-08-22","Atividade","10",""];
   expect(validateResourceRows([row,row],mapping,headers.length).errors).toHaveLength(1);
   expect(validateResourceRows([[...row.slice(0,4),"=SUM(A1)",""]],mapping,headers.length).errors).toHaveLength(1);
   expect(validateResourceRows([["L1","A","31/02/2024","A","1",""]],mapping,headers.length).errors).toHaveLength(1);
   expect(()=>validateResourceRows([row],{...mapping,amount:0},headers.length)).toThrow();
 });
 it("arredonda o total somente após a soma",()=>{
   const row={id:"a",project:"a",date:"",activity:"",amount:"0.004",hours:"",nature:""};
   expect(resourceTotalCents([row,row,row])).toBe(1n);
   expect(compareResources([JSON.parse(JSON.stringify(row,Object.keys(row).sort()))],[row]).unchanged).toBe(1);
 });
 it("distingue alterações de repetição e ausência sem somar cargas",()=>{
   const row=validateResourceRows([["L1","A","2024-08-22","A","1",""]],mapping,headers.length).rows[0];
   expect(compareResources([row],[row])).toEqual({added:0,changed:0,unchanged:1,absent:0});
   expect(compareResources([row],[{...row,amount:"2"}]).changed).toBe(1);
   expect(compareResources([row],[]).absent).toBe(1);
 });
});

import { resourceDifferences, resolveResourceRows } from "./resource-import-domain";
it("aplica decisões individuais sem perder ausentes mantidos e recusa decisões incompletas", () => {
 const a={id:"A",project:"Projeto",date:"",activity:"",amount:"10",hours:"",nature:""};
 const b={...a,id:"B",amount:"20"};
 const next=[{...a,amount:"15"},{...a,id:"C",amount:"5"}];
 expect(resourceDifferences([a,b],next).map(row=>row.id)).toEqual(["A","B"]);
 expect(()=>resolveResourceRows([a,b],next,{A:"incoming"})).toThrow();
 expect(resolveResourceRows([a,b],next,{A:"incoming",B:"keep"})).toEqual([next[0],next[1],b]);
 expect(resolveResourceRows([a,b],next,{A:"keep",B:"incoming"})).toEqual([a,next[1]]);
 expect(()=>resolveResourceRows([a,b],next,{A:"keep",B:"keep",unknown:"keep"})).toThrow();
});

import { mergeProjectResources } from "./resource-import-domain";
describe("Importação por projeto", () => {
 const scope = {title:"Projeto A", aliases:["Projeto A", "Nome atual"]};
 it("usa o projeto selecionado sem coluna Projeto e confere nomes quando mapeados", () => {
   const simple = suggestResourceMapping(["ID","Data","Atividade","Valor"]);
   const result = validateResourceRows([["A1","2026-09-07","Entrega","25,50"]],simple,4,undefined,scope);
   expect(result.errors).toEqual([]);
   expect(result.rows[0]).toMatchObject({id:"A1",project:"Projeto A",amount:"25.50"});
   expect(validateResourceRows([["A1","Nome atual","","Entrega","25"]],mapping,headers.length,undefined,scope).errors).toEqual([]);
   expect(validateResourceRows([["A1","Projeto B","","Entrega","25"]],mapping,headers.length,undefined,scope).errors[0]).toContain("projeto diferente");
 });
 it("preserva outros projetos e exige decisões apenas sobre o projeto selecionado", () => {
   const a={id:"A1",project:"Projeto A",date:"",activity:"",amount:"10",hours:"",nature:""};
   const b={...a,id:"B1",project:"Projeto B"};
   const absent={...a,id:"A2"};
   const incoming={...a,amount:"20"};
   const merged=mergeProjectResources([a,b,absent],[incoming],scope.title);
   expect(merged).toContainEqual(b);
   expect(resourceDifferences([a,b,absent],merged).map(d=>d.id)).toEqual(["A1","A2"]);
   const resolved=resolveResourceRows([a,b,absent],merged,{A1:"incoming",A2:"keep"});
   expect(resolved).toEqual([b,incoming,absent]);
   expect(()=>resolveResourceRows([a,b,absent],merged,{A1:"incoming",A2:"keep",B1:"incoming"})).toThrow();
 });
 it("bloqueia colisões de ID com outro projeto e não aceita reassociar registros", () => {
   const b={id:"B1",project:"Projeto B",date:"",activity:"",amount:"10",hours:"",nature:""};
   expect(()=>mergeProjectResources([b],[{...b,project:"Projeto A"}],scope.title)).toThrow("já pertence a outro projeto");
   expect(()=>mergeProjectResources([b],[b],scope.title)).toThrow("outro projeto");
 });
});

import {projectExecutors} from './resource-import-domain';
describe('Executores da planilha',()=>{
 const row={id:'L1',project:'A',date:'',activity:'',amount:'1',hours:'',nature:'',executor:'Ana'};
 it('deduplica nomes somente dentro do projeto certo',()=>{
  expect(projectExecutors([row,{...row,id:'L2',executor:' ana '},{...row,id:'L3',executor:'Beatriz'},{...row,project:'B',executor:'Carlos'}],'A')).toEqual(['Ana','Beatriz']);
 });
});

it('aceita Executor/Executores e não apresenta marcador vazio como pessoa',()=>{
 expect(suggestResourceMapping(['Executores']).executor).toBe(0);
 const row={id:'L1',project:'A',date:'',activity:'',amount:'1',hours:'',nature:'',executor:'-'};
 expect(projectExecutors([row,{...row,id:'L2',executor:' '}],'A')).toEqual([]);
});


it("substitui todos os recursos, incluindo zeros, executor vazio e IDs ausentes, sem somar a base antiga", () => {
 const old = {id:"A",project:"Projeto",date:"",activity:"",amount:"50",hours:"2",executor:"Ana",nature:""};
 const incoming = {...old,amount:"0",hours:"0",executor:""};
 const current = [old, {...old,id:"B",amount:"100"}];
 const next = [incoming];
 const decisions = Object.fromEntries(resourceDifferences(current,next).map(row=>[row.id,"incoming" as const]));
 const result = resolveResourceRows(current,next,decisions);
 expect(result).toEqual([incoming]);
 expect(resourceTotalCents(result)).toBe(0n);
 expect(current[0].amount).toBe("50");
 expect(compareResources(result,next)).toEqual({added:0,changed:0,unchanged:1,absent:0});
});

it("importa vazios numéricos como zero mas bloqueia fórmula sem resultado", () => {
 const row = ["L1","Projeto","2026-09-11","Atividade","0","0",""];
 expect(validateResourceRows([row],mapping,headers.length).rows[0]).toMatchObject({amount:"0",hours:"0",executor:""});
 expect(validateResourceRows([[...row.slice(0,4),"",""]],mapping,headers.length).rows[0]).toMatchObject({amount:"0",hours:"0"});
 expect(validateResourceRows([[...row.slice(0,4),"=L2*M2","=1+1"]],mapping,headers.length).errors[0]).toContain("Valor (R$), Horas (opcional): fórmula sem resultado válido salvo");
});
