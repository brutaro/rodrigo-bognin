import {readBoundedXml,type XmlNode} from '@/modules/source-ledger/domain/passive-tabular-reader';
export const fiscalXmlLimitBytes=2*1024*1024;
const namespace='http://www.abrasf.org.br/nfse.xsd';
const nationalNamespace='http://www.sped.fazenda.gov.br/nfse';
export type FiscalXmlFields={number:string;date:string;amount:string;format:'ABRASF 2.04'|'ABRASF 2.03'|'NFS-e nacional 1.00'|'NFS-e nacional 1.01'};
const invalid=()=>new Error('XML incompatível ou incompleto. Envie uma única NFS-e ABRASF 2.03/2.04 ou nacional 1.00/1.01, em UTF-8. Para outros formatos, use PDF ou planilha.');
export function readFiscalXmlFields(bytes:Uint8Array):FiscalXmlFields{
 if(!bytes.length||bytes.length>fiscalXmlLimitBytes)throw Error('Envie um XML de até 2 MiB.');
 let root:XmlNode;
 try{
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)||/<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])/i.test(xml))throw invalid();
  root=readBoundedXml(xml);
 }catch{throw invalid();}
 // Resolve namespaces antes de selecionar caminhos; nunca buscar apenas pelo nome local.
 const names=new Map<XmlNode,string>();
 function visit(node:XmlNode,inherited:Record<string,string>){
  const bindings={...inherited};
  for(const [key,value] of Object.entries(node.attrs))if(key==='xmlns'||key.startsWith('xmlns:'))bindings[key==='xmlns'?'':key.slice(6)]=value;
  const parts=node.name.split(':');if(parts.length>2)throw invalid();
  const prefix=parts.length===2?parts[0]:'';
  const local=parts.at(-1)!;const ns=bindings[prefix];
  if(prefix&&!ns)throw invalid();
  names.set(node,ns===namespace?local:ns===nationalNamespace?'national:'+local:'');
  if(/cancelamento|substituicao/i.test(local)||local==='subst')throw Error('XML com cancelamento ou substituição exige conferência na origem. Este fluxo não altera a situação de notas existentes.');
  node.children.forEach(child=>visit(child,bindings));
 }
 visit(root,{});
 const one=(node:XmlNode,name:string)=>{const children=node.children.filter(child=>names.get(child)===name);if(children.length!==1)throw invalid();return children[0];};
 const scalar=(node:XmlNode)=>{if(node.children.length||!node.text.trim())throw invalid();return node.text.trim();};
 let number:string,timestamp:string,amount:string,format:FiscalXmlFields['format'];
 if(names.get(root)==='national:NFSe'){
  if(!['1.00','1.01'].includes(root.attrs.versao)||[...names.values()].filter(name=>name==='national:NFSe').length!==1)throw invalid();
  const info=one(root,'national:infNFSe');
  if(!['100','102','103','107'].includes(scalar(one(info,'national:cStat'))))throw invalid();
  number=scalar(one(info,'national:nNFSe'));
  timestamp=scalar(one(info,'national:dhProc'));
  const dps=one(info,'national:DPS');if(!['1.00','1.01'].includes(dps.attrs.versao))throw invalid();
  const declaration=one(dps,'national:infDPS');
  amount=scalar(one(one(one(declaration,'national:valores'),'national:vServPrest'),'national:vServ'));
  format=root.attrs.versao==='1.00'?'NFS-e nacional 1.00':'NFS-e nacional 1.01';
 }else{
  const nfse=names.get(root)==='CompNfse'?one(root,'Nfse'):names.get(root)==='Nfse'?root:undefined;
  if(!nfse||!['2.03','2.04'].includes(nfse.attrs.versao))throw invalid();
  if([...names.values()].filter(name=>name==='Nfse').length!==1||[...names.values()].filter(name=>name==='InfNfse').length!==1)throw invalid();
  const info=one(nfse,'InfNfse');
  number=scalar(one(info,'Numero'));timestamp=scalar(one(info,'DataEmissao'));
  const declaration=one(one(info,'DeclaracaoPrestacaoServico'),'InfDeclaracaoPrestacaoServico');
  amount=scalar(one(one(one(declaration,'Servico'),'Valores'),'ValorServicos'));
  format=nfse.attrs.versao==='2.03'?'ABRASF 2.03':'ABRASF 2.04';
 }
 if(!/^\d{1,15}$/.test(number)||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?$/.test(timestamp)||!/^\d{1,15}(?:\.\d{1,2})?$/.test(amount))throw invalid();
 const date=timestamp.slice(0,10);
 if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||Number(date.slice(0,4))<1900||Number(date.slice(0,4))>2100)throw invalid();
 const [integer,cents='']=amount.split('.');
 return {number,date,amount:`${BigInt(integer)}.${cents.padEnd(2,'0')}`,format};
}
