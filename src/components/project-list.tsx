"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectSummary } from "@/lib/project-repository";
import { StatusBadge } from "@/components/status-badge";

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = useMemo(
    () =>
      projects.filter(project => Boolean(project.archived) === showArchived).filter((project) =>
        `${project.name} ${project.period} ${project.status}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized),
      ),
    [normalized, projects, showArchived],
  );

  return (
    <section aria-labelledby="project-list-title" className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="project-list-title" className="text-lg font-bold text-[var(--ink)]">Projetos</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Abra um projeto para consultar narrativa, atividades, valores e evidências.</p>
        </div>
        <label className="relative block w-full md:max-w-sm">
          <span className="sr-only">Buscar projetos</span>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, período ou situação"
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3 text-sm"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Mostrar arquivados ({projects.filter(project => project.archived).length})</label>
      {filtered.length ? (
        <ul className="divide-y divide-[var(--border)]">
          {filtered.map((project) => (
            <li key={project.id}>
              <Link href={`/projetos/${project.id}`} className="group grid gap-4 p-5 transition hover:bg-slate-50 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--brand)]">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">{project.period}</p>
                  <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-600">{project.narrative}</p>
                </div>
                <div className="flex items-center gap-5 text-sm text-slate-600">
                  <span><strong className="block text-base text-[var(--ink)]">{project.activityCount}</strong> atividades</span>
                  <span><strong className="block text-base text-[var(--ink)]">{project.evidenceCount}</strong> evidências</span>
                  <span aria-hidden className="text-xl text-slate-400 transition group-hover:translate-x-1 group-hover:text-[var(--brand)]">→</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-10 text-center">
          <p className="font-semibold text-[var(--ink)]">Nenhum projeto encontrado</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Tente outro termo de busca.</p>
        </div>
      )}
    </section>
  );
}
