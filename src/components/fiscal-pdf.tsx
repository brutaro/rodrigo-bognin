'use client';
import {useRef,useState} from 'react';
import {requestFiscalPdfSuggestions} from '@/lib/fiscal-pdf-suggestions-client';
import type {FiscalPdfSuggestions,FiscalSuggestionField} from '@/lib/fiscal-pdf-suggestions';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {cashMoney} from '@/lib/cash-domain';
type Preview={id:string;hash:string;added:number;existing:number;errorCount:number;errors:string[];rows:Array<{id:string;number:string;date:string;amount:string;project:string;category:string|null;existingId:string|null}>};
export function FiscalPdf({initialSource='',projects}:{initialSource?:string;projects:Array<{id:string;title:string}>}){
 const formRef=useRef<HTMLFormElement>(null);const [suggestions,setSuggestions]=useState<FiscalPdfSuggestions>();
 const router=useRouter();const[source,setSource]=useState(initialSource);const[busy,setBusy]=useState(false);const[message,setMessage]=useState('');const[preview,setPreview]=useState<Preview>();const[confirmed,setConfirmed]=useState(false);
 async function run(work:()=>Promise<void>){setBusy(true);setMessage('');try{await work();}catch(error){setMessage(error instanceof Error?error.message:'Não foi possível continuar.');}finally{setBusy(false);}}
 async function json(url:string,init:RequestInit){const response=await fetch(url,init);const data=await response.json();if(!response.ok)throw Error(data.error??'Falha na operação.');return data;}
 return <div className="space-y-5">
  <form className="rounded-lg border border-[var(--border)] bg-white p-5" onSubmit={event=>{event.preventDefault();const file=new FormData(event.currentTarget).get('file');if(!(file instanceof File))return;void run(async()=>{if(!file.size||file.size>10*1024*1024)throw Error('Escolha um PDF de até 10 MiB.');const result=await json('/api/sources/fiscal-pdf',{method:'POST',headers:{'Content-Type':'application/pdf','X-TRIA-File-Name':encodeURIComponent(file.name),'X-TRIA-File-Size':String(file.size)},body:file});setSource(result.sourceId);setSuggestions(undefined);setPreview(undefined);setConfirmed(false);router.replace(`/fontes/notas-fiscais/pdf?fonte=${result.sourceId}`);});}}>
   <label className="block font-semibold">1. Enviar PDF<input type="file" name="file" accept=".pdf,application/pdf" required disabled={busy} className="mt-3 block w-full rounded border p-2 text-sm" /></label><button disabled={busy} className="mt-3 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Proteger PDF</button>
  </form>
  {source&&<div className="grid gap-5 lg:grid-cols-2">
   <section className="min-w-0 rounded-lg border border-[var(--border)] bg-white p-4"><h2 className="font-semibold">Original protegido</h2><p className="my-2 text-sm"><a href={`/api/sources/fiscal-pdf/${source}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline">Abrir PDF em outra aba</a><a href={`/api/sources/fiscal-pdf/${source}?download=1`} className="ml-4 text-[var(--brand)] underline">Baixar original</a></p><iframe title="PDF da nota fiscal" src={`/api/sources/fiscal-pdf/${source}`} className="h-[430px] w-full rounded border lg:h-[620px]"/><p className="mt-2 text-xs text-slate-500">Se a visualização não abrir, use o link para baixar o documento.</p></section>
   <form key={source} ref={formRef} className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] bg-white p-5" onChange={()=>{setPreview(undefined);setConfirmed(false);}} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void run(async()=>{const input=Object.fromEntries(['number','date','amount','category','project'].map(key=>[key,String(form.get(key)??'')]));const result=await json(`/api/sources/fiscal-pdf/${source}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});setPreview(result);setConfirmed(false);});}}>
    <h2 className="text-lg font-bold">2. Transcrever e conferir</h2><p className="text-sm text-slate-600">Preencha os dados ou peça sugestões a partir do texto do PDF. Confira cada campo com o original; a leitura pode não reconhecer o layout. Para documentos escaneados, use o OCR local (até 5 páginas). Use um PDF por nota.</p>
    <div className="flex flex-wrap gap-2">{[false,true].map(ocr=>(<button key={String(ocr)} type="button" disabled={busy} className="rounded-lg border border-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand)] disabled:opacity-40" onClick={()=>void run(async()=>{
     setSuggestions(undefined);setPreview(undefined);setConfirmed(false);
     const result:FiscalPdfSuggestions=await requestFiscalPdfSuggestions(source,ocr);
     setSuggestions(result);
     for(const field of ['number','date','amount'] as FiscalSuggestionField[]){
      const input=formRef.current?.elements.namedItem(field);
      const suggestion=result.suggestions[field];
      if(input instanceof HTMLInputElement&&!input.value.trim()&&suggestion)input.value=field==='amount'?suggestion.value.replace('.',','):suggestion.value;
     }
    })}>{ocr?'Reconhecer PDF escaneado (OCR)':'Ler dados do PDF'}</button>))}</div>
    {suggestions&&<div role="status" className="space-y-2 break-words rounded border border-[var(--border)] bg-[#FBF5F0] p-3 text-sm">
     <p className="font-semibold">Sugestões para conferência — somente campos vazios foram preenchidos.</p>
     {(['number','date','amount'] as FiscalSuggestionField[]).map(field=>{const item=suggestions.suggestions[field];return item&&<p key={field}><strong>{{number:'Número da nota',date:'Emissão',amount:'Valor bruto'}[field]}:</strong> {item.value}<br/><span className="text-xs text-slate-600">Trecho do PDF: “{item.evidence}”</span></p>;})}
     {suggestions.warnings.map((warning,index)=><p key={index}>{warning}</p>)}
     <p>Revise os campos antes de preparar a conferência. As sugestões não são salvas automaticamente.</p>
    </div>}
    <label className="block text-sm">Número da NFS-e<input name="number" required maxLength={100} disabled={busy} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block text-sm">Data de emissão<input name="date" type="date" required disabled={busy} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block text-sm">Valor da NFS-e<input name="amount" inputMode="decimal" placeholder="0,00" required disabled={busy} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block text-sm">Categoria (opcional)<input name="category" maxLength={200} disabled={busy} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block text-sm">Projeto declarado (opcional)<select name="project" aria-label="Projeto declarado (opcional)" disabled={busy} className="mt-1 block w-full rounded border p-2"><option value="">Sem projeto declarado</option>{projects.map(project=><option key={project.id} value={project.title}>{project.title}</option>)}</select></label>
    <button disabled={busy} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Preparar conferência</button>
   </form>
  </div>}
  {preview&&<section className="space-y-4 rounded-lg border border-[var(--border)] bg-white p-5">
   <h2 className="text-lg font-bold">3. Conferir e cadastrar</h2><p>{preview.added} nova · {preview.existing} já cadastrada</p>
   {preview.errors.map((error,index)=><p role="alert" key={index} className="text-sm text-red-800">{error}</p>)}
   {preview.rows.map(row=><div key={row.id} className="text-sm"><p className="font-semibold">{row.number} · {row.date.split('-').reverse().join('/')} · {cashMoney(row.amount.replace('.',''))}</p><p>{row.category??'Sem categoria'} · {row.project||'Sem projeto declarado'}</p>{row.existingId&&<Link href={`/notas-fiscais?nota=${row.existingId}`} className="text-[var(--brand)] underline">Conferir nota existente</Link>}</div>)}
   <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy||preview.errorCount>0} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Conferi os dados com o PDF. O cadastro não registra pagamento ou reembolso e preserva notas e ajustes existentes.</label>
   <button disabled={busy||!confirmed||preview.errorCount>0} onClick={()=>void run(async()=>{const result=await json('/api/sources/fiscal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply',id:preview.id,hash:preview.hash,confirmed:true})});setMessage(result.inserted?'Nota cadastrada. Original preservado.':'Nota já cadastrada: nenhuma duplicação. Original preservado.');setPreview(undefined);setConfirmed(false);router.refresh();})} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Confirmar cadastro</button>
  </section>}
  {message&&<p role="status" className="border-l-4 border-[#CB5C2B] bg-white p-4">{message}</p>}{busy&&<p role="status">Processando…</p>}
 </div>;
}
