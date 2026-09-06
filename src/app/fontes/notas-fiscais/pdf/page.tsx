import Link from 'next/link';
import {AppShell} from '@/components/app-shell';
import {FiscalPdf} from '@/components/fiscal-pdf';
import {requireAuthenticatedPage} from '@/lib/auth';
import {getSql} from '@/lib/database';
import {realSourceUploadEnabled} from '@/lib/consolidated-source-repository';
export const dynamic='force-dynamic';
export default async function FiscalPdfPage({searchParams}:{searchParams:Promise<{fonte?:string}>}) {
 await requireAuthenticatedPage();const enabled=realSourceUploadEnabled(),query=await searchParams;
 const validSource=/^[a-f0-9-]{36}$/.test(query.fonte??'')?query.fonte:undefined;
 const projects=enabled?await getSql()<Array<{id:string;title:string}>>`SELECT id,title FROM project ORDER BY title`:[];
 const recent=enabled?await getSql()`SELECT sf.id,v.original_name FROM source_file sf JOIN file_version v ON v.id=sf.file_version_id WHERE sf.source_format='pdf' ORDER BY sf.received_at DESC LIMIT 10`:[];
 return <AppShell><main className="mx-auto max-w-6xl px-5 py-8"><Link href="/fontes/notas-fiscais" className="text-sm text-[var(--brand)] underline">Voltar à importação de notas</Link><h1 className="my-5 text-3xl font-bold">Cadastrar nota a partir de PDF</h1><p className="mb-5 text-sm text-slate-600">Visualize o documento e confira os dados antes de cadastrar. O PDF original fica protegido no cofre.</p>{enabled?<FiscalPdf key={validSource??"new"} initialSource={validSource} projects={projects}/>:<p>Disponível no ambiente local do proprietário.</p>}{recent.length>0&&<details className="mt-5 rounded-lg border bg-white p-4"><summary className="cursor-pointer font-semibold">PDFs recebidos recentemente</summary><ul className="mt-3 space-y-2 text-sm">{recent.map(file=><li key={file.id}><Link href={`/fontes/notas-fiscais/pdf?fonte=${file.id}`} className="text-[var(--brand)] underline">{file.original_name}</Link></li>)}</ul></details>}</main></AppShell>;
}
