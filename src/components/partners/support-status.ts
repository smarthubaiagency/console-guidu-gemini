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

/**
 * Message key (`support.status.*`) of a grant status; `date` is the expiry
 * to format as the `{date}` value of `approvedUntil`. Null for an unknown
 * status.
 */
export function supportStatusKey(
  grant: SupportGrantView,
): { key: string; date?: Date } | null {
  if (grant.status === "approved") {
    return grant.active && grant.expiresAt
      ? { key: "support.status.approvedUntil", date: grant.expiresAt }
      : { key: "support.status.expired" };
  }
  return ["pending", "denied", "revoked"].includes(grant.status)
    ? { key: `support.status.${grant.status}` }
    : null;
}
