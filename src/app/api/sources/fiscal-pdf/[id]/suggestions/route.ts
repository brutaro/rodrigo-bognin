import {z} from 'zod';
import {apiAuthenticationStatus,assertSameOrigin} from '@/lib/auth';
import {readFiscalPdf} from '@/lib/fiscal-pdf';
import {extractFiscalPdfText} from '@/lib/fiscal-pdf-text';
import {extractFiscalPdfOcr} from '@/lib/fiscal-pdf-ocr';
import {suggestFiscalPdf} from '@/lib/fiscal-pdf-suggestions';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(await apiAuthenticationStatus()!=='authenticated')return Response.json({error:'Entre novamente para continuar.'},{status:401,headers});
 try{await assertSameOrigin(request);}catch{return Response.json({error:'Origem inválida.'},{status:403,headers});}
 try{
  const id=z.uuid().parse((await params).id);
  const {bytes}=await readFiscalPdf(id);
  const ocr=new URL(request.url).searchParams.get('mode')==='ocr';
  const text=await (ocr?extractFiscalPdfOcr(bytes):extractFiscalPdfText(bytes));
  const result=text.warning?{suggestions:{},warnings:[text.warning]}:suggestFiscalPdf(text.pages);
  if(ocr)result.warnings.unshift('Leitura por OCR: letras e números podem ser confundidos. Trechos de baixa confiança ficam sem sugestão. Confira todos os campos com a imagem original.');
  return Response.json(result,{headers});
 }catch{return Response.json({error:'PDF indisponível ou integridade inválida. O preenchimento manual continua disponível.'},{status:400,headers});}
}
