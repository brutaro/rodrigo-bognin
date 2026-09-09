import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prepareResourceActivities, type ActivityPlan } from "./resource-activity-import";
import { getSql } from "./database";
import { realSourceUploadEnabled } from "./consolidated-source-repository";
import { verifiedStoredObjectNodeStream } from "./file-store";
import { PassiveTabularReader } from "@/modules/source-ledger/domain/passive-tabular-reader";
import { syntheticSafeLimits } from "@/modules/source-ledger/domain/import-registry";
import { preserveResourceExecutors, mergeProjectResources, resourceDifferences, resolveResourceRows, type ResourceDecisions, resourceTotalCents, compareResources, suggestResourceMapping, validateResourceRows, type ResourceRow, type ResourceMapping } from "./resource-import-domain";

function enabled() { if (!realSourceUploadEnabled()) throw new Error("Importação real disponível somente no ambiente local do proprietário."); }
export async function sourceDocument(sourceId: string, delimiter: "," | ";" | "\t" = ";") {
  enabled();
  const [file] = await getSql()`SELECT v.object_key::text, v.size_bytes::text, v.sha256, sf.source_format FROM source_file sf
    JOIN file_version v ON v.id=sf.file_version_id JOIN file_document d ON d.id=sf.document_id
    WHERE sf.id=${sourceId} AND v.status='active' AND d.status='active' AND d.document_kind='source'`;
  if (!file) throw new Error("Arquivo original não encontrado.");
  if (file.source_format === "xls") throw new Error("Salve a planilha antiga como XLSX ou CSV antes de importar.");
  if (!["xlsx","csv"].includes(file.source_format)) throw new Error("Escolha uma planilha XLSX ou CSV para esta importação.");
  const chunks: Buffer[] = [];
  for await (const chunk of await verifiedStoredObjectNodeStream(file.object_key, Number(file.size_bytes), file.sha256)) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const document = await new PassiveTabularReader().enumerate({ bytes, sourceSha256: file.sha256, sourceFormat: file.source_format.toUpperCase(), limits: { ...syntheticSafeLimits, version: "local-resource-v1", maxXmlNodes: 300000, maxMilliseconds: 20000 }, allowPresentationSheets: true,
    csvParseOptions: { encoding: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? "utf-8-bom" : "utf-8", delimiter, quote: '"', escape: "double-quote", allowMultilineQuotedField: true } });
  return { hash: file.sha256 as string, sheets: document.sheets ?? [{ selection: { name: "CSV", ordinal: 0 }, headers: document.csv!.headers, rows: document.csv!.rows,locators:document.csv!.locators }] };
}
export async function inspectResourceSource(sourceId: string, delimiter?: "," | ";" | "\t") {
  const doc = await sourceDocument(sourceId, delimiter);
  return doc.sheets.map(sheet => ({ name: sheet.selection.name, ordinal: sheet.selection.ordinal, headers: sheet.headers, count: sheet.rows.length, mapping: suggestResourceMapping(sheet.headers) }));
}
export async function currentResources() {
  const [row] = await getSql()`SELECT i.id::text, i.rows, i.applied_at::text, i.sheet_name FROM resource_import_current c JOIN resource_import i ON i.id=c.import_id WHERE c.singleton`;
  return row ? { id: row.id as string, rows: row.rows as ResourceRow[], appliedAt: row.applied_at as string, sheet: row.sheet_name as string } : null;
}
function previewResult(id: string, hash: string, current: ResourceRow[], rows: ResourceRow[], errors: string[], title?: string | null) {
  const before = title ? current.filter(row => row.project === title) : current;
  const after = title ? rows.filter(row => row.project === title) : rows;
  return { id, hash, differences: resourceDifferences(before, after), count: after.length, errors: errors.slice(0,30), errorCount: errors.length, sample: after.slice(0,20), totalCents: resourceTotalCents(after).toString(), ...compareResources(before, after) };
}
export async function prepareResources(sourceId: string, ordinal: number, mapping: ResourceMapping, delimiter?: "," | ";" | "\t", projectId?: string, includeActivities = false) {
  let scope: { title: string; aliases: string[] } | undefined;
  if (projectId) {
    const [project] = await getSql()`SELECT title,coalesce(nullif(resource_source_title,''),title) source_title FROM project WHERE id=${projectId}`;
    if (!project) throw new Error("Projeto não encontrado.");
    scope = { title: project.source_title, aliases: [project.title, project.source_title] };
  }
  const doc = await sourceDocument(sourceId, delimiter);
  const sheet = doc.sheets.find(s => s.selection.ordinal === ordinal);
  if (!sheet) throw new Error("Selecione uma aba válida.");
  const data = validateResourceRows(sheet.rows, mapping, sheet.headers.length, sheet.locators, scope);
  const current = await currentResources();
  const incoming = preserveResourceExecutors(current?.rows ?? [], data.rows);
  const rows = scope ? mergeProjectResources(current?.rows ?? [], incoming, scope.title) : incoming;
  const activityPlan = includeActivities && !data.errors.length ? await prepareResourceActivities(data.rows, new Map(sheet.rows.map((row,index) => [String(row[mapping.id]).trim(), Number(sheet.locators?.[index]?.replace(/^row:/,"")) || index+2]))) : null;
  const activityInputIds = includeActivities ? data.rows.map(row => row.id) : null;
  const id = randomUUID();
  const hash = createHash("sha256").update(JSON.stringify({ source: doc.hash, ordinal, mapping, rows, projectId, activityPlan })).digest("hex");
  await getSql()`INSERT INTO resource_import(id,source_file_id,content_hash,sheet_name,rows,errors,base_id,scope_project_id,scope_project_title,activity_plan,activity_input_ids)
    VALUES (${id},${sourceId},${hash},${sheet.selection.name},${getSql().json(rows)},${getSql().json(data.errors)},${current?.id ?? null},${projectId ?? null},${scope?.title ?? null},${activityPlan ? getSql().json(activityPlan) : null},${activityInputIds ? getSql().json(activityInputIds) : null})`;
  return {...previewResult(id, hash, current?.rows ?? [], rows, data.errors, scope?.title), activities: activitySummary(activityPlan)};
}
export async function applyResources(id: string, hash: string) {
  enabled();
  return getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(7824031)`;
    const [preview] = await tx`SELECT * FROM resource_import WHERE id=${id} AND content_hash=${hash} FOR UPDATE`;
    if (!preview || preview.errors.length || !preview.rows.length) throw new Error("A prévia está ausente ou contém erros.");
    const [current] = await tx`SELECT import_id::text FROM resource_import_current WHERE singleton`;
    if (preview.applied_at) return { id, reused: true };
    if ((current?.import_id ?? null) !== preview.base_id) throw new Error("A base mudou desde a prévia. Prepare uma nova prévia antes de confirmar.");
    const [prior] = await tx`SELECT rows FROM resource_import WHERE id=${current?.import_id ?? null}`;
    const comparison = compareResources(prior?.rows ?? [], preview.rows);
    const activityPlan = preview.activity_plan as ActivityPlan | null;
    const activityChanges = (activityPlan?.added ?? 0) + (activityPlan?.updated ?? 0);
    if (!comparison.added && !comparison.changed && !comparison.absent && !activityChanges) return { id: current.import_id, reused: true };
    if ((comparison.changed || comparison.absent) && !preview.resolved_from) throw new Error("Confira as diferenças e escolha como tratar os registros antes de aplicar.");
    await tx`UPDATE resource_import SET applied_at=now() WHERE id=${id}`;
    await tx`INSERT INTO resource_import_current(singleton,import_id) VALUES (true,${id}) ON CONFLICT(singleton) DO UPDATE SET import_id=excluded.import_id`;
    if (activityPlan) await tx`SELECT apply_resource_activities(${id})`;
    const activityProjects = activityPlan?.items.filter(item => item.changed).map(item => item.projectId) ?? [];
    const affected = new Set<string>();
    const before = (prior?.rows ?? []) as ResourceRow[];
    const after = preview.rows as ResourceRow[];
    for (const difference of resourceDifferences(before, after)) {
      affected.add(difference.before.project);
      if (difference.after) affected.add(difference.after.project);
    }
    const priorIds = new Set(before.map(row => row.id));
    for (const row of after) if (!priorIds.has(row.id)) affected.add(row.project);
    await tx`UPDATE project_draft SET revision=revision+1,updated_at=now() WHERE project_id IN
      (SELECT id FROM project WHERE coalesce(nullif(resource_source_title,''),title) = ANY(${tx.array([...affected])}::text[]) OR id = ANY(${tx.array(activityProjects)}::text[]))`;
    return { id, reused: false, activities: activitySummary(activityPlan) };
  });
}
export async function resourceHistory() {
  return getSql()<Array<{id:string; sheet_name:string; applied_at:string; count:number}>>`SELECT id::text,sheet_name,applied_at::text,jsonb_array_length(rows) count FROM resource_import WHERE applied_at IS NOT NULL ORDER BY applied_at DESC LIMIT 20`;
}

export async function resolveResources(id: string, hash: string, decisions: ResourceDecisions) {
  enabled();
  const [preview] = await getSql()`SELECT * FROM resource_import WHERE id=${id} AND content_hash=${hash}`;
  if (!preview || preview.errors.length || preview.resolved_from || preview.applied_at) throw new Error("Prepare uma nova prévia para conferir as diferenças.");
  const current = await currentResources();
  if ((current?.id ?? null) !== preview.base_id) throw new Error("A base mudou. Prepare uma nova prévia.");
  const rows = resolveResourceRows(current?.rows ?? [], preview.rows, decisions);
  if (!rows.length) throw new Error("A decisão não pode produzir uma base vazia.");
  const activityPlan = preview.activity_plan ? await prepareResourceActivities(rows.filter(row => preview.activity_input_ids.includes(row.id)), new Map((preview.activity_plan as ActivityPlan).items.map(item => [item.resourceId,item.sourceRow]))) : null;
  const resolvedId = randomUUID();
  const resolvedHash = createHash("sha256").update(JSON.stringify({parent:hash,rows,decisions,activityPlan})).digest("hex");
  await getSql()`INSERT INTO resource_import(id,source_file_id,content_hash,sheet_name,rows,errors,base_id,resolved_from,decisions,scope_project_id,scope_project_title,activity_plan,activity_input_ids)
    VALUES (${resolvedId},${preview.source_file_id},${resolvedHash},${preview.sheet_name},${getSql().json(rows)},'[]',${preview.base_id},${id},${getSql().json(decisions)},${preview.scope_project_id},${preview.scope_project_title},${activityPlan ? getSql().json(activityPlan) : null},${preview.activity_input_ids ? getSql().json(preview.activity_input_ids) : null})`;
  return {...previewResult(resolvedId,resolvedHash,current?.rows ?? [],rows,[],preview.scope_project_title),differences:[],resolved:true,activities:activitySummary(activityPlan)};
}

function activitySummary(plan:ActivityPlan|null){return plan ? {added:plan.added,updated:plan.updated,unchanged:plan.unchanged,adjusted:plan.adjusted,legacy:plan.legacy} : null;}
