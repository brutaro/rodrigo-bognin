import { assertSameOrigin, requireAuthenticatedApi } from '@/lib/auth';
import { purgeContextFile } from '@/lib/file-repository';

export async function DELETE(request:Request, context:{params:Promise<{id:string}>}) {
  if (!await requireAuthenticatedApi()) return Response.json({error:'Não autenticado.'},{status:401});
  try { await assertSameOrigin(request); } catch { return Response.json({error:'Origem inválida.'},{status:403}); }
  const {id}=await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return Response.json({error:'Arquivo inválido.'},{status:400});
  try { return Response.json(await purgeContextFile(id),{headers:{'Cache-Control':'no-store'}}); }
  catch (error) { console.error("Contexto: exclusão", error instanceof Error ? error.message : "erro"); return Response.json({error:'A exclusão não foi concluída. Tente excluir novamente.'},{status:503}); }
}
