import {describe,it,expect} from "vitest";
import {fiscalMapping,validateFiscalRows} from "./fiscal-import-domain";
const headers=["ID NFS-e","NFS-e","Emissão","Valor NFS-e","Categoria","Projeto vinculado","Documento tomador"];
const mapping=fiscalMapping(headers),projects=[{id:"p",title:"Nome atual",sourceTitle:"Nome original"}];
const row=["2024|NFS-e 002","NFS-e 002","02/09/2024","2.846,54","Viagens","Nome original","privado"];
describe("Importação fiscal",()=>{
 it("reconhece número da NFS-e com acentos e informa a linha física do erro",()=>{
  expect(fiscalMapping(["Número da NFS-e"]).number).toBe(0);
  expect(validateFiscalRows([[...row.slice(0,2),"inválida",...row.slice(3)]],mapping,headers.length,projects,["row:4"]).errors[0]).toMatch(/^Linha 4:/);
 });
 it("preserva ID e centavos, deriva ano e reconhece projeto renomeado",()=>{
  const result=validateFiscalRows([row],mapping,headers.length,projects);
  expect(result.errors).toEqual([]);expect(result.rows[0]).toMatchObject({sourceId:row[0],amount:"2846.54",date:"2024-09-02",year:2024,projectId:"p"});expect(JSON.stringify(result)).not.toContain("privado");
 });
 it("recusa duplicatas, fórmula, data impossível, centavos excessivos e projeto desconhecido",()=>{
  expect(validateFiscalRows([row,row],mapping,headers.length,projects).errors).toHaveLength(1);
  expect(validateFiscalRows([row,["outro",...row.slice(1)]],mapping,headers.length,projects).errors).toHaveLength(1);
  for(const [index,value] of [[2,"31/02/2024"],[3,"1.001"],[3,"=SUM(A1)"],[5,"Desconhecido"]] as const){const invalid=[...row];invalid[index]=value;expect(validateFiscalRows([invalid],mapping,headers.length,projects).errors).toHaveLength(1);}
 });
});
