import 'server-only';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fiscalPdfLimitBytes} from './fiscal-pdf-domain';
import type {FiscalPdfText} from './fiscal-pdf-text';
// TSV preserves confidence and columns. An uncertain line is an association barrier.
export function confidentOcrText(tsv:string){
 const groups=new Map<string,Array<{text:string;confidence:number;left:number;top:number;width:number;height:number}>>();
 for(const line of tsv.split('\n').slice(1)){
  const cells=line.split('\t');if(cells[0]!=='5'||cells.length<12)continue;
  const key=cells.slice(1,5).join(':');const words=groups.get(key)??[];
  words.push({text:cells.slice(11).join('\t').trim(),confidence:Number(cells[10]),left:Number(cells[6]),top:Number(cells[7]),width:Number(cells[8]),height:Number(cells[9])});groups.set(key,words);
 }
 let result='',previous:{key:string;left:number;top:number;height:number}|undefined;
 for(const [key,words] of groups){
  if(words.some(word=>!word.text||!Number.isFinite(word.confidence)||word.confidence<90)){result+='\n\n';previous=undefined;continue;}
  const first=words[0];let line='';let end=first.left;
  for(const word of words){const gap=word.left-end;line+=(line?(gap>Math.max(24,word.height*3)||gap < -word.height?'\n\n':' '):'')+word.text;end=word.left+word.width;}
  const nearby=previous&&previous.key.split(':').slice(0,3).join(':')===key.split(':').slice(0,3).join(':')&&Math.abs(first.left-previous.left)<=Math.max(12,first.height)&&Math.abs(first.top-previous.top)<=Math.max(first.height,previous.height)*2.5;
  result+=(result?(nearby?'\n':'\n\n'):'')+line;previous={key,left:first.left,top:first.top,height:first.height};
 }
 return result;
}
let occupied=false;
// One job at a time; temporary images never enter the protected file store.
export async function extractFiscalPdfOcr(bytes:Uint8Array):Promise<FiscalPdfText>{
 const fallback=(warning:string):FiscalPdfText=>({pages:[],warning});
 if(occupied)return fallback('Já existe uma leitura OCR em andamento. Tente novamente em instantes.');
 if(!bytes.length||bytes.length>fiscalPdfLimitBytes)return fallback('Envie um PDF de até 10 MiB.');
 occupied=true;let directory:string|undefined;
 const deadline=Date.now()+45000;
 const run=(command:string,args:string[])=>new Promise<string>((resolve,reject)=>{
  const timeout=deadline-Date.now();if(timeout<=0){reject(Error('timeout'));return;}
  execFile('prlimit',['--as=536870912','--',command,...args],{timeout,killSignal:'SIGKILL',maxBuffer:2*1024*1024,env:{...process.env,LC_ALL:'C',OMP_THREAD_LIMIT:'1'}},(error,stdout)=>error?reject(error):resolve(stdout));
 });
 try{
  directory=await mkdtemp(path.join(tmpdir(),'tria-ocr-'));const pdf=path.join(directory,'original.pdf');await writeFile(pdf,bytes,{mode:0o600});
  const info=await run('pdfinfo',[pdf]);const count=Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);
  if(!Number.isInteger(count)||count<1||count>5)return fallback('O OCR aceita até 5 páginas por PDF. Preencha manualmente documentos maiores.');
  if(/^Encrypted:\s+yes/m.test(info))return fallback('Este PDF exige senha. Preencha manualmente.');
  const pages:string[]=[];let total=0;
  for(let page=1;page<=count;page++){
   const image=path.join(directory,'page');
   await run('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','2400','-png',pdf,image]);
   const text=confidentOcrText(await run('tesseract',[image+'.png','stdout','-l','por+eng','--psm','3','tsv']));
   await rm(image+'.png',{force:true});total+=text.length;
   if(total>100000)return fallback('Texto reconhecido acima do limite. Preencha manualmente.');
   pages.push(text);
  }
  return pages.some(page=>page.trim())?{pages}:fallback('Não foi possível reconhecer texto nesta imagem. Preencha manualmente.');
 }catch{return fallback('Não foi possível concluir o OCR local. Confira a legibilidade ou preencha manualmente.');}
 finally{try{if(directory)await rm(directory,{recursive:true,force:true});}finally{occupied=false;}}
}
