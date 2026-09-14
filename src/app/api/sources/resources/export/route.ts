import { apiAuthenticationStatus } from "@/lib/auth";
import { getSql } from "@/lib/database";
import { resourceFields, type ResourceRow } from "@/lib/resource-import-domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 if (await apiAuthenticationStatus() !== "authenticated") return new Response("Entre novamente.",{status:401});
 const params=new URL(request.url).searchParams;
 const id=params.get("id");
 const projectId=params.get("projectId");
 if(projectId!==null && (!projectId.trim() || projectId.length>120)) return new Response("Projeto inválido",{status:400});
 if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Versão inválida",{status:400});
 const [version]=await getSql()`SELECT rows FROM resource_import WHERE id=${id} AND applied_at IS NOT NULL`;
 if(!version) return new Response("Versão não encontrada",{status:404});
 let rows=version.rows as ResourceRow[];
 if(projectId!==null){
  const [project]=await getSql()`SELECT coalesce(nullif(resource_source_title,''),title) source_title FROM project WHERE id=${projectId}`;
  if(!project) return new Response("Projeto não encontrado",{status:404});
  rows=rows.filter(row=>row.project===project.source_title);
 }
 const escape=(value:string,index:number,numeric=false)=>'"'+(!numeric && /^[\s\u200b]*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
 const csv=[resourceFields.map((f,i)=>escape(f.label,i)).join(';'),...rows.map(row=>resourceFields.map((f,i)=>escape(row[f.key] ?? "",i,f.key==='amount'||f.key==='hours')).join(';'))].join('\r\n');
 return new Response('\uFEFF'+csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="tria-base-${id}${projectId!==null ? `-projeto-${encodeURIComponent(projectId)}` : ""}.csv"`,'Cache-Control':'private, no-store'}});
}
