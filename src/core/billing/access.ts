import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { AppError } from "@/shared/errors";

/** Who acts on billing; RLS repeats every check (P5m migration). */
export type BillingActor = Readonly<{
  userId: string;
  platformRole?: PlatformAdminRoleKey | null;
  partnerRole?: PartnerRoleKey | null;
}>;

export function canReadPlatformBilling(actor: BillingActor): boolean {
  return Boolean(
    actor.platformRole &&
    hasPlatformRolePermission(
      actor.platformRole,
      Permissions.PLATFORM_BILLING_READ,
    ),
  );
}

export function canManagePlatformBilling(actor: BillingActor): boolean {
  return Boolean(
    actor.platformRole &&
    hasPlatformRolePermission(
      actor.platformRole,
      Permissions.PLATFORM_BILLING_MANAGE,
    ),
  );
}

export function canReadPartnerBilling(actor: BillingActor): boolean {
  return Boolean(
    actor.partnerRole &&
    hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_BILLING_READ,
    ),
  );
}

export function canManagePartnerBilling(actor: BillingActor): boolean {
  return Boolean(
    actor.partnerRole &&
    hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_BILLING_MANAGE,
    ),
  );
}

export function requireAllowed(allowed: boolean): void {
  if (!allowed) throw new PermissionDeniedError();
}

export function billingNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Registro de cobrança não encontrado.",
  });
}

export function invalidBillingInput(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}
