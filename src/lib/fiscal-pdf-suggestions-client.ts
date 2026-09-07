import type {FiscalPdfSuggestions} from './fiscal-pdf-suggestions';
export async function requestFiscalPdfSuggestions(source:string,ocr=false):Promise<FiscalPdfSuggestions>{
 const signal=AbortSignal.timeout(ocr?50000:20000);
 try{
  const response=await fetch(`/api/sources/fiscal-pdf/${source}/suggestions${ocr?"?mode=ocr":""}`,{method:'POST',signal});
  const data=await response.json();
  if(!response.ok)throw Error(data.error??'Não foi possível ler o PDF. Preencha manualmente.');
  return data;
 }catch(error){
  if(signal.aborted)throw Error('A leitura do PDF demorou demais. Você pode preencher manualmente ou tentar novamente.');
  throw error;
 }
}
