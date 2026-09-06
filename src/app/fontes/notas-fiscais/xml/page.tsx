import Link from 'next/link';
import {z} from 'zod';
import {AppShell} from '@/components/app-shell';
import {FiscalXml} from '@/components/fiscal-xml';
import {requireAuthenticatedPage} from '@/lib/auth';
import {getSql} from '@/lib/database';
import {realSourceUploadEnabled} from '@/lib/consolidated-source-repository';
import {readFiscalDocument} from '@/lib/fiscal-document';
import {readFiscalXmlFields,type FiscalXmlFields} from '@/lib/fiscal-xml-domain';
export const dynamic='force-dynamic';
export default async function FiscalXmlPage({searchParams}:{searchParams:Promise<{fonte?:string}>}){
 await requireAuthenticatedPage();const enabled=realSourceUploadEnabled(),query=await searchParams;
 const source=z.uuid().safeParse(query.fonte);let fields:FiscalXmlFields|undefined,error='';
 if(enabled&&query.fonte){try{if(!source.success)throw Error();fields=readFiscalXmlFields((await readFiscalDocument(source.data,'xml')).bytes);}catch{error='XML indisponível ou incompatível. Escolha novamente um arquivo válido.';}}
 const projects=enabled?await getSql()<Array<{id:string;title:string}>>`SELECT id,title FROM project ORDER BY title`:[];
 const recent=enabled?await getSql()`SELECT sf.id,v.original_name FROM source_file sf JOIN file_version v ON v.id=sf.file_version_id JOIN file_document d ON d.id=sf.document_id WHERE sf.source_format='xml' AND v.status='active' AND d.status='active' ORDER BY sf.received_at DESC LIMIT 10`:[];
 return <AppShell><main className="mx-auto max-w-4xl px-5 py-8"><Link href="/fontes/notas-fiscais" className="text-sm text-[var(--brand)] underline">Voltar à importação de notas</Link><h1 className="my-5 text-3xl font-bold">Cadastrar nota a partir de XML</h1><p className="mb-5 text-sm text-slate-600">Uma NFS-e ABRASF 2.03/2.04 ou nacional 1.00/1.01 por arquivo, em UTF-8, até 2 MiB. Não aceita lotes, DPS/RPS avulsos ou cancelamentos. O cadastro extrai campos; não valida assinatura digital nem consulta a situação fiscal. Para outros formatos, use <Link href="/fontes/notas-fiscais/pdf" className="underline">PDF</Link> ou planilha.</p>{error&&<p role="alert" className="mb-4 text-red-800">{error}</p>}{enabled?<FiscalXml key={source.success?source.data:'new'} source={source.success?source.data:undefined} fields={fields} projects={projects}/>:<p>Disponível no ambiente local do proprietário.</p>}{recent.length>0&&<details className="mt-5 rounded-lg border bg-white p-4"><summary>XMLs recebidos recentemente</summary><ul className="mt-3 space-y-2 text-sm">{recent.map(file=><li key={file.id}><Link href={`/fontes/notas-fiscais/xml?fonte=${file.id}`} className="text-[var(--brand)] underline">{file.original_name}</Link></li>)}</ul></details>}</main></AppShell>;
}
