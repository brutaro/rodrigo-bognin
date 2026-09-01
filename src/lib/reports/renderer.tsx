import "server-only";

import { createHash } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { GlobalReportDocument, ProjectReportDocument } from "./documents";
import type { GlobalReportModel, ProjectReportModel } from "./types";
import { enforceReportModelSize, enforceReportPdfSize } from "./limits";

export async function renderReport(model: ProjectReportModel | GlobalReportModel) {
  enforceReportModelSize(model);
  const buffer = await renderToBuffer(model.kind === "project" ? <ProjectReportDocument model={model} /> : <GlobalReportDocument model={model} />);
  enforceReportPdfSize(buffer);
  return { buffer, sha256: createHash("sha256").update(buffer).digest("hex") };
}
