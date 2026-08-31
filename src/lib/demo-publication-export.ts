import type { DemoPublication } from "./demo-workspace";
import { buildPublicationCsv as buildPublicationCsvV1, buildPublicationHtml as buildPublicationHtmlV1, toPublicPublicationV1 } from "./demo-publication-export-v1";

export type PublicPublicationV2 = {
  publicationCode: string;
  version: number;
  contentHash: string;
  schemaVersion: "tria-publication-v2";
  rendererVersion: "tria-export-v2";
  dataClassification: DemoPublication["dataClassification"];
  title: string;
  period: string;
  cutoff: DemoPublication["cutoff"];
  narrative: string;
  publishedAt: string;
  provenance: string;
  activities: Array<{ code: string; description: string; bm: string; hours: string; measuredValue: string }>;
  financialEntries: Array<{
    code: string; groupCode: string; sourceType: string; kind: string; label: string;
    amount: string; amountCents: string | null; relatedAmount: string | null;
    relatedAmountCents: string | null; fullValueEligible: boolean | null; relationBasis: string;
    currency: "BRL"; origin: string; relation: string; payment: string; documentState: string;
  }>;
  evidence: Array<{ code: string; name: string; kind: string; availability: string; packageState: string }>;
};

export function sanitizePublicText(value: string | number | null) {
  const text = String(value ?? "");
  const root = String.raw`(?:file:\/\/)?(?:\/(?:Users|home)\/[^/\s]+\/|\/(?:tmp|private|Volumes|var(?:\/folders|\/tmp)?|opt|srv|mnt)\/|[A-Za-z]:\\|\\\\[^\\\s]+\\)`;
  const withExtension = new RegExp(`${root}[^\\r\\n,;]*?\\.[A-Za-z0-9]{1,10}(?=\\s|[),;]|$)`, "gi");
  const withoutSpaces = new RegExp(`${root}[^\\s<>"]+`, "gi");
  return text
    .replace(withExtension, "[caminho local omitido]")
    .replace(withoutSpaces, "[caminho local omitido]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeHtml(value: string | number | null) {
  return sanitizePublicText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function safeCsvCell(value: string | number | null) {
  const oneLine = sanitizePublicText(value).replace(/\r?\n/g, " ");
  const effective = oneLine.replace(/^[\u0000-\u0020\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/, "");
  const protectedValue = /^[=+\-@]/.test(effective) ? `'${oneLine}` : oneLine;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function toPublicPublicationV2(publication: DemoPublication): PublicPublicationV2 {
  if (publication.schemaVersion !== "tria-publication-v2" || publication.rendererVersion !== "tria-export-v2") {
    throw new Error("Snapshot incompatível com o renderizador tria-export-v2.");
  }
  const real = publication.dataClassification === "Dados privados locais";
  return {
    publicationCode: `TRIA-V${publication.version}-${publication.contentHash.slice(0, 12).toUpperCase()}`,
    version: publication.version,
    contentHash: publication.contentHash,
    schemaVersion: publication.schemaVersion,
    rendererVersion: publication.rendererVersion,
    dataClassification: publication.dataClassification,
    title: sanitizePublicText(publication.title), period: sanitizePublicText(publication.period),
    cutoff: structuredClone(publication.cutoff), narrative: sanitizePublicText(publication.narrative),
    publishedAt: publication.createdAt, provenance: sanitizePublicText(publication.createdBy),
    activities: publication.activities.map((activity, index) => ({
      code: `ATV-${String(index + 1).padStart(3, "0")}`, description: sanitizePublicText(activity.description),
      bm: sanitizePublicText(activity.bm), hours: sanitizePublicText(activity.hours), measuredValue: sanitizePublicText(activity.measuredValue),
    })),
    financialEntries: publication.financialEntries.map((entry, index) => ({
      code: `FIN-${String(index + 1).padStart(3, "0")}`, groupCode: entry.financialGroup,
      sourceType: sanitizePublicText(entry.sourceType), kind: sanitizePublicText(entry.kind), label: sanitizePublicText(entry.label),
      amount: sanitizePublicText(entry.amount), amountCents: entry.amountCents,
      relatedAmount: entry.relatedAmount ? sanitizePublicText(entry.relatedAmount) : null,
      relatedAmountCents: entry.relatedAmountCents ?? null, fullValueEligible: entry.fullValueEligible ?? null,
      relationBasis: sanitizePublicText(entry.relationBasis ?? "Não informada"), currency: entry.currency,
      origin: sanitizePublicText(entry.origin), relation: sanitizePublicText(entry.relation), payment: sanitizePublicText(entry.payment),
      documentState: sanitizePublicText(entry.documentState),
    })),
    evidence: publication.evidence.map((item, index) => ({
      code: `EVD-${String(index + 1).padStart(3, "0")}`, name: sanitizePublicText(item.name), kind: sanitizePublicText(item.kind),
      availability: sanitizePublicText(item.availability),
      packageState: real ? "Somente metadado local permitido; arquivo não anexado" : "Somente metadado demonstrativo; arquivo não anexado",
    })),
  };
}

export function toPublicPublication(publication: DemoPublication) {
  return publication.rendererVersion === "tria-export-v1"
    ? toPublicPublicationV1(publication)
    : toPublicPublicationV2(publication);
}

function buildPublicationCsvV2(publication: DemoPublication) {
  const view = toPublicPublicationV2(publication);
  const origin = view.dataClassification === "Dados privados locais" ? "Base local importada" : "Base demonstrativa importada";
  const rows: Array<Array<string | number | null>> = [
    ["publication_code", "section", "record_code", "group_code", "title", "type", "amount_cents", "currency", "display_amount", "related_amount_cents", "related_display_amount", "full_value_eligible", "relation_basis", "origin", "relation", "payment", "status"],
    [view.publicationCode, "publication", view.publicationCode, null, view.title, `Versão ${view.version}`, null, null, null, null, null, null, null, view.provenance, null, null, `${view.schemaVersion} · ${view.dataClassification}`],
    [view.publicationCode, "cutoff", "CUT-001", null, `De ${view.cutoff.startDate} até ${view.cutoff.endDate}`, view.cutoff.basis, null, null, null, null, null, null, null, view.cutoff.timeZone, null, null, view.cutoff.endInclusive ? "Limite final incluído" : "Limite final excluído"],
    [view.publicationCode, "narrative", "NAR-001", null, view.narrative, null, null, null, null, null, null, null, null, view.provenance, null, null, "Publicada"],
    ...view.activities.map((activity) => [view.publicationCode, "activity", activity.code, "project_measurement", activity.description, activity.bm, null, "BRL", activity.measuredValue, null, null, null, null, origin, null, null, `${activity.hours} horas`]),
    ...view.financialEntries.map((entry) => [view.publicationCode, "financial", entry.code, entry.groupCode, entry.label, `${entry.sourceType} · ${entry.kind}`, entry.amountCents, entry.currency, entry.amount, entry.relatedAmountCents, entry.relatedAmount, entry.fullValueEligible === null ? null : entry.fullValueEligible ? "Sim" : "Não", entry.relationBasis, entry.origin, entry.relation, entry.payment, entry.documentState]),
    ...view.evidence.map((item) => [view.publicationCode, "evidence_metadata", item.code, null, item.name, item.kind, null, null, null, null, null, null, null, origin, null, null, `${item.availability} · ${item.packageState}`]),
  ];
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(";")).join("\r\n")}\r\n`;
}

function buildPublicationHtmlV2(publication: DemoPublication) {
  const view = toPublicPublicationV2(publication);
  const activities = view.activities.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.bm)}</td><td>${escapeHtml(item.hours)}</td><td>${escapeHtml(item.measuredValue)}</td></tr>`).join("");
  const financial = view.financialEntries.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.groupCode)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.amount)}</td><td>${escapeHtml(item.relatedAmount ?? "Não informado")}</td><td>${escapeHtml(item.fullValueEligible === null ? "Não avaliado" : item.fullValueEligible ? "Sim" : "Não")}</td><td>${escapeHtml(item.relationBasis)}</td><td>${escapeHtml(item.relation)}</td><td>${escapeHtml(item.payment)}</td></tr>`).join("");
  const evidence = view.evidence.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.availability)}</td><td>${escapeHtml(item.packageState)}</td></tr>`).join("");
  const publishedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(view.publishedAt));
  const dataNotice = view.dataClassification === "Dados fictícios" ? "Nenhum dado real foi incluído." : "Dados privados locais. Este arquivo deve permanecer sob controle de Rodrigo.";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"><title>${escapeHtml(view.title)} — ${escapeHtml(view.publicationCode)}</title><style>:root{color-scheme:light;--ink:#172033;--muted:#5f6b7a;--line:#d9e0e8;--brand:#164b8f;--soft:#f4f7fa}*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:var(--ink);font:15px/1.55 Arial,sans-serif}.page{max-width:1180px;margin:0 auto;background:#fff;min-height:100vh;padding:36px}.eyebrow{color:var(--brand);font-size:12px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}h1{font-size:30px;line-height:1.15;margin:8px 0}h2{font-size:19px;margin:0 0 12px}.muted{color:var(--muted)}.notice{margin:20px 0;padding:14px 16px;border:1px solid #f0cc76;background:#fff8e7;border-radius:10px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric,.card{border:1px solid var(--line);border-radius:12px;padding:16px}.card{margin-top:18px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--soft)}code{overflow-wrap:anywhere}.footer{margin-top:24px;border-top:1px solid var(--line);padding-top:16px;font-size:12px;color:var(--muted)}@media(max-width:760px){.page{padding:20px}.grid{grid-template-columns:1fr}h1{font-size:25px}}</style></head><body><main class="page"><p class="eyebrow">TRIA · Prestação de contas · ${escapeHtml(view.dataClassification)}</p><h1>${escapeHtml(view.title)}</h1><p class="muted">${escapeHtml(view.period)} · Publicado em ${escapeHtml(publishedAt)}</p><div class="notice"><strong>${escapeHtml(view.dataClassification)}.</strong> ${escapeHtml(dataNotice)} Custos, notas, relações, valores informados e pagamentos permanecem conceitos distintos.</div><section class="grid"><div class="metric"><span class="muted">Versão</span><strong>V${escapeHtml(view.version)}</strong></div><div class="metric"><span class="muted">Atividades</span><strong>${escapeHtml(view.activities.length)}</strong></div><div class="metric"><span class="muted">Evidências</span><strong>${escapeHtml(view.evidence.length)}</strong></div></section><section class="card"><h2>Narrativa</h2><p>${escapeHtml(view.narrative)}</p></section><section class="card"><h2>Atividades e medições</h2><div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>BM</th><th>Horas</th><th>Medido</th></tr></thead><tbody>${activities || '<tr><td colspan="5">Nenhuma atividade.</td></tr>'}</tbody></table></div></section><section class="card"><h2>Referências financeiras</h2><div class="table-wrap"><table><thead><tr><th>Código</th><th>Grupo</th><th>Tipo</th><th>Descrição</th><th>Valor bruto</th><th>Valor relacionado</th><th>Integral elegível</th><th>Base</th><th>Relação</th><th>Pagamento</th></tr></thead><tbody>${financial || '<tr><td colspan="10">Nenhuma referência financeira.</td></tr>'}</tbody></table></div></section><section class="card"><h2>Registros de evidência</h2><p>Nenhum byte de arquivo foi incluído. A tabela preserva somente metadados permitidos.</p><div class="table-wrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Situação</th><th>Inclusão</th></tr></thead><tbody>${evidence || '<tr><td colspan="5">Nenhuma evidência.</td></tr>'}</tbody></table></div></section><footer class="footer"><p><strong>Código:</strong> ${escapeHtml(view.publicationCode)}</p><p><strong>Hash de conteúdo:</strong> <code>${escapeHtml(view.contentHash)}</code></p><p><strong>Renderizador:</strong> ${escapeHtml(view.rendererVersion)}</p><p><strong>Corte:</strong> ${escapeHtml(view.cutoff.startDate)} a ${escapeHtml(view.cutoff.endDate)}, limite final incluído, ${escapeHtml(view.cutoff.timeZone)}.</p></footer></main></body></html>`;
}

export function buildPublicationCsv(publication: DemoPublication) {
  return publication.rendererVersion === "tria-export-v1" ? buildPublicationCsvV1(publication) : buildPublicationCsvV2(publication);
}

export function buildPublicationHtml(publication: DemoPublication) {
  return publication.rendererVersion === "tria-export-v1" ? buildPublicationHtmlV1(publication) : buildPublicationHtmlV2(publication);
}
