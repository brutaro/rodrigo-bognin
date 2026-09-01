import type { DemoPublication } from "./demo-workspace";

function sanitizePublicText(value: string | number | null) {
  const text = String(value ?? "");
  const root = String.raw`(?:file:\/\/)?(?:\/(?:Users|home)\/[^/\s]+\/|\/(?:tmp|private|Volumes|var(?:\/folders|\/tmp)?|opt|srv|mnt)\/|[A-Za-z]:\\|\\\\[^\\\s]+\\)`;
  const withExtension = new RegExp(`${root}[^\\r\\n,;]*?\\.[A-Za-z0-9]{1,10}(?=\\s|[),;]|$)`, "gi");
  const withoutSpaces = new RegExp(`${root}[^\\s<>"]+`, "gi");
  return text
    .replace(withExtension, "[caminho local omitido]")
    .replace(withoutSpaces, "[caminho local omitido]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
function safeCsvCell(value: string | number | null) {
  const oneLine = sanitizePublicText(value).replace(/\r?\n/g, " ");
  const effective = oneLine.replace(/^[\u0000-\u0020\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/, "");
  const protectedValue = /^[=+\-@]/.test(effective) ? `'${oneLine}` : oneLine;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function assertV4(publication: DemoPublication) {
  if (publication.schemaVersion !== "tria-publication-v4" || publication.rendererVersion !== "tria-export-v4") throw new Error("Snapshot incompatível com o renderizador tria-export-v4.");
}
function escapeHtml(value: string | number | null) { return sanitizePublicText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }

export function toPublicPublicationV4(publication: DemoPublication) {
  assertV4(publication);
  return {
    publicationCode: `TRIA-V${publication.version}-${publication.contentHash.slice(0, 12).toUpperCase()}`,
    version: publication.version, contentHash: publication.contentHash,
    schemaVersion: publication.schemaVersion, rendererVersion: publication.rendererVersion,
    dataClassification: publication.dataClassification, title: sanitizePublicText(publication.title),
    period: sanitizePublicText(publication.period), cutoff: structuredClone(publication.cutoff),
    narrative: sanitizePublicText(publication.narrative), publishedAt: publication.createdAt,
    provenance: sanitizePublicText(publication.createdBy),
    activities: publication.activities.map((item, index) => ({
      code: `ATV-${String(index + 1).padStart(3, "0")}`, description: sanitizePublicText(item.description), bm: sanitizePublicText(item.bm),
      hours: sanitizePublicText(item.hours), measuredValue: sanitizePublicText(item.measuredValue),
      sourceHours: sanitizePublicText(item.sourceHours ?? item.hours), sourceMeasuredValue: sanitizePublicText(item.sourceMeasuredValue ?? item.measuredValue),
      revision: item.adjustmentRevision ?? "0", reason: sanitizePublicText(item.adjustmentReason ?? "Sem ajuste"),
      actor: sanitizePublicText(item.adjustedBy ?? "Auditoria importada"), adjustedAt: item.adjustedAt ?? null,
    })),
    financialEntries: publication.financialEntries.map((item, index) => ({
      code: `FIN-${String(index + 1).padStart(3, "0")}`, groupCode: item.financialGroup,
      sourceType: sanitizePublicText(item.sourceType), kind: sanitizePublicText(item.kind), label: sanitizePublicText(item.label),
      amount: sanitizePublicText(item.amount), amountCents: item.amountCents,
      relatedAmount: item.relatedAmount ? sanitizePublicText(item.relatedAmount) : null,
      relatedAmountCents: item.relatedAmountCents, fullValueEligible: item.fullValueEligible,
      relationBasis: sanitizePublicText(item.relationBasis), currency: item.currency,
      origin: sanitizePublicText(item.origin), relation: sanitizePublicText(item.relation), payment: sanitizePublicText(item.payment),
      documentState: sanitizePublicText(item.documentState),
      provenance: item.provenance ? {
        sourceAmount: sanitizePublicText(item.provenance.sourceAmount), revision: item.provenance.revision, operation: item.provenance.operation,
        reason: sanitizePublicText(item.provenance.reason ?? "Sem ajuste"), actor: sanitizePublicText(item.provenance.actor ?? "Auditoria importada"),
        adjustedAt: item.provenance.adjustedAt,
      } : null,
    })),
    evidence: publication.evidence.map((item, index) => ({ code: `EVD-${String(index + 1).padStart(3, "0")}`,
      name: sanitizePublicText(item.name), kind: sanitizePublicText(item.kind), availability: sanitizePublicText(item.availability),
      packageState: "Somente metadados; bytes permanecem no cofre autenticado" })),
    files: (publication.files ?? []).map((item, index) => ({ code: `ARQ-${String(index + 1).padStart(3, "0")}`,
      documentId: item.documentId, versionId: item.versionId, title: sanitizePublicText(item.title), version: item.version,
      originalName: sanitizePublicText(item.originalName), mediaType: sanitizePublicText(item.mediaType), sizeBytes: item.sizeBytes, sha256: item.sha256 })),
  };
}

export function buildPublicationCsvV4(publication: DemoPublication) {
  const view = toPublicPublicationV4(publication);
  const rows: Array<Array<string | number | null>> = [["publication_code", "section", "record_code", "group_code", "title", "effective_value", "source_value", "revision", "actor", "reason", "status"],
    [view.publicationCode, "publication", view.publicationCode, null, view.title, `Versão ${view.version}`, null, null, view.provenance, null, view.schemaVersion],
    ...view.activities.map((item) => [view.publicationCode, "activity", item.code, "project_measurement", item.description, `${item.hours} · ${item.measuredValue}`, `${item.sourceHours} · ${item.sourceMeasuredValue}`, item.revision, item.actor, item.reason, item.bm]),
    ...view.financialEntries.map((item) => [view.publicationCode, "financial", item.code, item.groupCode, item.label, item.amount, item.provenance?.sourceAmount ?? item.amount, item.provenance?.revision ?? "0", item.provenance?.actor ?? "Auditoria importada", item.provenance?.reason ?? "Sem ajuste", `${item.relationBasis} · ${item.relation} · ${item.payment}`]),
    ...view.evidence.map((item) => [view.publicationCode, "evidence_metadata", item.code, null, item.name, item.availability, null, null, null, null, item.packageState]),
    ...view.files.map((item) => [view.publicationCode, "file_metadata", item.code, null, sanitizePublicText(item.title), sanitizePublicText(item.originalName), null, String(item.version), null, null, `SHA-256 ${item.sha256}`]),
  ];
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(";")).join("\r\n")}\r\n`;
}

export function buildPublicationHtmlV4(publication: DemoPublication) {
  const view = toPublicPublicationV4(publication);
  const activities = view.activities.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.bm)}</td><td>${escapeHtml(item.sourceHours)}</td><td>${escapeHtml(item.hours)}</td><td>${escapeHtml(item.sourceMeasuredValue)}</td><td>${escapeHtml(item.measuredValue)}</td><td>R${escapeHtml(item.revision)} · ${escapeHtml(item.actor)} · ${escapeHtml(item.reason)}</td></tr>`).join("");
  const finance = view.financialEntries.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.groupCode)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.provenance?.sourceAmount ?? item.amount)}</td><td>${escapeHtml(item.amount)}</td><td>${escapeHtml(item.relatedAmount ?? "Não informado")}</td><td>${escapeHtml(item.relationBasis)}</td><td>${escapeHtml(item.relation)}</td><td>R${escapeHtml(item.provenance?.revision ?? "0")} · ${escapeHtml(item.provenance?.actor ?? "Auditoria importada")} · ${escapeHtml(item.provenance?.reason ?? "Sem ajuste")}</td></tr>`).join("");
  const evidence = view.evidence.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.availability)}</td><td>${escapeHtml(item.packageState)}</td></tr>`).join("");
  const files = view.files.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.title)}</td><td>V${escapeHtml(item.version)}</td><td>${escapeHtml(item.originalName)}</td><td>${escapeHtml(item.sizeBytes)}</td><td><code>${escapeHtml(item.sha256)}</code></td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"><title>${escapeHtml(view.title)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#172033;margin:32px}h1{font-size:28px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border:1px solid #d9e0e8;text-align:left;vertical-align:top}.notice{padding:12px;background:#fff8e7;border:1px solid #e4c16a}code{overflow-wrap:anywhere}</style></head><body><p>TRIA · Publicação efetiva V4</p><h1>${escapeHtml(view.title)}</h1><p>${escapeHtml(view.period)} · ${escapeHtml(view.publicationCode)}</p><div class="notice">Medição, faturamento, relação financeira e pagamento são universos distintos e não foram somados entre si.</div><h2>Narrativa</h2><p>${escapeHtml(view.narrative)}</p><h2>Atividades: auditoria importada e efetivo</h2><table><thead><tr><th>Código</th><th>Atividade</th><th>BM</th><th>Horas originais</th><th>Horas efetivas</th><th>Medição original</th><th>Medição efetiva</th><th>Proveniência</th></tr></thead><tbody>${activities || '<tr><td colspan="8">Nenhuma atividade.</td></tr>'}</tbody></table><h2>Universos financeiros separados</h2><table><thead><tr><th>Código</th><th>Universo</th><th>Registro</th><th>Valor original</th><th>Valor efetivo</th><th>Valor relacionado</th><th>Base</th><th>Relação</th><th>Proveniência</th></tr></thead><tbody>${finance || '<tr><td colspan="9">Nenhum registro.</td></tr>'}</tbody></table><h2>Registros de evidência</h2><p>Somente metadados; nenhum upload foi renderizado.</p><table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Situação</th><th>Inclusão</th></tr></thead><tbody>${evidence || '<tr><td colspan="5">Nenhuma evidência.</td></tr>'}</tbody></table><h2>Arquivos vinculados</h2><p>Somente metadados; bytes permanecem no cofre autenticado.</p><table><thead><tr><th>Código</th><th>Título</th><th>Versão</th><th>Nome original</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>${files || '<tr><td colspan="6">Nenhum arquivo.</td></tr>'}</tbody></table><footer><p><strong>Hash de conteúdo:</strong> <code>${escapeHtml(view.contentHash)}</code></p><p><strong>Renderizador:</strong> ${escapeHtml(view.rendererVersion)}</p></footer></body></html>`;
}
