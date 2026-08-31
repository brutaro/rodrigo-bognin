import type { ProjectStatus } from "@/lib/demo-data";

const styles: Record<ProjectStatus, string> = {
  "Em trabalho": "bg-sky-50 text-sky-800 ring-sky-200",
  "Pronto para revisar": "bg-amber-50 text-amber-800 ring-amber-200",
  Publicado: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}
