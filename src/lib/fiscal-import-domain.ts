import { decimal, normalizeHeader } from "./resource-import-domain";
import {matchingResourceProjects} from './resource-project-resolution';
export const fiscalFields = [
 {key:"sourceId",label:"ID da nota",aliases:["id nfs-e","id da nota","id"]},
 {key:"number",label:"Número da NFS-e",aliases:["nfs-e","numero","número da nfs-e"]},
 {key:"date",label:"Emissão",aliases:["emissao","data","data de emissao"]},
 {key:"amount",label:"Valor da NFS-e",aliases:["valor nfs-e","valor","valor (r$)"]},
 {key:"category",label:"Categoria (opcional)",aliases:["categoria"]},
 {key:"project",label:"Projeto declarado (opcional)",aliases:["projeto vinculado","projeto declarado na fonte","projeto"]},
] as const;
export type FiscalImportRow={sourceId:string;number:string;date:string;year:number;amount:string;category:string|null;projectId:string|null;project:string};
export function fiscalMapping(headers:string[]) {return Object.fromEntries(fiscalFields.map(field=>[field.key,headers.findIndex(header=>field.aliases.some(alias=>normalizeHeader(alias)===normalizeHeader(header)))]));}
export function validateFiscalRows(rows:string[][],mapping:Record<string,number>,width:number,projects:Array<{id:string;title:string;sourceTitle?:string}>,locators?:string[]) {
 const errors:string[]=[],valid:FiscalImportRow[]=[],ids=new Set<string>(),numbers=new Set<string>();
 const columns=Object.values(mapping).filter(index=>index>=0);
 if(columns.some(index=>!Number.isInteger(index)||index>=width)||new Set(columns).size!==columns.length)throw Error("Cada campo precisa de uma coluna válida e diferente.");
 for(const key of ["sourceId","number","date","amount"])if(!(mapping[key]>=0))throw Error("Mapeie ID, número, emissão e valor.");
 const normalize=(value:string)=>normalizeHeader(value).replace(/\s+/g," ");
 rows.forEach((row,index)=>{
  if(row.every(cell=>!cell.trim()))return;
  try {
   const get=(key:string)=>(row[mapping[key]] ?? "").trim();
   if(fiscalFields.some(field=>get(field.key).startsWith("=")))throw Error("fórmula encontrada; importe valores calculados");
   const sourceId=get("sourceId"),number=get("number");
   if(!sourceId||sourceId.length>200||!number||number.length>100)throw Error("ID ou número inválido");
   if(ids.has(sourceId))throw Error("ID repetido na planilha");ids.add(sourceId);
   let date=get("date");if(/^\d{2}\/\d{2}\/\d{4}$/.test(date))date=date.split("/").reverse().join("-");
   if(/^\d{5}$/.test(date))date=new Date(Date.UTC(1899,11,30)+Number(date)*86400000).toISOString().slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error("data de emissão inválida");
   const year=Number(date.slice(0,4));if(year<1900||year>2100)throw Error("ano fora do intervalo 1900–2100");
   const key=`${year}|${normalize(number)}`;if(numbers.has(key))throw Error("mesmo número e ano aparecem mais de uma vez; confira as notas antes de importar");numbers.add(key);
   const value=decimal(get("amount"));if(value.startsWith("-")||!/^\d+(\.\d{1,2})?$/.test(value))throw Error("valor deve ser positivo ou zero, com até duas casas decimais");
   const [integer,fraction=""]=value.split(".");const amount=`${BigInt(integer)}.${fraction.padEnd(2,"0")}`;
   const project=get("project"),category=get("category")||null;if((category?.length??0)>200||project.length>300)throw Error("categoria ou projeto muito longo");
   const matches=matchingResourceProjects(projects.map(item=>({id:item.id,title:normalize(item.title),source_title:normalize(item.sourceTitle||item.title)})),normalize(project));
   if(project&&matches.length!==1)throw Error(`projeto não identificado: ${project}. Cadastre ou corrija o nome antes de importar`);
   valid.push({sourceId,number,date,year,amount,category,projectId:project?matches[0].id:null,project});
  }catch(error){errors.push(`Linha ${locators?.[index]?.replace(/^row:/, "") ?? index+2}: ${error instanceof Error?error.message:"inválida"}.`);}
 });
 if(!valid.length&&!errors.length)errors.push("A aba não contém notas.");
 return {rows:valid,errors};
}
