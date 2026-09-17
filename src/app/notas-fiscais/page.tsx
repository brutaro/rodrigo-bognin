import {getSql,isDatabaseConfigured} from "@/lib/database";
import Link from "next/link";
import { requireAuthenticatedPage } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { AppShell } from "@/components/app-shell";
import { EditableFiscalNotes } from "@/components/editable-fiscal-notes";
import { listFiscalNotes, listProjectOptions } from "@/lib/project-repository";
import { deleteFiscalNoteAction, restoreFiscalNoteAction, saveFiscalNoteAdjustmentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FiscalNotesPage({searchParams}:{searchParams:Promise<{nota?:string}>}) {
  await requireAuthenticatedPage();
  const [rows, projects] = await Promise.all([listFiscalNotes(), listProjectOptions()]);
  const selected=(await searchParams).nota;
  const pdfs=selected&&isDatabaseConfigured()?await getSql()`SELECT DISTINCT sf.id,sf.source_format,v.original_name FROM fiscal_import i JOIN source_file sf ON sf.id=i.source_file_id JOIN file_version v ON v.id=sf.file_version_id WHERE i.applied_at IS NOT NULL AND sf.source_format IN ('pdf','xml') AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.rows) r WHERE r->>'id'=${selected})`:[];
  const notes = (selected ? rows.filter(note=>note.id===selected) : rows).map((note) => ({ ...note, adjustmentRequestId: randomUUID(), restoreRequestId: randomUUID(), deleteRequestId: randomUUID() }));
  return <AppShell><main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
    <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Universo fiscal bruto</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Notas fiscais</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{selected ? `${notes.length} de ${rows.length} registros` : `${notes.length} registros`}. O declarado e o candidato auditado são campos distintos. Registre a confirmação do proprietário para relacionar a nota à saída no caixa.</p>
    <Link href="/caixa/notas-fiscais" className="mt-3 inline-block font-semibold text-[var(--brand)] underline">Conferir pagamentos das notas fiscais</Link>
    <Link href="/fontes/notas-fiscais" className="my-5 inline-block rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white">Importar planilha de notas</Link>
    <Link href="/fontes/notas-fiscais/pdf" className="ml-4 text-sm text-[var(--brand)] underline">Cadastrar a partir de PDF</Link>
    <Link href="/fontes/notas-fiscais/xml" className="ml-4 text-sm text-[var(--brand)] underline">Cadastrar a partir de XML</Link>
    {selected && <p className="mb-4 text-sm">{notes.length ? "Nota selecionada para conferência." : "A nota selecionada não foi encontrada."} <Link href="/notas-fiscais" className="ml-2 text-[var(--brand)] underline">Ver todas as notas</Link><Link href="/fontes/notas-fiscais" className="ml-3 text-[var(--brand)] underline">Voltar à importação</Link></p>}
    {pdfs.length>0&&<section className="mb-5 rounded-lg border bg-white p-4"><h2 className="font-semibold">Arquivos fiscais de origem</h2>{pdfs.map(file=><a key={file.id} href={`/api/sources/fiscal-${file.source_format}/${file.id}?download=1`} className="mt-2 block text-sm text-[var(--brand)] underline">{file.original_name}</a>)}</section>}
    <EditableFiscalNotes deleteAction={deleteFiscalNoteAction} notes={notes} projects={projects} saveAction={saveFiscalNoteAdjustmentAction} restoreAction={restoreFiscalNoteAction} />
  </main></AppShell>;
}
