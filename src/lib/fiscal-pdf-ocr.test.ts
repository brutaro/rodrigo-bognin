import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({execFile:vi.fn(),mkdtemp:vi.fn(),writeFile:vi.fn(),rm:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:mocks.execFile}));
vi.mock('node:fs/promises',()=>({mkdtemp:mocks.mkdtemp,writeFile:mocks.writeFile,rm:mocks.rm}));
import {extractFiscalPdfOcr,confidentOcrText} from './fiscal-pdf-ocr';
beforeEach(()=>{vi.resetAllMocks();mocks.mkdtemp.mockResolvedValue('/tmp/tria-ocr-test');mocks.execFile.mockImplementation((_command,args,_options,done)=>done(null,args[2]==='pdfinfo'?'Pages: 1\nEncrypted: no\n':args[2]==='tesseract'?'header\n5\t1\t1\t1\t1\t1\t0\t0\t100\t10\t96\tNumero da NFS-e: 123':'',''));});
it('lê imagem local e apaga arquivos temporários',async()=>{
 const result=await extractFiscalPdfOcr(new Uint8Array([1]));expect(result.pages).toEqual(['Numero da NFS-e: 123']);expect(mocks.rm).toHaveBeenLastCalledWith('/tmp/tria-ocr-test',{recursive:true,force:true});
 expect(mocks.execFile.mock.calls[2][2]).toMatchObject({killSignal:'SIGKILL',maxBuffer:2097152,env:expect.objectContaining({OMP_THREAD_LIMIT:'1'})});
});
it('descarta documento inteiro se houver excesso de páginas ou falha de OCR',async()=>{
 mocks.execFile.mockImplementationOnce((_cmd,_args,_opts,done)=>done(null,'Pages: 6\n',''));expect((await extractFiscalPdfOcr(new Uint8Array([1]))).pages).toEqual([]);expect(mocks.execFile).toHaveBeenCalledTimes(1);
 mocks.execFile.mockImplementation((_cmd,_args,_opts,done)=>done(Error('timeout')));expect((await extractFiscalPdfOcr(new Uint8Array([1]))).pages).toEqual([]);expect(mocks.rm).toHaveBeenLastCalledWith('/tmp/tria-ocr-test',{recursive:true,force:true});
});

it('descarta a linha incerta sem juntar o rótulo com outro valor',()=>{
 const row=(text:string,confidence:number,line:number)=>`5\t1\t1\t1\t${line}\t1\t0\t${line*10}\t100\t10\t${confidence}\t${text}`;
 const text=confidentOcrText(['header',row('Numero da NFS-e:',96,1),row('98/654321',89,2),row('123',97,3)].join('\n'));
 expect(text).not.toContain('98/654321');expect(text).toContain('\n\n');
});
