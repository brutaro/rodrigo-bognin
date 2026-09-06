export const reimbursementLabels = {
  revertido: "Desconsiderado / revertido",
  nao_informado: "Situação não informada",
  sinalizado_pendente: "Aprovado · a receber",
  recebido_confirmado: "Recebido confirmado",
} as const;
export type ReimbursementStatus = {
  status: keyof typeof reimbursementLabels;
  receivedOn: string | null;
  revision: string;
};
export function reimbursementLabel(value?: ReimbursementStatus) {
  if (!value) return reimbursementLabels.nao_informado;
  const date = value.receivedOn?.split("-").reverse().join("/");
  return reimbursementLabels[value.status] + (date ? ` · ${date}` : "");
}
