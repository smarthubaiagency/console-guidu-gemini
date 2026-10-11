import type { PartnerRoleKey } from "@/core/permissions/matrix";

export const PARTNER_ROLE_LABELS: Record<PartnerRoleKey, string> = {
  partner_owner: "Proprietário",
  partner_admin: "Administrador",
  partner_finance: "Financeiro",
  partner_support: "Suporte",
};

export function partnerRoleLabel(role: string): string {
  return PARTNER_ROLE_LABELS[role as PartnerRoleKey] ?? role;
}

/** Message key of a partner role (`partnerConsole.roles.*`), or null. */
export function partnerRoleKey(role: string): string | null {
  return Object.hasOwn(PARTNER_ROLE_LABELS, role)
    ? `partnerConsole.roles.${role}`
    : null;
}
