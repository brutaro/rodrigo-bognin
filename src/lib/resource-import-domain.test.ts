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
