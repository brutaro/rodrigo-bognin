"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { boundedPdfScale } from "@/lib/pdf-viewport";
import type { ContextDocument } from "@/lib/context-repository";
function PdfModal({document,onClose}:{document:ContextDocument;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),pages=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null);
 const [error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{
  dialog.current?.showModal();
  const previous=documentGlobal().body.style.overflow;documentGlobal().body.style.overflow='hidden';
  const pageContainer=pages.current;
  let cancelled=false,observer:IntersectionObserver|undefined;
  let task:ReturnType<typeof import('pdfjs-dist').getDocument>|undefined;
  const dispose=new Map<Element,()=>void>();
  const wanted=new Set<Element>();
  void(async()=>{try{
   const pdf=await import('pdfjs-dist');
   if(cancelled)return;
   pdf.GlobalWorkerOptions.workerSrc='/api/contexto/worker';
   task=pdf.getDocument({url:`/api/files/${document.id}/download`,isEvalSupported:false});
   const file=await task.promise;
   if(cancelled)return;
   const metadata=new Map<Element,{number:number;width:number;height:number}>();
   let pumping=false;
   async function pump(){
    if(pumping)return;
    pumping=true;
    try{
     while(!cancelled){
      const target=[...wanted].find(element=>!dispose.has(element));
      if(!target)break;
      const dimensions=metadata.get(target)!;
      let obsolete=false;
      const canvas=documentGlobal().createElement('canvas');
      let render:ReturnType<Awaited<ReturnType<typeof file.getPage>>['render']>|undefined;
      const release=()=>{obsolete=true;render?.cancel();canvas.width=0;canvas.height=0;canvas.remove();dispose.delete(target);target.removeAttribute('data-rendered');};
      dispose.set(target,release);
      const page=await file.getPage(dimensions.number);
      try{
       if(cancelled||obsolete)continue;
       const viewport=page.getViewport({scale:boundedPdfScale(dimensions.width,dimensions.height,target.clientWidth,window.devicePixelRatio)});
       canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
       canvas.className='absolute inset-0 h-full w-full';target.append(canvas);
       render=page.render({canvas,viewport});
       await render.promise;
       if(!cancelled&&!obsolete)target.setAttribute('data-rendered','true');
      }catch(error){if(!cancelled&&!obsolete)throw error;}
      finally{page.cleanup();}
     }
    }catch{if(!cancelled)setError('Não foi possível renderizar uma página. Você pode baixar o PDF original.');}
    finally{pumping=false;}
   }
   observer=new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.isIntersecting)wanted.add(entry.target);else{wanted.delete(entry.target);dispose.get(entry.target)?.();}}
    void pump();
   },{root:scroll.current,rootMargin:'400px'});
   for(let number=1;number<=file.numPages;number++){
    if(cancelled)return;
    const page=await file.getPage(number),viewport=page.getViewport({scale:1});
    if(cancelled){page.cleanup();return;}
    const placeholder=documentGlobal().createElement('div');
    placeholder.className='relative mx-auto mb-4 w-full bg-white shadow';
    placeholder.style.aspectRatio=`${viewport.width} / ${viewport.height}`;
    placeholder.setAttribute('aria-label',`Página ${number} de ${file.numPages}`);placeholder.setAttribute('role','img');
    metadata.set(placeholder,{number,width:viewport.width,height:viewport.height});
    pageContainer?.append(placeholder);observer.observe(placeholder);page.cleanup();
   }
   if(!cancelled)setLoaded(true);
  }catch{if(!cancelled)setError('Não foi possível abrir este PDF. Feche e tente novamente ou baixe o original.');}})();
  return()=>{
   cancelled=true;observer?.disconnect();wanted.clear();
   for(const release of [...dispose.values()])release();
   void task?.destroy().catch(()=>undefined);pageContainer?.replaceChildren();
   documentGlobal().body.style.overflow=previous;
  };
 },[document.id]);
 return <dialog ref={dialog} aria-label={document.title} onCancel={onClose} onClose={onClose} className="fixed inset-0 m-auto h-[92dvh] w-[min(95vw,1000px)] max-w-none rounded-xl p-0 backdrop:bg-black/60"><div className="flex h-full flex-col"><header className="flex flex-wrap shrink-0 items-center justify-between gap-3 border-b bg-white p-4"><h2 className="min-w-0 break-words font-bold">{document.title}</h2><div className="flex items-center gap-3"><a href={`/api/files/${document.id}/download`} className="text-sm underline">Baixar PDF original</a><button autoFocus onClick={onClose} className="rounded-lg border px-4 py-2">Fechar</button></div></header><div ref={scroll} className="min-h-0 flex-1 overflow-y-auto bg-slate-200 p-4" aria-label="Páginas do PDF">{!loaded&&!error&&<p role="status">Carregando páginas…</p>}{error&&<p role="alert">{error}</p>}<div ref={pages}/></div></div></dialog>;
}
function documentGlobal(){return window.document;}
export function ContextVault({documents}:{documents:ContextDocument[]}){
 const router=useRouter(),input=useRef<HTMLInputElement>(null);
 const [opened,setOpened]=useState<ContextDocument>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function upload(){
  const file=input.current?.files?.[0];if(!file)return;
  setBusy(true);setMessage('');try{
   const response=await fetch('/api/contexto',{method:'POST',headers:{'Content-Type':'application/pdf','x-tria-file-name':encodeURIComponent(file.name)},body:file});
   const result=await response.json();if(!response.ok)throw Error(result.error);
   if(input.current)input.current.value='';setMessage('PDF guardado.');router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível guardar.');}finally{setBusy(false);}
 }
 async function remove(document:ContextDocument){
  if(!window.confirm(`Excluir ${document.title}? O PDF será removido do cofre.`))return;
  setBusy(true);setMessage('');
  try{
   const response=await fetch(`/api/contexto/${document.id}`,{method:'DELETE'});
   const result=await response.json();if(!response.ok)throw Error(result.error);
   setMessage('PDF excluído.');
  }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível excluir.');}
  finally{setBusy(false);router.refresh();}
 }
 return <div className="space-y-6"><form onSubmit={event=>{event.preventDefault();void upload();}} className="rounded-xl border bg-white p-5"><label className="block font-semibold">PDF de contexto<input ref={input} required disabled={busy} type="file" accept=".pdf,application/pdf" className="my-3 block max-w-full"/></label><p className="mb-3 text-sm">Somente PDF, até 50 MiB.</p><button disabled={busy} className="rounded-lg bg-[var(--brand)] px-4 py-3 text-white">{busy?'Guardando…':'Guardar PDF'}</button>{message&&<p role="status" className="mt-3">{message}</p>}</form><ul className="divide-y rounded-xl border bg-white">{documents.map(item=><li key={item.id} className="flex items-center gap-3 p-3"><button disabled={item.status==='purging'||busy} onClick={()=>setOpened(item)} className="min-w-0 flex-1 break-words rounded-lg p-2 text-left font-semibold hover:bg-slate-50">{item.title}<span className="mt-1 block text-sm font-normal">{(Number(item.size)/1024).toFixed(0)} KiB{item.status==='purging'?' · Exclusão pendente':''}</span></button><button disabled={busy} aria-label={`Excluir ${item.title}`} onClick={()=>void remove(item)} className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">{item.status==='purging'?'Tentar excluir':'Excluir'}</button></li>)}{!documents.length&&<li className="p-5">Nenhum PDF guardado.</li>}</ul>{opened&&<PdfModal key={opened.id} document={opened} onClose={()=>setOpened(undefined)}/>}</div>;
}
