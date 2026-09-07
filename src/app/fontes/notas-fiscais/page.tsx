import Link from "next/link";
import {AppShell} from "@/components/app-shell";
import {FiscalImport} from "@/components/fiscal-import";
import {requireAuthenticatedPage} from "@/lib/auth";
import {realSourceUploadEnabled} from "@/lib/consolidated-source-repository";
import {getSql} from "@/lib/database";
export const dynamic="force-dynamic";
export default async function FiscalImportPage(){
 await requireAuthenticatedPage();const enabled=realSourceUploadEnabled();
 const history=enabled?await getSql()`SELECT id,applied_at::text,inserted_count FROM fiscal_import WHERE applied_at IS NOT NULL ORDER BY applied_at DESC LIMIT 10`:[];
 return <AppShell><main className="mx-auto max-w-4xl px-5 py-8"><Link href="/notas-fiscais" className="text-sm text-[var(--brand)] underline">Voltar às notas fiscais</Link><h1 className="my-5 text-3xl font-bold">Importar notas fiscais</h1><p className="mb-6 text-sm text-slate-600">Envie XLSX ou CSV, confira as colunas e importe as notas novas. O arquivo original será preservado no cofre.</p><Link href="/fontes/notas-fiscais/pdf" className="mb-5 inline-block rounded-lg border border-[var(--brand)] bg-white px-4 py-3 text-sm font-semibold text-[var(--brand)]">Cadastrar a partir de PDF</Link><Link href="/fontes/notas-fiscais/xml" className="mb-5 ml-4 inline-block text-sm text-[var(--brand)] underline">Cadastrar a partir de XML</Link>{enabled?<FiscalImport/>:<p>Importação disponível no ambiente local do proprietário.</p>}{history.length>0&&<section className="mt-6 border-t pt-4"><h2 className="font-semibold">Últimas importações</h2><ul className="mt-3 space-y-2 text-sm">{history.map(row=><li key={row.id}>{new Date(row.applied_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} · {row.inserted_count} notas novas</li>)}</ul></section>}</main></AppShell>;
}
