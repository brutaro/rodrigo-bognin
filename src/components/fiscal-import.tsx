"use client";
import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ConsolidatedSourceUpload} from "./consolidated-source-upload";
import {fiscalFields,type FiscalImportRow} from "@/lib/fiscal-import-domain";
function formatBrlFromCents(value:string){const cents=BigInt(value);return `R$ ${(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,".")},${(cents%100n).toString().padStart(2,"0")}`;}
type Sheet={name:string;ordinal:number;headers:string[];mapping:Record<string,number>;count:number};
type Preview={id:string;hash:string;count:number;added:number;existing:number;conflicts:number;errorCount:number;errors:string[];total:string;rows:Array<FiscalImportRow&{state:string;existingId?:string|null}>};
export function FiscalImport(){
 const router=useRouter();const[source,setSource]=useState("");const[sheets,setSheets]=useState<Sheet[]>([]);const[ordinal,setOrdinal]=useState(0);const[mapping,setMapping]=useState<Record<string,number>>({});const[delimiter,setDelimiter]=useState(";");const[preview,setPreview]=useState<Preview>();const[page,setPage]=useState(0);const[confirmed,setConfirmed]=useState(false);const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");
 async function request(payload:object){const response=await fetch("/api/sources/fiscal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
 async function run(work:()=>Promise<void>){setBusy(true);setMessage("");try{await work();}catch(error){setMessage(error instanceof Error?error.message:"Não foi possível continuar.");}finally{setBusy(false);}}
 function choose(index:number,values=sheets){setOrdinal(index);setMapping(values.find(sheet=>sheet.ordinal===index)?.mapping??{});setPreview(undefined);setConfirmed(false);}
 const sheet=sheets.find(sheet=>sheet.ordinal===ordinal);
 return <div className="space-y-6">
  <ConsolidatedSourceUpload enabled real title="Planilha de notas fiscais" receiptKey="tria-fiscal-source-receipt" onProtected={receipt=>{const id=receipt?.receiptId??"";if(source!==id){setSource(id);setSheets([]);setPreview(undefined);}}}/>
  {source&&<section className="space-y-4 rounded-lg border border-[var(--border)] bg-white p-5">
   <h2 className="text-xl font-bold">2. Escolher os dados</h2>
   <label className="block text-sm">Separador CSV<select aria-label="Separador CSV" value={delimiter} onChange={event=>{setDelimiter(event.target.value);setSheets([]);setPreview(undefined);}} className="ml-2 rounded border p-2"><option value=";">Ponto e vírgula</option><option value=",">Vírgula</option><option value={'\t'}>Tabulação</option></select></label>
   <button disabled={busy} onClick={()=>void run(async()=>{const values:Sheet[]=await request({action:"inspect",sourceId:source,delimiter});setSheets(values);choose(values.find(s=>s.mapping.sourceId>=0&&s.mapping.number>=0)?.ordinal??values[0].ordinal,values);})} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-white">Ler abas e colunas</button>
   {sheet&&<><label className="block text-sm">Aba<select aria-label="Aba de notas fiscais" value={ordinal} onChange={event=>choose(Number(event.target.value))} className="ml-2 max-w-full rounded border p-2">{sheets.map(s=><option key={s.ordinal} value={s.ordinal}>{s.name} ({s.count} linhas)</option>)}</select></label>
   <p className="text-sm text-slate-600">Cabeçalhos na primeira linha. O ano é obtido pela data de emissão. IDs devem permanecer estáveis entre cargas. Tomador, documento e descrição completa ficam preservados somente no original.</p>
   <div className="grid gap-3 sm:grid-cols-2">{fiscalFields.map(field=><label key={field.key} className="text-sm">{field.label}<select aria-label={field.label} value={mapping[field.key]??-1} onChange={event=>{setMapping({...mapping,[field.key]:Number(event.target.value)});setPreview(undefined);}} className="mt-1 block w-full rounded border p-2"><option value={-1}>Não importar</option>{sheet.headers.map((header,index)=><option key={index} value={index}>{header||`Coluna ${index+1}`}</option>)}</select></label>)}</div>
   <button disabled={busy} onClick={()=>void run(async()=>{setPreview(await request({action:"prepare",sourceId:source,ordinal,mapping,delimiter}));setPage(0);setConfirmed(false);})} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-white">Preparar prévia</button></>}
  </section>}
  {preview&&<section className="space-y-4 rounded-lg border border-[var(--border)] bg-white p-5">
   <h2 className="text-xl font-bold">3. Conferir e importar</h2>
   <p>{preview.added} novas · {preview.existing} já cadastradas · {preview.conflicts} divergências</p>
   <p className="text-sm">Total das notas na planilha: {formatBrlFromCents(preview.total)}. As já cadastradas não serão somadas novamente.</p>
   {preview.errorCount>0&&<div role="alert" className="text-sm text-red-800"><p>{preview.errorCount} erros impedem a importação.</p>{preview.errors.map((error,index)=><p key={index}>{error}</p>)}<Link className="underline" href="/notas-fiscais">Abrir notas existentes para conferir ou ajustar</Link></div>}
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Nota / ID</th><th className="p-2">Emissão</th><th className="p-2">Valor</th><th className="p-2">Projeto</th><th className="p-2">Situação</th></tr></thead><tbody>{preview.rows.slice(page*20,(page+1)*20).map(row=><tr key={row.sourceId} className="border-t"><td className="p-2">{row.number}<small className="block">{row.sourceId}</small></td><td className="p-2 whitespace-nowrap">{row.date}</td><td className="p-2 whitespace-nowrap">{formatBrlFromCents(row.amount.replace('.',''))}</td><td className="p-2">{row.project||"Sem vínculo declarado"}</td><td className="p-2">{row.state==="new"?"Nova":row.state==="existing"?"Já cadastrada":row.existingId?<Link className="text-[var(--brand)] underline" href={`/notas-fiscais?nota=${encodeURIComponent(row.existingId)}`}>Conferir esta nota</Link>:"Conferir"}</td></tr>)}</tbody></table></div>
   {preview.rows.length>20&&<div className="flex gap-4 text-sm"><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>{page+1} de {Math.ceil(preview.rows.length/20)}</span><button disabled={(page+1)*20>=preview.rows.length} onClick={()=>setPage(page+1)}>Próxima</button></div>}
   <label className="flex gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Conferi as notas novas e seus projetos. Notas existentes e ajustes serão preservados. A importação não registra pagamento nem remove notas ausentes da planilha.</label>
   <button disabled={busy||!confirmed||preview.errorCount>0} onClick={()=>void run(async()=>{const result=await request({action:"apply",id:preview.id,hash:preview.hash,confirmed:true});setMessage(result.inserted?`${result.inserted} notas importadas. Consulte Notas fiscais.`:"Todas as notas já estavam cadastradas. Nenhuma duplicação.");setPreview(undefined);router.refresh();})} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-white disabled:opacity-40">Confirmar importação</button>
  </section>}
  {message&&<p role="status" className="border-l-4 border-[#CB5C2B] bg-white p-4">{message}</p>}{busy&&<p role="status">Processando…</p>}
 </div>;
}
