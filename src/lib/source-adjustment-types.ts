export type AdjustmentActionState = {
  status: "idle" | "saved" | "invalid" | "conflict" | "duplicate" | "unavailable";
  message: string;
  requestId?: string;
  currentRevision?: string;
  currentHours?: string;
  currentMeasuredValue?: string;
  currentSummary?: string;
};

export const initialAdjustmentActionState: AdjustmentActionState = { status: "idle", message: "" };
