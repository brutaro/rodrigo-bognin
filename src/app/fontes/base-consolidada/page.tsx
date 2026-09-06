import Link from "next/link";
import { resourceHistory } from "@/lib/resource-import";
import { ResourceImport } from "@/components/resource-import";
import { ResourceSummary } from "@/components/resource-summary";
import { realSourceUploadEnabled } from "@/lib/consolidated-source-repository";
import { AppShell } from "@/components/app-shell";
import { ConsolidatedSourceFlow } from "@/components/consolidated-source-flow";
import { requireAuthenticatedPage } from "@/lib/auth";
import { consolidatedSourceUploadEnabled } from "@/lib/consolidated-source-repository";

export const dynamic = "force-dynamic";

export default async function ConsolidatedSourcePage() {
  await requireAuthenticatedPage();
  const history = realSourceUploadEnabled() ? await resourceHistory() : [];
  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-5 py-8 lg:px-8 lg:py-10">
        <header className="mb-7">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Fontes</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">Receber fonte consolidada</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">Preserve a origem, selecione e mapeie a fonte, confira as linhas e confirme a prévia nesta página.</p>
        </header>
        <Link href="/fontes/notas-fiscais" className="mb-5 inline-block text-sm font-semibold text-[var(--brand)] underline">Importar planilha de notas fiscais</Link>
        {realSourceUploadEnabled() ? <><ResourceSummary /><ResourceImport /></> : <ConsolidatedSourceFlow enabled={consolidatedSourceUploadEnabled()} />}
        {history.length > 0 && <section className="mt-6 border-t pt-5"><h2 className="font-bold">Versões anteriores da base</h2><ul className="mt-3 space-y-2">{history.map(item => <li key={item.id}><a className="text-sm underline" href={`/api/sources/resources/export?id=${item.id}`}>{new Date(item.applied_at).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo"})} · {item.count} lançamentos · Baixar CSV</a></li>)}</ul></section>}
      </main>
    </AppShell>
  );
}
