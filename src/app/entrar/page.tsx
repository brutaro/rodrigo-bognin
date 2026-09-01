import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { SubmitButton } from "@/components/submit-button";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/entrar">) {
  if (await isAuthenticated()) redirect("/");
  const query = await searchParams;
  const failed = query.erro === "credenciais";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="grid size-12 place-items-center rounded-xl bg-[var(--brand)] font-black text-white">TR</div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-[var(--brand)]">Cofre pessoal</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--ink)]">Entrar como Rodrigo</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Use o código permanente guardado fora do aplicativo.</p>
        {failed ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">Não foi possível entrar. Verifique o código e tente novamente.</p> : null}
        <form action={loginAction} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-slate-800">Código de acesso
            <input name="codigo" type="password" required autoComplete="current-password" autoFocus className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-blue-600" />
          </label>
          <SubmitButton idleLabel="Entrar" pendingLabel="Verificando…" />
        </form>
      </section>
    </main>
  );
}
