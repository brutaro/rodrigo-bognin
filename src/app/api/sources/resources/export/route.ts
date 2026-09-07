import { apiAuthenticationStatus } from "@/lib/auth";
import { getSql } from "@/lib/database";
import { resourceFields, type ResourceRow } from "@/lib/resource-import-domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 if (await apiAuthenticationStatus() !== "authenticated") return new Response("Entre novamente.",{status:401});
 const id=new URL(request.url).searchParams.get("id");
 if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Versão inválida",{status:400});
 const [version]=await getSql()`SELECT rows FROM resource_import WHERE id=${id} AND applied_at IS NOT NULL`;
 if(!version) return new Response("Versão não encontrada",{status:404});
 const escape=(value:string,index:number,numeric=false)=>'"'+(!numeric && /^[\s\u200b]*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
 const csv=[resourceFields.map((f,i)=>escape(f.label,i)).join(';'),...(version.rows as ResourceRow[]).map(row=>resourceFields.map((f,i)=>escape(row[f.key] ?? "",i,f.key==='amount'||f.key==='hours')).join(';'))].join('\r\n');
 return new Response('\uFEFF'+csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="tria-base-${id}.csv"`,'Cache-Control':'private, no-store'}});
}
