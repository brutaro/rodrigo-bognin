import Link from "next/link";

export const activityPageSize = 100;

export function normalizeActivityPage(value: string | undefined, total: number) {
  const requested = Number(value);
  const pages = Math.max(1, Math.ceil(total / activityPageSize));
  return Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
}

export function ActivityPagination({ basePath, page, total, anchor = "activities-title" }: { basePath: string; page: number; total: number; anchor?: string }) {
  const pages = Math.max(1, Math.ceil(total / activityPageSize));
  if (pages === 1) return null;
  const href = (target: number) => `${basePath}?activityPage=${target}#${anchor}`;
  return (
    <nav aria-label="Paginação de atividades" className="flex items-center justify-between gap-4 border-t border-[var(--border)] p-4 text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="font-semibold text-[var(--brand)] hover:underline">← Anteriores</Link> : <span />}
      <span className="text-slate-500">Página {page} de {pages}</span>
      {page < pages ? <Link href={href(page + 1)} className="font-semibold text-[var(--brand)] hover:underline">Próximas →</Link> : <span />}
    </nav>
  );
}
