import {describe,it,expect} from 'vitest';
import {suggestFiscalPdf} from './fiscal-pdf-suggestions';
describe('sugestões fiscais conservadoras',()=>{
 it('normaliza rótulos, moeda e data e fornece trechos',()=>{
  const result=suggestFiscalPdf(['Número da NFS-e: 002\nData de emissão\n06/09/2026\nValor total dos serviços: R$ 1.234,56']);
  expect(result.suggestions.number?.value).toBe('002');expect(result.suggestions.date?.value).toBe('2026-09-06');expect(result.suggestions.amount?.value).toBe('1234.56');expect(result.suggestions.date?.evidence).toContain('06/09/2026');expect(result.warnings).toEqual([]);
 });
 it('não usa RPS, competência, líquido, tributos nem colunas misturadas',()=>{
  expect(suggestFiscalPdf(['Número do RPS: 123\nCompetência: 06/09/2026\nValor líquido: R$ 999,00\nISS: 10,00\nCódigo de verificação: 123\nNúmero da nota: RPS 123\nData de emissão Competência\n06/09/2026 08/2026']).suggestions).toEqual({});
 });
 it('bloqueia valores distintos e converge repetições equivalentes',()=>{
  expect(suggestFiscalPdf(['Valor total da nota: 10,00\nValor bruto: 11,00']).suggestions.amount).toBeUndefined();
  expect(suggestFiscalPdf(['Número da nota: 002\nNúmero da nota: 2']).suggestions.number).toBeDefined();
  expect(suggestFiscalPdf(['Número da nota: 1\nData de emissão: 06/09/2026\nNúmero da nota: 2']).suggestions).toEqual({});
 });
 it('recusa rótulo ilegível e suporta acentos decompostos',()=>{
  expect(suggestFiscalPdf(['Número da nota: 123\nNúmero da nota: ilegível\nValor bruto: 10,00']).suggestions).toEqual({});
  expect(suggestFiscalPdf(['Valor bruto: 10,00\nValor bruto: desconhecido']).suggestions.amount).toBeUndefined();
  expect(suggestFiscalPdf(['Número da NFS-e: 123-AbC']).suggestions.number?.value).toBe('123-AbC');
  expect(suggestFiscalPdf(['Número da nota\n123-XyZ']).suggestions.number?.value).toBe('123-XyZ');
 });
 it('não aceita datas impossíveis, negativos ou evidência parcial',()=>{
  expect(suggestFiscalPdf(['Data de emissão: 31/02/2026\nValor bruto: -10,00']).suggestions).toEqual({});
  expect(suggestFiscalPdf(['Número da nota: 123',...Array(20).fill('')]).suggestions).toEqual({});
  expect(suggestFiscalPdf(['Número da nota: 123\n'+'x'.repeat(100001)]).suggestions).toEqual({});
  expect(suggestFiscalPdf(['Número da nota','123']).suggestions).toEqual({});
 });
});
