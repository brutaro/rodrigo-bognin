import "server-only";

import { createHash } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { GlobalReportDocument, ProjectReportDocument } from "./documents";
import type { GlobalReportModel, ProjectReportModel } from "./types";

export async function renderReport(model: ProjectReportModel | GlobalReportModel) {
  const buffer = await renderToBuffer(model.kind === "project" ? <ProjectReportDocument model={model} /> : <GlobalReportDocument model={model} />);
  return { buffer, sha256: createHash("sha256").update(buffer).digest("hex") };
}
