import { describe, expect, it } from "vitest";
import { validateResourceRows, suggestResourceMapping, compareResources, cents, resourceTotalCents } from "./resource-import-domain";
const headers = ["ID", "Projeto", "Data", "Atividade", "Valor (R$)", "Horas", "Executor", "Curso", "Trilha"];
const mapping = suggestResourceMapping(headers);
describe("Carga real de recursos", () => {
 it("preserva precisão e negativos sem importar identificação ou cursos", () => {
   const result = validateResourceRows([["L01","Projeto A","22/08/2024","Atividade","-1.234,5678","1.5","privado","curso","trilha"]],mapping,headers.length);
   expect(result.errors).toEqual([]); expect(result.rows[0].amount).toBe("-1234.5678");
   expect(cents(result.rows[0].amount)).toBe(-123457n); expect(JSON.stringify(result.rows)).not.toContain("privado");
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
