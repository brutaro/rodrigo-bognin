import type { SourceFormat } from "./import-contract";

export type ExactSourceReference = {
  sourceFileId: string;
  fileVersionId: string;
  sha256: string;
  sourceFormat: SourceFormat;
};

export type SourceFileDescriptor = ExactSourceReference & {
  sizeBytes: number;
  status: "active";
  namespace: string;
  syntheticAttested: true;
};

export type VerifiedSourceBytes = {
  descriptor: SourceFileDescriptor;
  bytes: Uint8Array;
};

export interface SourceFileReader {
  readonly adapterKind: "database" | "memory-test";
  resolveSourceFile(sourceFileId: string): Promise<SourceFileDescriptor | undefined>;
  resolveExact(reference: ExactSourceReference): Promise<SourceFileDescriptor | undefined>;
  openExact(reference: ExactSourceReference): Promise<VerifiedSourceBytes>;
}
