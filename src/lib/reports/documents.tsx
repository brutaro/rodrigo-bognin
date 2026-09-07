import { cashMetrics, type CashResult } from "../cash-domain";
import "server-only";

import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ChartDatum, GlobalReportModel, ProjectReportModel } from "./types";
import { chartBarWidth, ReportLimitExceededError } from "./limits";

Font.register({ family: "Noto Sans", fonts: [
  { src: path.join(process.cwd(), "public/report-fonts/noto-sans-latin-400-normal.woff"), fontWeight: 400 },
  { src: path.join(process.cwd(), "public/report-fonts/noto-sans-latin-700-normal.woff"), fontWeight: 700 },
] });
Font.registerHyphenationCallback((word) => word.length > 24 ? word.match(/.{1,16}/g) ?? [word] : [word]);

const s = StyleSheet.create({
  page: { fontFamily: "Noto Sans", fontSize: 8, color: "#172033", paddingTop: 42, paddingBottom: 42, paddingHorizontal: 34 },
  header: { position: "absolute", top: 18, left: 34, right: 34, fontSize: 7, color: "#174D3B", borderBottomWidth: 0.5, borderBottomColor: "#cbd5e1", paddingBottom: 5 },
  footer: { position: "absolute", bottom: 17, left: 34, right: 34, fontSize: 6.5, color: "#64748b", flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#cbd5e1", paddingTop: 5 },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 5 }, h2: { fontSize: 12, fontWeight: 700, color: "#174D3B", marginTop: 14, marginBottom: 6 },
  h3: { fontSize: 9, fontWeight: 700, marginTop: 8, marginBottom: 4 }, body: { lineHeight: 1.45 }, muted: { color: "#64748b" },
  notice: { backgroundColor: "#fff8e7", borderWidth: 0.5, borderColor: "#e4c16a", padding: 7, marginVertical: 8, lineHeight: 1.45 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, metric: { width: "31%", borderWidth: 0.5, borderColor: "#cbd5e1", padding: 6 },
  table: { borderWidth: 0.5, borderColor: "#cbd5e1", marginBottom: 5 }, row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  head: { backgroundColor: "#F5F5EF", fontWeight: 700 }, cell: { flexGrow: 1, flexBasis: 0, padding: 4, lineHeight: 1.35 },
  chartRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 }, chartLabel: { width: 80, fontSize: 7 }, chartTrack: { flexGrow: 1, height: 8, backgroundColor: "#e2e8f0" }, chartBar: { height: 8, backgroundColor: "#CB5C2B" }, chartValue: { width: 60, textAlign: "right", fontSize: 7 },
  history: { borderLeftWidth: 2, borderLeftColor: "#CB5C2B", paddingLeft: 7, marginBottom: 7 }, hash: { fontSize: 6, color: "#475569" },
});

function Header({ title }: { title: string }) { return <Text fixed style={s.header}>TRIA · Relatório gerencial privado · {title}</Text>; }
function Footer({ code, hash }: { code: string; hash: string }) { return <View fixed style={s.footer}><Text>{code} · Modelo {hash}</Text><Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} /></View>; }
function tableChunks(rows: string[][]) {
  const source = rows.length ? rows : [["Nenhum registro."]]; const chunks: string[][][] = []; let chunk: string[][] = []; let lineBudget = 1;
  for (const row of source) {
    const rowLines = Math.max(1, ...row.map((cell) => cell.split("\n").reduce((total, part) => total + Math.max(1, Math.ceil(part.length / 42)), 0)));
    if (rowLines > 22) throw new ReportLimitExceededError("Uma linha do relatório é maior que a página.");
    if (chunk.length && lineBudget + rowLines > 22) { chunks.push(chunk); chunk = []; lineBudget = 1; }
    chunk.push(row); lineBudget += rowLines;
  }
  if (chunk.length) chunks.push(chunk); return chunks;
}
function Table({ headers, rows, widths, title }: { headers: string[]; rows: string[][]; widths?: number[]; title?: string }) {
  return <>{tableChunks(rows).map((chunk, chunkIndex) => <View key={chunkIndex}>
    {title && chunkIndex === 0 ? <Text style={s.h2}>{title}</Text> : null}
    <View style={s.table}>
      <View style={[s.row, s.head]} wrap={false}>{headers.map((header, index) => <Text key={header} style={[s.cell, widths ? { flexGrow: widths[index], flexBasis: 0 } : {}]}>{header}</Text>)}</View>
      {chunk.map((row, rowIndex) => <View key={`${rowIndex}-${row[0]}`} style={s.row} wrap={false}>{row.map((cell, index) => <Text key={index} style={[s.cell, widths ? { flexGrow: widths[index], flexBasis: 0 } : {}]}>{cell}</Text>)}</View>)}
    </View>
  </View>)}</>;
}
function chartChunks(data: ChartDatum[], size = 14) {
  if (!data.length) return [[]] as ChartDatum[][];
  return Array.from({ length: Math.ceil(data.length / size) }, (_, index) => data.slice(index * size, (index + 1) * size));
}
function ChartWithTable({ title, data }: { title: string; data: ChartDatum[] }) {
  const maximum = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  return <>{chartChunks(data).map((chunk, chunkIndex) => <View key={`${title}-${chunkIndex}`} wrap={false} minPresenceAhead={180}>
    <Text style={s.h2}>{title}{chunkIndex ? " — continuação" : ""}</Text>
    <View aria-label={`Gráfico: ${title}`}>{chunk.length ? chunk.map((item) => <View key={item.label} style={s.chartRow} wrap={false}><Text style={s.chartLabel}>{item.label}</Text><View style={s.chartTrack}><View style={[s.chartBar, { width: chartBarWidth(item.value, maximum) }]} /></View><Text style={s.chartValue}>{item.displayValue}</Text></View>) : <Text style={s.muted}>Nenhum dado disponível.</Text>}</View>
    <Text style={s.h3}>Tabela equivalente ao gráfico</Text>
    <Table headers={["Categoria", "Valor"]} rows={chunk.map((item) => [item.label, item.displayValue])} widths={[2, 1]} />
  </View>)}</>;
}
function readableDateTime(value: string) {
  const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(parsed);
}
function Intro({ code, generatedAt, hash }: { code: string; generatedAt: string; hash: string }) { return <View wrap={false}><Text style={s.muted}>Gerado em {readableDateTime(generatedAt)}</Text><Text style={s.hash}>Código {code}</Text><Text style={s.hash}>Hash do modelo {hash}</Text></View>; }

