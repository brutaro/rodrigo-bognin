import { describe, expect, it } from "vitest";
import { chartBarWidth, enforceReportRows, fillMonthlyTrend, MAX_REPORT_ROWS, ReportLimitExceededError } from "./limits";

describe("limites dos relatórios", () => {
  it("não desenha barra para zero e mantém mínimo somente para não-zero", () => {
    expect(chartBarWidth(0, 100)).toBe("0%"); expect(chartBarWidth(0.1, 100)).toBe("1%");
  });
  it("preenche meses ausentes usando horas efetivas zero", () => {
    expect(fillMonthlyTrend([{ month_label: "2025-01", seconds: "3600" }, { month_label: "2025-03", seconds: "7200" }, { month_label: "2026-12", seconds: "0" }]))
      .toEqual([{ month_label: "2025-01", seconds: "3600" }, { month_label: "2025-02", seconds: "0" }, { month_label: "2025-03", seconds: "7200" }]);
    expect(() => fillMonthlyTrend([{ month_label: "2000-01", seconds: "1" }, { month_label: "2021-01", seconds: "1" }])).toThrow(ReportLimitExceededError);
  });
  it("aceita o teto total e recusa uma linha adicional", () => {
    enforceReportRows([Array.from({ length: MAX_REPORT_ROWS })]);
    expect(() => enforceReportRows([Array.from({ length: MAX_REPORT_ROWS + 1 })])).toThrow(ReportLimitExceededError);
  });
});
