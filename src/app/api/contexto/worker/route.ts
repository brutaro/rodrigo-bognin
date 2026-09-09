import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAuthenticatedApi } from "@/lib/auth";
export async function GET(){
 if(!await requireAuthenticatedApi())return new Response("Não autenticado.",{status:401});
 return new Response(await readFile(join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),'utf8'),{headers:{'Content-Type':'text/javascript','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
}
