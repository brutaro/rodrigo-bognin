import 'server-only';
import {fiscalPdfLimitBytes} from './fiscal-pdf-domain';
export type FiscalPdfText={pages:string[];warning?:string};
const fallback=(warning:string):FiscalPdfText=>({pages:[],warning});
export async function extractFiscalPdfText(bytes:Uint8Array):Promise<FiscalPdfText>{
 if(bytes.length>fiscalPdfLimitBytes)return fallback('PDF acima do limite de 10 MiB. Preencha manualmente.');
 let task:ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>|undefined;
 try{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0});
  const document=await task.promise;
  if(document.numPages>20)return fallback('PDF acima do limite de 20 páginas. Preencha manualmente.');
  const pages:string[]=[];let total=0;
  for(let index=1;index<=document.numPages;index++){
   const page=await document.getPage(index);
   try{
    const reader=page.streamTextContent().getReader();let text='',lastY:number|undefined,lastEnd=0,lineStart=0,lastHeight=10,endedLine=false;
    try{
     while(true){
      const {done,value}=await reader.read();if(done)break;
      for(const item of value.items){
       if(!('str' in item))continue;
       if(!item.str){endedLine ||= item.hasEOL;continue;}
       const x=item.transform[4],y=item.transform[5];
       const height=Math.max(1,Math.hypot(item.transform[2],item.transform[3]));
       const spacing=Math.max(height,lastHeight);
       let prefix='';
       if(lastY!==undefined){
        if(endedLine||Math.abs(y-lastY)>2){
         // Only aligned, nearby lines can form a label/value pair.
         const aligned=Math.abs(x-lineStart)<=Math.max(12,spacing);
         prefix=aligned&&Math.abs(y-lastY)<=spacing*2.5?'\n':'\n\n';
         lineStart=x;
        }else{
         const gap=x-lastEnd;
         // A distant column or reversed reading order is an association barrier.
         if(gap>Math.max(24,spacing*3)||gap < -spacing){prefix='\n\n';lineStart=x;}
         else if(gap>spacing*0.2&&!/\s$/.test(text)&&!/^\s/.test(item.str))prefix=' ';
        }
       }else lineStart=x;
       const part=prefix+item.str;
       total+=part.length;
       if(total>100000){await reader.cancel();return fallback('PDF acima do limite de 100 mil caracteres. Preencha manualmente.');}
       text+=part;lastY=y;lastEnd=x+item.width;lastHeight=height;endedLine=item.hasEOL;
      }
     }
    }finally{reader.releaseLock();}
    pages.push(text);
   }finally{page.cleanup();}
  }
  if(pages.every(page=>!page.trim()))return fallback('Este PDF não tem texto legível. Use “Reconhecer PDF escaneado (OCR)” ou preencha manualmente.');
  return {pages};
 }catch(error){
  return fallback(error instanceof Error&&error.name==='PasswordException'?'Este PDF exige senha. Preencha manualmente.':'Não foi possível ler o texto deste PDF. Preencha manualmente.');
 }finally{try{await task?.destroy();}catch{/* The manual fallback must remain available even if disposal fails. */}}
}
