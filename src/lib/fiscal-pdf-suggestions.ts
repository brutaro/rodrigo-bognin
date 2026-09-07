import {fiscalNumberKey} from './fiscal-pdf-domain';
export type FiscalSuggestionField='number'|'date'|'amount';
export type FiscalPdfSuggestions={suggestions:Partial<Record<FiscalSuggestionField,{value:string;evidence:string}>>;warnings:string[]};
const labels:Record<FiscalSuggestionField,RegExp>={
 number:/^(?:numero|n[º°o.]?)\s+(?:(?:da|de)\s+)?(?:nfs[ -]?e|nota(?:\s+fiscal)?)(?=\s|:|$)/,
 date:/^data\s+(?:de\s+)?emissao(?=\s|:|$)/,
 amount:/^valor\s+(?:total\s+(?:(?:dos?|da)\s+)?(?:servicos|nota(?:\s+fiscal)?)|bruto(?:\s+da\s+nota)?)(?=\s|:|$)/,
};
const names={number:'Número da nota',date:'Data de emissão',amount:'Valor bruto'};
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function valueFor(field:FiscalSuggestionField,raw:string):string|undefined {
 const value=raw.trim();
 if(field==='number')return /^\d[\dA-Za-z./-]{0,99}$/.test(value)?value:undefined;
 if(field==='date'){
  const match=/^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  const date=match?`${match[3]}-${match[2]}-${match[1]}`:value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<1900||Number(date.slice(0,4))>2100)return;
  return Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:undefined;
 }
 const money=value.replace(/^R\$\s*/i,'');
 // Require cents and a single locale; do not reinterpret taxes or adjacent columns.
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(money)&&!/^\d+\.\d{2}$/.test(money))return;
 const decimal=money.includes(',')?money.replace(/\./g,'').replace(',','.'):money;
 if(decimal.length>30)return;
 const [integer,cents]=decimal.split('.');return `${BigInt(integer)}.${cents}`;
}
export function suggestFiscalPdf(pages:string[]):FiscalPdfSuggestions {
 const result:FiscalPdfSuggestions={suggestions:{},warnings:[]};
 if(pages.length>20||pages.reduce((n,p)=>n+p.length,0)>100000)return {...result,warnings:['PDF acima do limite de 20 páginas ou 100 mil caracteres. Preencha manualmente.']};
 const unsafe=new Set<FiscalSuggestionField>();let numberLabels=0;
 const candidates:Record<FiscalSuggestionField,Map<string,{value:string;evidence:string}>>={number:new Map(),date:new Map(),amount:new Map()};
 for(const page of pages){
  const lines=page.split(/\r?\n/).map(s=>s.normalize('NFC').replace(/\s+/g,' ').trim());
  lines.forEach((line,index)=>{
   const normalized=normalize(line);
   for(const field of Object.keys(labels) as FiscalSuggestionField[]){
    const match=labels[field].exec(normalized);if(!match)continue;
    if(field==='number')numberLabels++;
    const suffix=line.slice(match[0].length).replace(/^\s*[:=]?\s*/,'');
    const raw=suffix?suffix:lines[index+1]??'';
    const value=valueFor(field,raw);if(value===undefined){unsafe.add(field);continue;}
    const evidence=(suffix?line:`${line} ${lines[index+1]??''}`).slice(0,180);
    candidates[field].set(field==='number'?fiscalNumberKey(value):value,{value,evidence});
   }
  });
 }
 for(const field of Object.keys(labels) as FiscalSuggestionField[]){
  const values=candidates[field];
  if(values.size===1&&!unsafe.has(field))result.suggestions[field]=[...values.values()][0];
  else result.warnings.push(unsafe.has(field)?`${names[field]}: há um rótulo sem valor seguro; confira e preencha manualmente.`:values.size>1?`${names[field]}: valores diferentes encontrados; confira e preencha manualmente.`:`${names[field]}: não reconhecido com segurança; preencha manualmente.`);
 }
 if(candidates.number.size>1||(numberLabels>1&&unsafe.has('number'))){result.suggestions={};result.warnings.push('O PDF pode conter mais de uma nota. Use um PDF por nota e confira todos os campos.');}
 return result;
}
