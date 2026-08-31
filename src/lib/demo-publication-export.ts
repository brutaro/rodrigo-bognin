import type { DemoPublication } from "./demo-workspace";

export type PublicPublicationV1 = {
  publicationCode: string;
  version: number;
  contentHash: string;
  schemaVersion: "tria-publication-v1";
  rendererVersion: "tria-export-v1";
  title: string;
  period: string;
  cutoff: DemoPublication["cutoff"];
  narrative: string;
  publishedAt: string;
  provenance: string;
  activities: Array<{
    code: string;
    description: string;
    bm: string;
    hours: string;
    measuredValue: string;
  }>;
  financialEntries: Array<{
    code: string;
    groupCode: string;
    sourceType: string;
    kind: string;
    label: string;
    amount: string;
    amountCents: string | null;
    currency: "BRL";
    origin: string;
    relation: string;
    payment: string;
    documentState: string;
  }>;
  evidence: Array<{
    code: string;
    name: string;
    kind: string;
    availability: string;
    packageState: "Somente metadado demonstrativo; arquivo não anexado";
  }>;
};

function sanitizePublicText(value: string | number | null) {
  return String(value ?? "")
    .replace(/(?:\/Users\/|[A-Za-z]:\\Users\\)[^\s<>"']+/gi, "[caminho local omitido]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeHtml(value: string | number | null) {
  return sanitizePublicText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeCsvCell(value: string | number | null) {
  const oneLine = sanitizePublicText(value).replace(/\r?\n/g, " ");
  const effective = oneLine.replace(/^[\u0000-\u0020\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/, "");
  const protectedValue = /^[=+\-@]/.test(effective) ? `'${oneLine}` : oneLine;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function toPublicPublicationV1(publication: DemoPublication): PublicPublicationV1 {
  const publicationCode = `TRIA-V${publication.version}-${publication.contentHash.slice(0, 12).toUpperCase()}`;
  return {
    publicationCode,
    version: publication.version,
    contentHash: publication.contentHash,
    schemaVersion: publication.schemaVersion,
    rendererVersion: publication.rendererVersion,
    title: sanitizePublicText(publication.title),
    period: sanitizePublicText(publication.period),
    cutoff: structuredClone(publication.cutoff),
    narrative: sanitizePublicText(publication.narrative),
    publishedAt: publication.createdAt,
    provenance: sanitizePublicText(publication.createdBy),
    activities: publication.activities.map((activity, index) => ({
      code: `ATV-${String(index + 1).padStart(3, "0")}`,
      description: sanitizePublicText(activity.description),
      bm: sanitizePublicText(activity.bm),
      hours: sanitizePublicText(activity.hours),
      measuredValue: sanitizePublicText(activity.measuredValue),
    })),
    financialEntries: publication.financialEntries.map((entry, index) => ({
      code: `FIN-${String(index + 1).padStart(3, "0")}`,
      groupCode: entry.financialGroup,
      sourceType: sanitizePublicText(entry.sourceType),
      kind: sanitizePublicText(entry.kind),
      label: sanitizePublicText(entry.label),
      amount: sanitizePublicText(entry.amount),
      amountCents: entry.amountCents,
      currency: entry.currency,
      origin: sanitizePublicText(entry.origin),
      relation: sanitizePublicText(entry.relation),
      payment: sanitizePublicText(entry.payment),
      documentState: sanitizePublicText(entry.documentState),
    })),
    evidence: publication.evidence.map((item, index) => ({
      code: `EVD-${String(index + 1).padStart(3, "0")}`,
      name: sanitizePublicText(item.name),
      kind: sanitizePublicText(item.kind),
      availability: sanitizePublicText(item.availability),
      packageState: "Somente metadado demonstrativo; arquivo não anexado",
    })),
  };
}

export function buildPublicationCsv(publication: DemoPublication) {
  const view = toPublicPublicationV1(publication);
  const rows: Array<Array<string | number | null>> = [
    ["publication_code", "section", "record_code", "group_code", "title", "type", "amount_cents", "currency", "display_amount", "origin", "relation", "payment", "status"],
    [view.publicationCode, "publication", view.publicationCode, null, view.title, `Versão ${view.version}`, null, null, null, view.provenance, null, null, view.schemaVersion],
    [view.publicationCode, "cutoff", "CUT-001", null, `De ${view.cutoff.startDate} até ${view.cutoff.endDate}`, view.cutoff.basis, null, null, null, view.cutoff.timeZone, null, null, view.cutoff.endInclusive ? "Limite final incluído" : "Limite final excluído"],
    [view.publicationCode, "narrative", "NAR-001", null, view.narrative, null, null, null, null, view.provenance, null, null, "Publicada"],
    ...view.activities.map((activity) => [
      view.publicationCode,
      "activity",
      activity.code,
      "project_measurement",
      activity.description,
      activity.bm,
      null,
      "BRL",
      activity.measuredValue,
      "Base demonstrativa importada",
      null,
      null,
      `${activity.hours} horas`,
    ]),
    ...view.financialEntries.map((entry) => [
      view.publicationCode,
      "financial",
      entry.code,
      entry.groupCode,
      entry.label,
      `${entry.sourceType} · ${entry.kind}`,
      entry.amountCents,
      entry.currency,
      entry.amount,
      entry.origin,
      entry.relation,
      entry.payment,
      entry.documentState,
    ]),
    ...view.evidence.map((evidence) => [
      view.publicationCode,
      "evidence_metadata",
      evidence.code,
      null,
      evidence.name,
      evidence.kind,
      null,
      null,
      null,
      "Base demonstrativa importada",
      null,
      null,
      `${evidence.availability} · ${evidence.packageState}`,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(";")).join("\r\n")}\r\n`;
}

export function buildPublicationHtml(publication: DemoPublication) {
  const view = toPublicPublicationV1(publication);
  const activities = view.activities.map((activity) => `
    <tr><td>${escapeHtml(activity.code)}</td><td>${escapeHtml(activity.description)}</td><td>${escapeHtml(activity.bm)}</td><td>${escapeHtml(activity.hours)}</td><td>${escapeHtml(activity.measuredValue)}</td></tr>`).join("");
  const financial = view.financialEntries.map((entry) => `
    <tr><td>${escapeHtml(entry.code)}</td><td>${escapeHtml(entry.groupCode)}</td><td>${escapeHtml(entry.sourceType)}</td><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(entry.amount)}</td><td>${escapeHtml(entry.origin)}</td><td>${escapeHtml(entry.relation)}</td><td>${escapeHtml(entry.payment)}</td><td>${escapeHtml(entry.documentState)}</td></tr>`).join("");
  const evidence = view.evidence.map((item) => `
    <tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.availability)}</td><td>${escapeHtml(item.packageState)}</td></tr>`).join("");
  const publishedAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(view.publishedAt));

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(view.title)} — Publicação V${view.version}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#596273;--line:#d9dee8;--brand:#245799;--paper:#fff;--soft:#f4f7fb;--warn:#fff7dc}*{box-sizing:border-box}body{margin:0;background:#edf1f7;color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:0 auto;padding:40px 28px 64px}.masthead{border-bottom:4px solid var(--brand);padding-bottom:24px}.eyebrow{color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:34px;line-height:1.15;margin:8px 0 12px}h2{font-size:21px;margin:0 0 14px}p{margin:0 0 12px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:24px}.meta div,.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}.meta dt{color:var(--muted);font-size:12px;text-transform:uppercase}.meta dd{margin:4px 0 0;font-weight:700}.notice{background:var(--warn);border:1px solid #ead58c;border-radius:10px;margin:22px 0;padding:14px}.card{margin-top:20px}.narrative{white-space:pre-wrap;font-size:17px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{background:var(--soft);font-size:11px;letter-spacing:.04em;text-transform:uppercase}.table-wrap{overflow-x:auto}.hash{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.empty{color:var(--muted)}footer{color:var(--muted);font-size:12px;margin-top:28px}@media print{body{background:#fff}main{max-width:none;padding:0}.card,.meta div{break-inside:avoid}a{color:inherit;text-decoration:none}}
</style>
</head>
<body>
<main>
<header class="masthead"><p class="eyebrow">TRIA · Prestação de contas · Dados fictícios</p><h1>${escapeHtml(view.title)}</h1><p>Publicação imutável V${view.version} · ${escapeHtml(view.period)}</p></header>
<div class="notice"><strong>Ambiente demonstrativo.</strong> Nenhum dado real foi incluído. Custos, notas, referências, valores informados e pagamentos permanecem conceitos distintos.</div>
<dl class="meta"><div><dt>Publicada em</dt><dd>${escapeHtml(publishedAt)}</dd></div><div><dt>Proveniência</dt><dd>${escapeHtml(view.provenance)}</dd></div><div><dt>Código público</dt><dd>${escapeHtml(view.publicationCode)}</dd></div><div><dt>Corte</dt><dd>${escapeHtml(view.cutoff.startDate)} a ${escapeHtml(view.cutoff.endDate)}, limite incluído</dd></div></dl>
<section class="card"><h2>O que foi feito</h2><p class="narrative">${escapeHtml(view.narrative)}</p></section>
<section class="card"><h2>Atividades e medições</h2><p>Valores medidos não comprovam faturamento ou pagamento.</p><div class="table-wrap"><table><thead><tr><th>Código</th><th>Atividade</th><th>BM</th><th>Horas</th><th>Medido</th></tr></thead><tbody>${activities || '<tr><td colspan="5" class="empty">Nenhuma atividade.</td></tr>'}</tbody></table></div></section>
<section class="card"><h2>Referências financeiras</h2><p>Não há soma automática entre grupos financeiros.</p><div class="table-wrap"><table><thead><tr><th>Código</th><th>Grupo</th><th>Registro</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Origem</th><th>Relação</th><th>Pagamento</th><th>Arquivo</th></tr></thead><tbody>${financial || '<tr><td colspan="10" class="empty">Nenhuma referência financeira.</td></tr>'}</tbody></table></div></section>
<section class="card"><h2>Registros de evidência</h2><p>Nenhum byte de arquivo faz parte desta demonstração. A tabela preserva somente metadados fictícios.</p><div class="table-wrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Situação informada</th><th>Inclusão</th></tr></thead><tbody>${evidence || '<tr><td colspan="5" class="empty">Nenhuma evidência.</td></tr>'}</tbody></table></div></section>
<footer><p>Hash do conteúdo: <span class="hash">${escapeHtml(view.contentHash)}</span></p><p>Esquema ${escapeHtml(view.schemaVersion)} · Renderizador ${escapeHtml(view.rendererVersion)} · HTML autônomo.</p></footer>
</main>
</body>
</html>`;
}
