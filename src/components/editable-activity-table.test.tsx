import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditableActivityTable } from "./editable-activity-table";

const action = async () => ({ status: "saved" as const, message: "ok" });

describe("editor de atividade sem perda de precisão", () => {
  it("renderiza os valores crus que o formulário reenviará ao editar só o outro campo", () => {
    const html = renderToStaticMarkup(<EditableActivityTable saveAction={action} restoreAction={action} activities={[{
      id: "A-1", description: "Atividade precisa", bm: "BM-1", hours: "30:15", measuredValue: "-R$ 12,12",
      durationSeconds: "108959", measuredValueDecimal: "-12.1234567890123456",
      sourceHours: "01:00", sourceMeasuredValue: "R$ 1,00", adjustmentRevision: "7", adjusted: true,
      adjustmentOperation: "adjust", adjustmentReason: "Precisão", adjustedBy: "Rodrigo", adjustedAt: "2026-09-01T10:00:00Z",
      adjustmentHistory: [], adjustmentRequestId: "10000000-0000-4000-8000-000000000001",
      restoreRequestId: "10000000-0000-4000-8000-000000000002",
    }]} />);
    expect(html).toContain('name="hours" value="30:15:59"');
    expect(html).toContain('name="measurement" value="-12.1234567890123456"');
    expect(html).not.toContain('name="measurement" value="-R$ 12,12"');
  });
});
