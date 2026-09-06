import {describe,it,expect} from 'vitest';
import {readFiscalXmlFields} from './fiscal-xml-domain';
const xml=(content='')=>`<?xml version="1.0" encoding="UTF-8"?><CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd"><Nfse versao="2.04"><InfNfse><Numero>00990099</Numero><DataEmissao>2026-09-06T23:50:00-03:00</DataEmissao><ValoresNfse><ValorLiquidoNfse>11.00</ValorLiquidoNfse></ValoresNfse><DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico><Rps><IdentificacaoRps><Numero>887766</Numero></IdentificacaoRps><DataEmissao>2025-01-01</DataEmissao></Rps><Competencia>2025-12-01</Competencia><Servico><Valores><ValorServicos>1234.56</ValorServicos></Valores></Servico></InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>${content}</InfNfse></Nfse></CompNfse>`;
const read=(value:string)=>readFiscalXmlFields(new TextEncoder().encode(value));
describe('XML fiscal ABRASF individual',()=>{
 it('aceita ABRASF 2.03 e nacional sem confundir DPS, competência ou líquido',()=>{
  expect(read(xml().replace('2.04','2.03')).format).toBe('ABRASF 2.03');
  const national='<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe><nNFSe>765432</nNFSe><cStat>100</cStat><dhProc>2026-09-06T23:50:00-03:00</dhProc><valores><vLiq>10.00</vLiq></valores><DPS versao="1.01"><infDPS><nDPS>999</nDPS><dhEmi>2026-08-01T00:00:00Z</dhEmi><valores><vServPrest><vServ>1234.56</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>';
  expect(read(national)).toEqual({number:'765432',date:'2026-09-06',amount:'1234.56',format:'NFS-e nacional 1.01'});
  expect(read(national.replaceAll('1.01','1.00')).format).toBe('NFS-e nacional 1.00');
  expect(read(national.replace('DPS versao="1.01"','DPS versao="1.00"')).format).toBe('NFS-e nacional 1.01');
  for(const value of [national.replace('<cStat>100','<cStat>999'),national.replace('<nNFSe>765432</nNFSe>',''),national.replace('<vServ>1234.56</vServ>',''),national.replace('nfse"','invalid"')])expect(()=>read(value)).toThrow();
 });

 it('lê caminhos fiscais sem confundir RPS, competência ou líquido e preserva o dia local',()=>{
  expect(read(xml())).toEqual({number:'00990099',date:'2026-09-06',amount:'1234.56',format:'ABRASF 2.04'});
  const prefixed=xml().replace(/xmlns=/,'xmlns:n=').replace(/<(\/?)(?!\?)([A-Za-z])/g,'<$1n:$2');
  expect(read(prefixed)).toEqual(read(xml()));
 });
 it('recusa outro namespace/versão, lote, nota duplicada e evento de cancelamento',()=>{
  for(const s of [xml().replace('nfse.xsd','outro.xsd'),xml().replace('2.04','9.99'),'<Lote>'+xml().replace(/<\?xml.*?\?>/,'')+'</Lote>',xml('<Numero>2</Numero>'),xml('<NfseCancelamento/>')])expect(()=>read(s)).toThrow();
  expect(()=>read(xml().replace('<Numero>00990099</Numero>','<Numero xmlns="urn:outro">00990099</Numero>'))).toThrow();
 });
 it('recusa estrutura inválida, DTD, entidades, encoding incompatível e excesso de profundidade/tamanho',()=>{
  for(const s of [xml().slice(0,-11),'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml(),xml('<Extra>&desconhecida;</Extra>'),xml().replace('UTF-8','ISO-8859-1'),xml('<a>'.repeat(40)+'</a>'.repeat(40)),xml('x'.repeat(2*1024*1024))])expect(()=>read(s)).toThrow();
 });
 it('recusa campos ausentes, conteúdo misto, datas impossíveis, negativos e vírgulas',()=>{
  for(const s of [xml().replace('<ValorServicos>1234.56</ValorServicos>',''),xml().replace('1234.56','1.234,56'),xml().replace('1234.56','-1.00'),xml().replace('2026-09-06','2026-02-31'),xml().replace('00990099','1<a/>2')])expect(()=>read(s)).toThrow();
  expect(read(xml().replace('1234.56','0')).amount).toBe('0.00');
 });
});
