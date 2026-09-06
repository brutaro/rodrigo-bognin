'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {FiscalXmlFields} from '@/lib/fiscal-xml-domain';
import {cashMoney} from '@/lib/cash-domain';
type Preview={id:string;hash:string;added:number;existing:number;errorCount:number;errors:string[];rows:Array<{id:string;number:string;date:string;amount:string;project:string;category:string|null;existingId:string|null}>};
export function FiscalXml({source,fields,projects}:{source?:string;fields?:FiscalXmlFields;projects:Array<{id:string;title:string}>}){
 const router=useRouter();const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview>(),[confirmed,setConfirmed]=useState(false);
 async function run(work:()=>Promise<void>){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e instanceof Error?e.message:'Não foi possível continuar.');}finally{setBusy(false);}}
 async function json(url:string,init:RequestInit){const response=await fetch(url,init),data=await response.json();if(!response.ok)throw Error(data.error??'Falha na operação.');return data;}
 return <div className="space-y-5">
  <form className="rounded-lg border border-[var(--border)] bg-white p-5" onSubmit={e=>{e.preventDefault();const file=new FormData(e.currentTarget).get('file');if(!(file instanceof File))return;void run(async()=>{if(!file.size||file.size>2*1024*1024)throw Error('Escolha um XML de até 2 MiB.');const result=await json('/api/sources/fiscal-xml',{method:'POST',headers:{'Content-Type':'application/xml','X-TRIA-File-Name':encodeURIComponent(file.name),'X-TRIA-File-Size':String(file.size)},body:file});setPreview(undefined);setConfirmed(false);router.replace(`/fontes/notas-fiscais/xml?fonte=${result.sourceId}`);router.refresh();});}}>
   <label className="block font-semibold">1. Enviar XML<input name="file" type="file" accept=".xml,application/xml,text/xml" required disabled={busy} className="mt-3 block w-full rounded border p-2 text-sm"/></label><button disabled={busy} className="mt-3 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Ler e proteger XML</button>
  </form>
  {source&&fields&&<form className="space-y-4 rounded-lg border border-[var(--border)] bg-white p-5" onChange={()=>{setPreview(undefined);setConfirmed(false);}} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{setPreview(await json(`/api/sources/fiscal-xml/${source}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:String(data.get('category')??''),project:String(data.get('project')??'')})}));setConfirmed(false);});}}>
   <h2 className="text-lg font-bold">2. Conferir os dados do XML</h2>
   <div className="space-y-2 rounded-lg border-l-4 border-[#CB5C2B] bg-[#FBF5F0] p-4 text-sm">
    <p>Número da NFS-e: <strong>{fields.number}</strong></p><p>Emissão: <strong>{fields.date.split('-').reverse().join('/')}</strong></p><p>Valor dos serviços: <strong>{cashMoney(fields.amount.replace('.',''))}</strong></p><p>{fields.format} · Campos lidos do original, sem usar número do RPS ou valor líquido.</p>
   </div>
   <a href={`/api/sources/fiscal-xml/${source}`} className="inline-block text-sm text-[var(--brand)] underline">Baixar XML original</a>
   <p className="text-sm text-slate-600">Confira os dados com a nota emitida. Esta leitura não verifica assinatura digital nem consulta a situação na prefeitura. Categoria e projeto são informações complementares suas.</p>
   <label className="block text-sm">Categoria (opcional)<input name="category" maxLength={200} disabled={busy} className="mt-1 block w-full rounded border p-2"/></label>
   <label className="block text-sm">Projeto declarado (opcional)<select name="project" disabled={busy} className="mt-1 block w-full rounded border p-2"><option value="">Sem projeto declarado</option>{projects.map(p=><option key={p.id} value={p.title}>{p.title}</option>)}</select></label>
   <button disabled={busy} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Preparar conferência</button>
  </form>}
  {preview&&<section className="space-y-4 rounded-lg border border-[var(--border)] bg-white p-5"><h2 className="text-lg font-bold">3. Conferir e cadastrar</h2><p>{preview.added} nova · {preview.existing} já cadastrada</p>
   {preview.errors.map((error,i)=><p role="alert" key={i} className="text-sm text-red-800">{error}</p>)}
   {preview.rows.map(row=><div key={row.id} className="text-sm"><p className="font-semibold">{row.number} · {row.date.split('-').reverse().join('/')} · {cashMoney(row.amount.replace('.',''))}</p><p>{row.category??'Sem categoria'} · {row.project||'Sem projeto declarado'}</p>{row.existingId&&<Link href={`/notas-fiscais?nota=${row.existingId}`} className="text-[var(--brand)] underline">Conferir nota existente</Link>}</div>)}
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy||preview.errorCount>0} onChange={e=>setConfirmed(e.target.checked)}/>Conferi os dados com a nota emitida. O cadastro não registra pagamento ou reembolso.</label>
   <button disabled={busy||!confirmed||preview.errorCount>0} onClick={()=>void run(async()=>{const result=await json('/api/sources/fiscal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply',id:preview.id,hash:preview.hash,confirmed:true})});setMessage(result.inserted?'Nota cadastrada. XML original preservado.':'Nota já cadastrada: nenhuma duplicação. XML original preservado.');setPreview(undefined);setConfirmed(false);router.refresh();})} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Confirmar cadastro</button>
  </section>}
  {message&&<p role="status" className="border-l-4 border-[#CB5C2B] bg-white p-4">{message}</p>}{busy&&<p role="status">Processando…</p>}
 </div>;
}
