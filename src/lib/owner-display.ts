// Nome comercial na apresentação; a identidade interna e os registros permanecem intactos.
export function ownerDisplay(value: string | null | undefined): string {
  return (value ?? "").replace(/\bRodrigo\b/g, "XCON");
}
