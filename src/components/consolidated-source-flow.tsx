"use client";

import { useState } from "react";
import { ConsolidatedSourcePreparation } from "./consolidated-source-preparation";
import { ConsolidatedSourceUpload, type ConsolidatedSourceReceipt } from "./consolidated-source-upload";

export function ConsolidatedSourceFlow({ enabled }: { enabled: boolean }) {
  const [receipt, setReceipt] = useState<ConsolidatedSourceReceipt | undefined>();
  return <>
    <ConsolidatedSourceUpload enabled={enabled} onProtected={setReceipt} />
    <ConsolidatedSourcePreparation key={receipt?.receiptId ?? "no-receipt"} enabled={enabled} receiptId={receipt?.receiptId} sourceFormat={receipt?.format} />
  </>;
}
