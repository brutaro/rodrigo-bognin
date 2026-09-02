import { AppShell } from "@/components/app-shell";
import { ConsolidatedSourceUpload } from "@/components/consolidated-source-upload";
import { requireAuthenticatedPage } from "@/lib/auth";
import { consolidatedSourceUploadEnabled } from "@/lib/consolidated-source-repository";

export const dynamic = "force-dynamic";

export default async function ConsolidatedSourcePage() {
  await requireAuthenticatedPage();
  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-5 py-8 lg:px-8 lg:py-10">
        <header className="mb-7">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Fontes</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">Receber fonte consolidada</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">Esta etapa preserva a origem. Seleção de aba, leitura, prévia e aplicação acontecem depois.</p>
        </header>
        <ConsolidatedSourceUpload enabled={consolidatedSourceUploadEnabled()} />
      </main>
    </AppShell>
  );
}
