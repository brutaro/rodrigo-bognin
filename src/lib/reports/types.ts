import type { CashResult } from "../cash-domain";
export type ReportMeta = { code: string; generatedAt: string; modelHash: string };
export type ReportTable = { title: string; headers: string[]; rows: string[][] };
export type ChartDatum = { label: string; value: number; displayValue: string };
export type ProjectReportModel = {
  cash?: CashResult;
  kind: "project"; meta: ReportMeta; project: { id: string; title: string; period: string; narrative: string };
  activities: Array<{ id: string; description: string; bm: string; sourceHours: string; effectiveHours: string; sourceMeasurement: string; effectiveMeasurement: string; revision: string; provenance: string }>;
  financialDocuments?: Array<{kind:string;description:string;amount:string;document:string}>;
  hoursByBm: ChartDatum[];
  financialUniverses: Array<{ name: string; value: string; explanation: string }>;
  evidence: Array<{ code: string; type: string; status: string }>;
  history: Array<{ kind: string; record: string; revision: string; operation: string; reason: string; actor: string; occurredAt: string; before: string; after: string }>;
};
export type GlobalReportModel = {
  cash?: CashResult;
  projectCash?: Array<{title:string;result:string;cutoff:string}>;
  kind: "global"; meta: ReportMeta; coverage: Array<{ label: string; value: string }>;
  statuses: ChartDatum[]; trend: ChartDatum[];
  portfolio: Array<{ id: string; title: string; status: string; activities: string; effectiveHours: string; measurement: string; invoiced: string; related: string; payments: string }>;
  financialUniverses: Array<{ name: string; value: string; explanation: string }>;
};
