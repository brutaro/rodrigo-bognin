import { AppShell } from "@/components/app-shell";
import { ContextVault } from "@/components/context-vault";
import { requireAuthenticatedPage } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/database";
import { listContextDocuments } from "@/lib/context-repository";
export const dynamic="force-dynamic";
export default async function ContextPage(){
 await requireAuthenticatedPage();
 return <AppShell><main className="mx-auto max-w-6xl px-5 py-8"><h1 className="text-3xl font-bold">Contexto</h1><p className="my-4 text-[var(--ink-muted)]">Narrativas e contextos gerais guardados em PDF.</p>{isDatabaseConfigured()?<ContextVault documents={await listContextDocuments()}/>:<p>O cofre exige o banco e o volume local.</p>}</main></AppShell>;
}
