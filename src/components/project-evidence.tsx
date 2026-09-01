type Evidence = {
  id: string;
  name: string;
  kind: string;
  availability: "Disponível" | "Pendente";
  linkStrength?: string;
  linkStatus?: string;
  versionId?: string;
  sizeBytes?: number;
  sha256?: string;
};

function formatBytes(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "byte", unitDisplay: "narrow" }).format(value);
}

export function ProjectEvidence({ projectId, evidence }: { projectId: string; evidence: Evidence[] }) {
  return <section aria-labelledby="evidence-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
    <div className="border-b border-[var(--border)] p-5">
      <h2 id="evidence-title" className="text-lg font-bold">Evidências catalogadas</h2>
      <p className="mt-1 text-sm text-slate-500">Um único objeto verificado atende a todos os projetos vinculados.</p>
    </div>
    <ul className="divide-y divide-[var(--border)]">
      {evidence.map((item) => <li key={item.id} className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-[var(--ink)]">{item.name}</p>
            <p className="mt-1 text-xs text-slate-500">{item.kind}{item.sizeBytes === undefined ? "" : ` · ${formatBytes(item.sizeBytes)}`}</p>
            <p className="mt-1 text-xs text-slate-500">Força do vínculo: {item.linkStrength || "não informado"} · Estado do vínculo: {item.linkStatus || "não informado"} · Disponibilidade física: {item.availability}</p>
          </div>
          {item.versionId ? <a className="shrink-0 text-sm font-bold text-[var(--brand)] hover:underline" href={`/api/projects/${encodeURIComponent(projectId)}/evidence/${item.id}/download`}>Baixar</a>
            : <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">Pendente</span>}
        </div>
        {item.sha256 ? <code className="mt-2 block break-all text-[10px] text-slate-500">SHA-256 {item.sha256}</code> : null}
      </li>)}
      {!evidence.length ? <li className="p-5 text-sm text-slate-500">Nenhuma evidência catalogada.</li> : null}
    </ul>
  </section>;
}
