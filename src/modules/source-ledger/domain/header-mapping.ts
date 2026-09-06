import { createHash } from "node:crypto";
import type { HeaderDescriptor, HeaderMapping, SourceSchemaVersion } from "./import-contract";

export type HeaderMappingSelection = { sourceHeaderId: string; sourceOrdinal: number; logicalFieldId: string };

export function normalizeHeaderLabel(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").trim();
}

export function buildHeaderDescriptors(labels: string[], sourceSha256: string): HeaderDescriptor[] {
  return labels.map((rawLabel, ordinal) => {
    const normalizedLabel = normalizeHeaderLabel(rawLabel);
    const headerId = createHash("sha256").update(`${sourceSha256}\0header\0${ordinal}\0${normalizedLabel}`, "utf8").digest("hex");
    return { ordinal, rawLabel, normalizedLabel, headerId };
  });
}

export class HeaderMappingError extends Error {
  constructor(readonly code: "HEADER_COLLISION" | "REQUIRED_FIELD_MISSING" | "HEADER_MAPPING_INVALID" | "HEADER_UNMAPPED", message: string) {
    super(message);
    this.name = "HeaderMappingError";
  }
}

export function validateHeaderStructure(headers: HeaderDescriptor[], schema: SourceSchemaVersion) {
  const normalized = new Map<string, HeaderDescriptor[]>();
  for (const header of headers.filter((item) => !["curso", "trilha"].includes(item.normalizedLabel))) normalized.set(header.normalizedLabel, [...(normalized.get(header.normalizedLabel) ?? []), header]);
  const collision = [...normalized.entries()].find(([, values]) => values.length > 1);
  if (collision) throw new HeaderMappingError("HEADER_COLLISION", "Há cabeçalhos ambíguos após a normalização permitida.");
  const schemaIds = new Set(schema.fields.map((field) => field.id));
  return { normalized, schemaIds };
}

export function validateHeaderMapping(input: {
  headers: HeaderDescriptor[];
  mappings: HeaderMapping[] | undefined;
  schema: SourceSchemaVersion;
}) {
  const mappings = input.mappings;
  if (!mappings?.length) throw new HeaderMappingError("HEADER_MAPPING_INVALID", "O mapeamento de cabeçalhos deve ser confirmado.");
  const byId = new Map(input.headers.map((header) => [header.headerId, header]));
  const fields = new Map(input.schema.fields.map((field) => [field.id, field]));
  const seenHeaders = new Set<string>();
  const seenFields = new Set<string>();
  for (const mapping of mappings) {
    const header = byId.get(mapping.sourceHeaderId);
    const field = fields.get(mapping.logicalFieldId);
    if (!header || header.ordinal !== mapping.sourceOrdinal || !field || seenHeaders.has(mapping.sourceHeaderId) || seenFields.has(mapping.logicalFieldId) || mapping.coercionProfile !== "identity-v1") {
      throw new HeaderMappingError("HEADER_MAPPING_INVALID", "O mapeamento de cabeçalhos não corresponde à estrutura inspecionada.");
    }
    if (header.normalizedLabel === "curso" || header.normalizedLabel === "trilha") {
      throw new HeaderMappingError("HEADER_MAPPING_INVALID", "Curso e trilha não participam do mapeamento funcional.");
    }
    if (mapping.mode === "canonical-normalized" && normalizeHeaderLabel(field.id) !== header.normalizedLabel) {
      throw new HeaderMappingError("HEADER_MAPPING_INVALID", "Uma associação não canônica exige mapeamento explícito.");
    }
    seenHeaders.add(mapping.sourceHeaderId);
    seenFields.add(mapping.logicalFieldId);
  }
  for (const field of input.schema.fields) if (field.required && !seenFields.has(field.id)) {
    throw new HeaderMappingError("REQUIRED_FIELD_MISSING", "Um campo obrigatório não foi mapeado.");
  }
  const ignored = new Set(["curso", "trilha"]);
  const unhandled = input.headers.filter((header) => !seenHeaders.has(header.headerId) && !ignored.has(header.normalizedLabel));
  if (unhandled.length) throw new HeaderMappingError("HEADER_UNMAPPED", "Há uma coluna que não foi mapeada nem ignorada pelo contrato.");
  return [...mappings].sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
}

export function buildServerHeaderMappings(input: {
  headers: HeaderDescriptor[];
  selections: HeaderMappingSelection[] | undefined;
  schema: SourceSchemaVersion;
}) {
  const byId = new Map(input.headers.map((header) => [header.headerId, header]));
  const mappings = (input.selections ?? []).map((selection) => {
    const header = byId.get(selection.sourceHeaderId);
    return {
      sourceHeaderId: selection.sourceHeaderId,
      sourceOrdinal: selection.sourceOrdinal,
      logicalFieldId: selection.logicalFieldId,
      mode: header && header.normalizedLabel === selection.logicalFieldId ? "canonical-normalized" as const : "explicit" as const,
      coercionProfile: "identity-v1" as const,
    };
  });
  return validateHeaderMapping({ headers: input.headers, mappings, schema: input.schema });
}