function CashReport({result,scope}:{result:CashResult;scope:string}) {
  return <><Text style={s.h2}>Resultado financeiro — caixa · {scope}</Text>
    <Text style={s.muted}>Regra {result.formulaVersion}{result.review ? ` · corte ${result.review.cutoffDate} · conferência R${result.review.revision} por ${result.review.actor}` : ''}</Text>
    {result.issues.map(issue=><Text style={s.notice} key={issue}>{issue}</Text>)}
    <Table headers={["Indicador","Valor","Regra"]} rows={cashMetrics(result).map(m=>[m.name,m.value,m.explanation])} widths={[1.3,1,2.2]} />
  </>;
}

export function ProjectReportDocument({ model }: { model: ProjectReportModel }) {
  return <Document title={`Relatório gerencial — ${model.project.title}`} author="TRIA" subject="Relatório privado com valores efetivos e auditoria">
    <Page size="A4" style={s.page} wrap><Header title={model.project.title} /><Footer code={model.meta.code} hash={model.meta.modelHash} />
      <Text style={s.h1}>{model.project.title}</Text><Text style={s.muted}>{model.project.period}</Text><Intro code={model.meta.code} generatedAt={model.meta.generatedAt} hash={model.meta.modelHash} />
      <View style={s.notice}><Text>Medição, NFS-e, relação auditada, valores informados e pagamentos são universos distintos. Eles não são somados entre si.</Text></View>
      <Text style={s.h2}>Resumo</Text><Text style={s.body}>{model.project.narrative || "Narrativa não informada."}</Text>
      {model.cash && <CashReport result={model.cash} scope="Projeto inteiro" />}
      <View style={s.metrics}>{model.financialUniverses.map((item) => <View key={item.name} style={s.metric} wrap={false}><Text style={{ fontWeight: 700 }}>{item.name}</Text><Text>{item.value}</Text><Text style={s.muted}>{item.explanation}</Text></View>)}</View>
      {Boolean(model.financialDocuments?.length) && <><Text style={s.h2}>Lançamentos e comprovantes</Text><Text style={s.muted}>Arquivo associado pelo proprietário; o vínculo não valida automaticamente o pagamento.</Text><Table headers={["Tipo", "Lançamento", "Valor", "Comprovante"]} rows={model.financialDocuments!.map(item=>[item.kind,item.description,item.amount,item.document])} widths={[1,2,1,2]} /></>}
      <ChartWithTable title="Horas efetivas por BM" data={model.hoursByBm} />
      <Text style={s.h2}>Atividades: original e efetivo</Text><Table headers={["Atividade", "BM", "Horas origem / efetivo", "Medição origem / efetivo", "Proveniência"]} rows={model.activities.map((item) => [`${item.description}\n${item.id}`, item.bm, `${item.sourceHours}\n${item.effectiveHours}`, `${item.sourceMeasurement}\n${item.effectiveMeasurement}`, `R${item.revision} · ${item.provenance}`])} widths={[2.2, .7, 1.1, 1.2, 1.8]} />
      <Text style={s.h2}>Evidências</Text><Text style={s.muted}>Somente metadados. Nenhum upload foi renderizado.</Text><Table headers={["Código", "Tipo", "Situação"]} rows={model.evidence.map((item) => [item.code, item.type, item.status])} widths={[1, 2, 2]} />
      <Text style={s.h2}>Histórico de ajustes</Text>{model.history.length ? model.history.map((item, index) => <View key={`${item.kind}-${item.record}-${item.revision}-${index}`} style={s.history} wrap={false}><Text style={{ fontWeight: 700 }}>{item.kind} · {item.record} · revisão {item.revision} · {item.operation === "restore" ? "restauração" : "ajuste"}</Text><Text>{item.actor} · {item.occurredAt}</Text><Text>Motivo: {item.reason}</Text><Text>Antes: {item.before}</Text><Text>Depois: {item.after}</Text></View>) : <Text>Nenhum ajuste registrado.</Text>}
    </Page>
  </Document>;
}

