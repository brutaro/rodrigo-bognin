import type { ProjectStatus } from "@/lib/demo-data";

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const label = status === "Publicado" ? "Publicado" : "Disponível";
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
      {label}
    </span>
  );
}
