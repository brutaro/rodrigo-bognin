import 'server-only';
import {createHash} from 'node:crypto';
import {getSql} from './database';
import {activityValues} from './resource-activity-domain';
import type {ResourceRow} from './resource-import-domain';
export type ActivityPlan = {items:Array<ReturnType<typeof activityValues> & {resourceId:string;sourceRow:number;activityId:string;projectId:string;expectedImport:string|null;changed:boolean}>;added:number;updated:number;unchanged:number;adjusted:number;legacy:number};
export async function prepareResourceActivities(rows:ResourceRow[], sourceRows:Map<string,number>):Promise<ActivityPlan> {
 const sql=getSql();
 const [projects,links,legacy]=await Promise.all([
  sql`SELECT id,title,coalesce(nullif(resource_source_title,''),title) source_title FROM project`,
  sql`SELECT l.resource_id,l.activity_id,l.latest_import_id::text,a.project_id,a.description,a.seconds,a.amount,a.date,a.bm,a.adjusted FROM resource_activity_state a JOIN resource_activity_link l ON l.activity_id=a.id`,
  sql`SELECT resource_id FROM resource_activity_legacy`,
 ]);
 const prior=new Map(links.map(l=>[l.resource_id,l]));const protectedIds=new Set(legacy.map(r=>r.resource_id));
 const result:ActivityPlan={items:[],added:0,updated:0,unchanged:0,adjusted:0,legacy:0};
 for(const row of rows){
  if(protectedIds.has(row.id)){result.legacy++;continue;}
  const matches=projects.filter(p=>p.source_title===row.project || p.title===row.project);
  if(matches.length!==1) throw Error(`ID ${row.id}: projeto não encontrado ou ambíguo. Cadastre ou confira o nome antes de importar atividades.`);
  const project=matches[0],old=prior.get(row.id),values=activityValues(row);
  if(old && old.project_id!==project.id) throw Error(`ID ${row.id}: a atividade já pertence a outro projeto.`);
  const changed=!old || old.description!==values.description || old.seconds!==values.seconds || !sameDecimal(old.amount,values.amount) || old.date!==values.date || old.bm!==values.bm;
  if(!old)result.added++;else if(changed)result.updated++;else result.unchanged++;
  if(old?.adjusted)result.adjusted++;
  result.items.push({...values,resourceId:row.id,sourceRow:sourceRows.get(row.id)!,activityId:old?.activity_id ?? `IMP-${createHash('sha256').update(row.id).digest('hex')}`,projectId:project.id,expectedImport:old?.latest_import_id ?? null,changed:Boolean(changed)});
 }
 return result;
}
function sameDecimal(a:string,b:string){const scaled=(v:string)=>{const neg=v.startsWith('-');const [i,f='']=v.replace(/^-/,'').split('.');return (BigInt(i)*10n**16n+BigInt(f.padEnd(16,'0')))*(neg?-1n:1n);};return scaled(a)===scaled(b);}
