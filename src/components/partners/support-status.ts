import type { SupportGrantView } from "@/core/partners/support";

/** Human status of a support grant, with expiry once approved. */
export function supportStatusLabel(grant: SupportGrantView): string {
  if (grant.status === "approved") {
    return grant.active && grant.expiresAt
      ? `Aprovado até ${grant.expiresAt.toLocaleString("pt-BR")}`
      : "Expirado";
  }
  return (
    { pending: "Aguardando o cliente", denied: "Negado", revoked: "Encerrado" }[
      grant.status
    ] ?? grant.status
  );
}
