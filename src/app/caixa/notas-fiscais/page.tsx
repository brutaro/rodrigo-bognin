import Link from 'next/link';
import {AppShell} from '@/components/app-shell';
import {FiscalPayments} from '@/components/fiscal-payments';
import {requireAuthenticatedPage} from '@/lib/auth';
import {getSql} from '@/lib/database';
import {readInvoiceCash} from '@/lib/fiscal-payment-repository';
export const dynamic='force-dynamic';
export default async function InvoiceCashPage(){
 await requireAuthenticatedPage();
 const {data,projects}=await getSql().begin('read only isolation level repeatable read',async tx=>({data:await readInvoiceCash(tx),projects:await tx<Array<{id:string;title:string}>>`SELECT id,title || CASE WHEN archived_at IS NOT NULL THEN ' (arquivado)' ELSE '' END title FROM project ORDER BY title,id`}));
 return <AppShell><main className="mx-auto max-w-6xl px-5 py-8"><Link href="/" className="text-sm underline">Voltar ao resumo financeiro</Link><h1 className="mt-3 text-3xl font-bold">Notas fiscais no caixa</h1><p className="mt-3 text-sm">Vincule cada saída à nota e ao projeto. A confirmação é uma declaração do proprietário; os documentos de origem e o histórico permanecem disponíveis.</p><FiscalPayments {...data} projects={projects}/></main></AppShell>;
}
