import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocked=vi.hoisted(()=>({getDocument:vi.fn()}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>mocked);
import {suggestFiscalPdf} from './fiscal-pdf-suggestions';
import {extractFiscalPdfText} from './fiscal-pdf-text';
type Item={str:string;transform:number[];width:number;hasEOL:boolean};
function document(pages:string[],reject?:Error,items?:Item[]){
 const cleanups=pages.map(()=>vi.fn());const destroy=vi.fn();
 const getPage=vi.fn(async(i:number)=>({cleanup:cleanups[i-1],streamTextContent:()=>new ReadableStream({start(controller){controller.enqueue({items:items??pages[i-1].split('\n').map((str,j)=>({str,transform:[10,0,0,10,0,100-j*10],width:str.length*5,hasEOL:false}))});controller.close();}})}));
 mocked.getDocument.mockReturnValue({promise:reject?Promise.reject(reject):Promise.resolve({numPages:pages.length,getPage}),destroy});
 return {cleanups,destroy,getPage};
}
beforeEach(()=>vi.clearAllMocks());
describe('extração privada e limitada',()=>{
 it('preserva páginas e linhas e libera recursos',async()=>{
  const doc=document(['Número da nota\n123','Valor bruto: 10,00']);
  const result=await extractFiscalPdfText(new Uint8Array([1]));
  expect(result.pages).toEqual(['Número da nota\n123','Valor bruto: 10,00']);expect(doc.destroy).toHaveBeenCalledOnce();doc.cleanups.forEach(cleanup=>expect(cleanup).toHaveBeenCalledOnce());
  expect(mocked.getDocument.mock.calls[0][0].isEvalSupported).toBe(false);
 });
 it('junta dígitos adjacentes sem alterar o número e separa colunas',async()=>{
  const item=(str:string,x:number,y:number,width:number):Item=>({str,transform:[10,0,0,10,x,y],width,hasEOL:false});
  document([''],undefined,[item('Número da nota:',10,100,75),item('12',90,100,10),item('3-A',100,100,15)]);
  let result=await extractFiscalPdfText(new Uint8Array([1]));
  expect(suggestFiscalPdf(result.pages).suggestions.number?.value).toBe('123-A');
  for(const y of [100,90]){
   document([''],undefined,[item('Número da nota:',10,100,75),item('999',300,y,15)]);
   result=await extractFiscalPdfText(new Uint8Array([1]));
   expect(suggestFiscalPdf(result.pages).suggestions.number).toBeUndefined();
   expect(result.pages[0]).toContain('\n\n');
  }
 });
 it('descarta integralmente documentos acima do limite',async()=>{
  let doc=document(Array(21).fill('texto'));expect((await extractFiscalPdfText(new Uint8Array([1]))).pages).toEqual([]);expect(doc.getPage).not.toHaveBeenCalled();expect(doc.destroy).toHaveBeenCalledOnce();
  doc=document(['Número da nota: 123','x'.repeat(100001)]);expect((await extractFiscalPdfText(new Uint8Array([1]))).pages).toEqual([]);expect(doc.destroy).toHaveBeenCalledOnce();expect(doc.cleanups[1]).toHaveBeenCalledOnce();
 });
 it('oferece fallback seguro para imagem, senha e inválido',async()=>{
  document(['']);expect((await extractFiscalPdfText(new Uint8Array([1]))).warning).toContain('não tem texto');
  const error=new Error('segredo interno');error.name='PasswordException';let doc=document([],error);expect((await extractFiscalPdfText(new Uint8Array([1]))).warning).toContain('senha');expect(doc.destroy).toHaveBeenCalledOnce();
  doc=document([],new Error('segredo interno'));const result=await extractFiscalPdfText(new Uint8Array([1]));expect(result.pages).toEqual([]);expect(result.warning).not.toContain('segredo');expect(doc.destroy).toHaveBeenCalledOnce();
 });
});
