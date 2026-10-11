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
    messageKey: "billing.errors.notFound",
  });
}

/**
 * `billing.errors.*` keys of the input messages of the billing services and
 * their schemas (I3). A message outside this list keeps its Portuguese text.
 */
const INPUT_KEYS: Readonly<Record<string, string>> = {
  "Dados inválidos.": "invalid",
  "Percentual inválido.": "invalidPercent",
  "Módulo desconhecido no plano.": "unknownModule",
  "Limite de cota desconhecida no plano.": "unknownQuota",
  "O parceiro da casa não pode ser bloqueado.": "houseNotBlockable",
  "Estorno disponível só para pagamentos manuais.": "refundManualOnly",
  "O plano ainda não tem valor base cadastrado.": "noBasePrice",
  "Provedor de pagamento não configurado.": "providerNotConfigured",
  "Situação inválida.": "invalidStatus",
  "A data do pagamento não pode ser futura.": "futurePaymentDate",
  "Anexe o comprovante do pagamento.": "evidenceRequired",
  "O comprovante pode ter até 900 KB.": "evidenceTooLarge",
  "O comprovante precisa ser PDF, PNG, JPEG ou WebP.": "evidenceType",
  "Essa assinatura não usa registro manual.": "notManual",
  "O valor pago precisa ser igual ao valor da assinatura.": "amountMismatch",
  "Use letras minúsculas, números e hífen.": "keyFormat",
  "Informe o nome.": "nameRequired",
  "Informe um valor em centavos.": "centsRequired",
  "Use centavos inteiros.": "centsInteger",
  "O valor não pode ser negativo.": "negativeAmount",
  "O repasse mínimo não pode passar do piso.": "minShareAboveFloor",
  "Use pontos-base inteiros (3000 = 30%).": "basisPointsInteger",
  "Informe a razão social.": "legalNameRequired",
  "Informe um CNPJ válido.": "invalidCnpj",
  "Informe um e-mail válido.": "invalidEmail",
  "Escolha o plano base.": "basePlanRequired",
  "Informe o preço.": "priceRequired",
  "Informe o valor pago.": "amountPaidRequired",
  "Escolha o meio de pagamento.": "methodRequired",
  "Informe a data do pagamento.": "paidOnRequired",
  "Use dias inteiros.": "daysInteger",
  "A tolerância vai de 0 a 60 dias.": "pastDueRange",
  "A carência vai de 1 a 90 dias.": "suspendRange",
};

export function invalidBillingInput(message: string): AppError {
  const key = INPUT_KEYS[message];
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    ...(key ? { messageKey: `billing.errors.${key}` } : {}),
  });
}
