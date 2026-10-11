import type { ProposalStatus } from "./service";

/** Labels of the proposals screens (F4d). */
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "Aguardando decisão",
  approved: "Aprovada, na fila",
  rejected: "Rejeitada",
  executed: "Executada",
  failed: "Não executada",
  expired: "Vencida",
};

/** Why an approved proposal did not run, in plain words. */
export const PROPOSAL_ERROR_LABELS: Record<string, string> = {
  expired: "a proposta venceu antes da execução",
  tampered: "o conteúdo não confere com o aprovado",
  stale: "o registro mudou depois da proposta",
  not_found: "o registro não existe mais",
  forbidden: "a permissão mudou",
  unavailable: "o módulo não está disponível",
  quota_exceeded: "o limite do plano foi atingido",
  invalid_input: "os dados não são mais válidos",
  unknown_operation: "a operação não existe nesta versão",
};

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
