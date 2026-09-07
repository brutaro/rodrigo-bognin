import {AppShell} from '@/components/app-shell';
import {requireAuthenticatedPage} from '@/lib/auth';
export default async function BackupPage(){
 await requireAuthenticatedPage();
 return <AppShell><main className="mx-auto max-w-3xl px-5 py-8"><h1 className="text-3xl font-bold">Backup e recuperação</h1>
  <section className="mt-6 space-y-4 rounded-lg border bg-white p-5"><h2 className="text-xl font-semibold">Cópia completa da aplicação</h2><p className="text-sm">Inclui projetos, valores, importações, publicações, arquivos originais e configurações de acesso. É feita neste computador, com uma pausa breve da aplicação para manter os dados consistentes.</p><p className="text-sm">Na pasta do projeto, execute:</p><code className="block rounded bg-stone-100 p-3 text-sm">npm run backup:local</code><p className="text-sm">A cópia fica em <code>.local-backups</code>. A recuperação é conferida em um ambiente separado, sem substituir os dados em uso. Guarde essa pasta em local privado: ela contém os dados e códigos de acesso.</p></section>
  <section className="mt-5 space-y-4 rounded-lg border bg-white p-5"><h2 className="text-xl font-semibold">Cópia somente dos arquivos</h2><p className="text-sm">Baixa o cofre, seus originais e o catálogo de vínculos. Este ZIP não contém o banco completo e, sozinho, não recupera projetos, valores e publicações.</p><a href="/api/backups/files" className="inline-block rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white">Baixar cofre de arquivos</a></section>
 </main></AppShell>;
}
