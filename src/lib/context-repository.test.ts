import {it,expect,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({getDocument:vi.fn()}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>mock);
import {validateContextPdf,uploadContextDocument} from './context-repository';
const bytes=new TextEncoder().encode('%PDF-1.7\nsynthetic\n%%EOF');
beforeEach(()=>vi.resetAllMocks());
it('valida cada página e fecha o parser',async()=>{
 const page={getOperatorList:vi.fn().mockResolvedValue({}),cleanup:vi.fn()},getPage=vi.fn().mockResolvedValue(page),destroy=vi.fn().mockResolvedValue(undefined);
 mock.getDocument.mockReturnValue({promise:Promise.resolve({numPages:3,getPage}),destroy});
 await validateContextPdf(bytes);expect(getPage.mock.calls).toEqual([[1],[2],[3]]);expect(destroy).toHaveBeenCalledOnce();
});
it('recusa envelope falso e erro interno mesmo com assinatura PDF',async()=>{
 await expect(validateContextPdf(new Uint8Array([1,2,3]))).rejects.toThrow();expect(mock.getDocument).not.toHaveBeenCalled();
 const destroy=vi.fn().mockResolvedValue(undefined);mock.getDocument.mockReturnValue({promise:Promise.reject(Error('corrupt')),destroy});
 await expect(validateContextPdf(bytes)).rejects.toThrow('PDF está inválido');expect(destroy).toHaveBeenCalledOnce();
});
it('recusa extensão e tamanho antes de reservar o cofre',async()=>{
 await expect(uploadContextDocument({name:'falso.txt',size:20,body:null})).rejects.toThrow('Envie um PDF');
 await expect(uploadContextDocument({name:'grande.pdf',size:51*1024*1024,body:null})).rejects.toThrow('Envie um PDF');
});
