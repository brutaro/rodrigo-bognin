import { requireAuthenticatedPage } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { AppShell } from "@/components/app-shell";
import { EditableFiscalNotes } from "@/components/editable-fiscal-notes";
import { listFiscalNotes, listProjectOptions } from "@/lib/project-repository";
import { restoreFiscalNoteAction, saveFiscalNoteAdjustmentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FiscalNotesPage() {
  await requireAuthenticatedPage();
  const [rows, projects] = await Promise.all([listFiscalNotes(), listProjectOptions()]);
  const notes = rows.map((note) => ({ ...note, adjustmentRequestId: randomUUID(), restoreRequestId: randomUUID() }));
  return <AppShell><main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
    <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Universo fiscal bruto</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Notas fiscais</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{notes.length} registros. O declarado e o candidato auditado são campos distintos. Uma NFS-e não comprova pagamento.</p>
    <EditableFiscalNotes notes={notes} projects={projects} saveAction={saveFiscalNoteAdjustmentAction} restoreAction={restoreFiscalNoteAction} />
  </main></AppShell>;
}
