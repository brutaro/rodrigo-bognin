import {describe,it,expect} from 'vitest';
import {fiscalNumberKey,validatePdfEnvelope} from './fiscal-pdf-domain';
describe('PDF fiscal e identificação da nota',()=>{
 it('reconhece variantes sem confundir séries diferentes',()=>{
  expect(['2','002','NFS-e 002','NFSe: 2'].map(fiscalNumberKey)).toEqual(['2','2','2','2']);
  expect(fiscalNumberKey('2-A')).not.toBe(fiscalNumberKey('2-B'));
  expect(fiscalNumberKey('000')).toBe('0');
 });
 it('recusa arquivo renomeado e conteúdo truncado',()=>{
  const bytes=(value:string)=>new TextEncoder().encode(value);
  expect(()=>validatePdfEnvelope(bytes('%PDF-1.7\nfixture\n%%EOF\n'))).not.toThrow();
  expect(()=>validatePdfEnvelope(bytes('<html>não é PDF</html>'))).toThrow(/PDF/);
  expect(()=>validatePdfEnvelope(bytes('%PDF-1.7\ntruncado'))).toThrow(/PDF/);
 });
});
