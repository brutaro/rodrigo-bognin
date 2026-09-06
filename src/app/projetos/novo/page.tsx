import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireAuthenticatedPage, assertSameOrigin } from "@/lib/auth";
import { getSql } from "@/lib/database";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
export default async function NewProject({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requireAuthenticatedPage();
  const query = await searchParams;
  async function create(form: FormData) {
    "use server";
    await requireAuthenticatedPage(); await assertSameOrigin();
    const title = String(form.get("title") ?? "").trim();
    if(title.length < 3 || title.length > 200) redirect("/projetos/novo?erro=nome");
    const id = `manual-${randomUUID()}`;
    try { await getSql()`SELECT create_owner_project(${id},${title})`; }
    catch { redirect("/projetos/novo?erro=cadastro"); }
    redirect(`/projetos/${id}`);
  }
  return <AppShell><main className="mx-auto max-w-2xl px-5 py-10"><h1 className="text-3xl font-bold">Novo projeto</h1><p className="mt-3 text-[var(--ink-muted)]">Comece pelo nome. Depois registre a narrativa, os valores e os arquivos.</p>{query.erro && <p role="alert" className="my-4 text-red-800">Não foi possível criar. Use um nome entre 3 e 200 caracteres, diferente dos projetos existentes.</p>}<form action={create} className="mt-6 space-y-5"><label className="block font-semibold">Nome do projeto<input name="title" required minLength={3} maxLength={200} className="mt-2 block w-full rounded border p-3 bg-white" /></label><SubmitButton idleLabel="Criar projeto" pendingLabel="Criando…" /></form></main></AppShell>;
}
