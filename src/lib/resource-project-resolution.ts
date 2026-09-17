export type ProjectIdentity = { id: string; title: string; source_title: string };

// A historical source name is a fallback, never a competitor to a current title.
// Do not prefer active projects: that would silently move existing activities.
export function matchingResourceProjects<T extends ProjectIdentity>(projects: readonly T[], title: string): T[] {
  const current = projects.filter(project => project.title === title);
  return current.length ? current : projects.filter(project => project.source_title === title);
}

export function resourceProjectTitles(projects: readonly ProjectIdentity[], projectId: string): string[] {
  return [...new Set(projects.flatMap(project => [project.title, project.source_title]))].filter(title => {
    const matches = matchingResourceProjects(projects, title);
    return matches.length === 1 && matches[0].id === projectId;
  });
}
