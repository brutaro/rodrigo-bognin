import 'server-only';
import {matchingResourceProjects} from './resource-project-resolution';
import {createHash,randomUUID} from 'node:crypto';
import {getSql} from './database';
import type {ResourceRow} from './resource-import-domain';
export type ResourceProject = {id:string;title:string;source_title:string;revision:string;archived:boolean;start:string|null;end:string|null};
export type ResourceProjectPlan = {overwrite:boolean;incomingTitles:string[];catalogHash:string;create:Array<{id:string;title:string}>;archive:ResourceProject[];restore:ResourceProject[]};
export async function resourceProjectCatalog(sql = getSql()) {
 return sql<ResourceProject[]>`SELECT id,title,coalesce(nullif(resource_source_title,''),title) source_title,metadata_revision::text revision,archived_at IS NOT NULL archived,date_start::text start,date_end::text "end" FROM project ORDER BY id`;
}
export function projectCatalogHash(projects:ResourceProject[]) {return createHash('sha256').update(JSON.stringify(projects)).digest('hex');}
export function planResourceProjects(projects:ResourceProject[],rows:ResourceRow[],previous:ResourceRow[],overwrite:boolean,planned:ResourceProjectPlan['create']=[],incomingTitles=[...new Set(rows.map(row=>row.project))]):ResourceProjectPlan {
 const plan:ResourceProjectPlan={overwrite,incomingTitles,catalogHash:projectCatalogHash(projects),create:[],archive:[],restore:[]};
 const present=new Set<string>();
 for(const title of new Set(rows.map(row=>row.project))){
  const matches=matchingResourceProjects(projects,title);
  if(matches.length>1)throw Error(`Projeto "${title}" ambíguo. Confira os cadastros antes de importar.`);
  if(matches.length){present.add(matches[0].id);if(matches[0].archived && incomingTitles.includes(title))plan.restore.push(matches[0]);}
  else if(incomingTitles.includes(title)) {if(title.length<3 || title.length>200)throw Error(`Nome de projeto inválido: "${title}". Use entre 3 e 200 caracteres.`);plan.create.push(planned.find(p=>p.title===title) ?? {id:`manual-${randomUUID()}`,title});}
 }
 const priorIds=new Set(previous.flatMap(row=>{const matches=matchingResourceProjects(projects,row.project);return matches.length===1?[matches[0].id]:[];}));
 if(overwrite)plan.archive=projects.filter(p=>!p.archived&&!present.has(p.id)&&priorIds.has(p.id));
 return plan;
}
