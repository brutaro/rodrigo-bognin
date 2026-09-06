import {afterEach,it,expect,vi} from 'vitest';
import {requestFiscalPdfSuggestions} from './fiscal-pdf-suggestions-client';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('encerra a espera em 20 segundos e oferece preenchimento manual',async()=>{
 const controller=new AbortController();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))));
 const result=requestFiscalPdfSuggestions('source');
 controller.abort(new DOMException('Timeout','TimeoutError'));
 await expect(result).rejects.toThrow('preencher manualmente');
 expect(timeout).toHaveBeenCalledWith(20000);
});
it('mantém sucesso e erros HTTP da leitura',async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({suggestions:{},warnings:[]})).mockResolvedValueOnce(Response.json({error:'PDF indisponível.'},{status:400}));vi.stubGlobal('fetch',fetchMock);
 await expect(requestFiscalPdfSuggestions('source')).resolves.toEqual({suggestions:{},warnings:[]});
 await expect(requestFiscalPdfSuggestions('source')).rejects.toThrow('PDF indisponível.');
});