export function GlobalReportDocument({ model }: { model: GlobalReportModel }) {
  return <Document title="Relatório gerencial global" author="TRIA" subject="Portfólio privado com universos financeiros separados"><Page size="A4" style={s.page} wrap><Header title="Portfólio global" /><Footer code={model.meta.code} hash={model.meta.modelHash} />
    <Text style={s.h1}>Relatório gerencial global</Text><Intro code={model.meta.code} generatedAt={model.meta.generatedAt} hash={model.meta.modelHash} />
    <View style={s.notice}><Text>Medição, faturamento bruto, relação auditada e pagamento são universos distintos. Não existe total geral entre eles.</Text></View>
    {model.cash && <CashReport result={model.cash} scope="Projetos ativos" />}
    {Boolean(model.projectCash?.length) && <Table title="Caixa por projeto ativo" headers={["Projeto","Resultado","Corte"]} rows={model.projectCash!.map(p=>[p.title,p.result,p.cutoff])} widths={[2,1.5,1]} />}
    <Text style={s.h2}>Cobertura</Text><View style={s.metrics}>{model.coverage.map((item) => <View key={item.label} style={s.metric}><Text style={{ fontWeight: 700 }}>{item.label}</Text><Text>{item.value}</Text></View>)}</View>
    <ChartWithTable title="Status do portfólio" data={model.statuses} /><ChartWithTable title="Tendência temporal de horas" data={model.trend} />
    <Text style={s.h2}>Universos financeiros separados</Text><Table headers={["Universo", "Valor", "Regra"]} rows={model.financialUniverses.map((item) => [item.name, item.value, item.explanation])} widths={[1.3, 1, 2.2]} />
    <Table title="Portfólio" headers={["Projeto", "Status", "Atividades", "Horas", "Medição"]} rows={model.portfolio.map((item) => [item.title, item.status, item.activities, item.effectiveHours, item.measurement])} widths={[2.8, 1.6, .75, 1, 1.35]} />
  </Page></Document>;
}
