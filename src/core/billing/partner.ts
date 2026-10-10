import { randomUUID } from "node:crypto";

import { z } from "zod";

import { detectLogoMime } from "@/core/brand/logo";
import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  type BillingActor,
  billingNotFound,
  canManagePartnerBilling,
  canManagePlatformBilling,
  canReadPartnerBilling,
  invalidBillingInput,
  requireAllowed,
} from "./access";
import { currentPlanVersion } from "./catalog";
import { ingestProviderEvent } from "./events";
import {
  PAYMENT_METHODS,
  type PaymentEvidence,
  type PaymentMethod,
} from "./provider";
import { manualProvider } from "./providers/manual";
import { getProvider, isProviderEnabled } from "./registry";
import { belowFloor, formatCents } from "./split";
import {
  assertTransition,
  isSubscriptionStatus,
  type ManualStatusTarget,
  MANUAL_STATUS_TARGETS,
  type SubscriptionStatus,
  toDateOnly,
} from "./subscriptions";

/**
 * Partner side of billing (/admin/billing, P5m). Partner pays mode with the
 * manual provider: the partner opens the plan of a customer, records each
 * monthly payment with evidence, and marks arrears, suspension or
 * cancellation. Runs in withIdentityContext with the partner of the host.
 */

// ---------------------------------------------------------------------------
// Billing profile
// ---------------------------------------------------------------------------

export type BillingProfileView = Readonly<{
  legalName: string;
  taxId: string;
  billingEmail: string;
  provider: string;
  updatedAt: Date;
}>;

export async function getBillingProfile(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
): Promise<BillingProfileView | null> {
  requireAllowed(canReadPartnerBilling(actor));
  return tx.partnerBillingProfile.findUnique({
    where: { partnerId },
    select: {
      legalName: true,
      taxId: true,
      billingEmail: true,
      provider: true,
      updatedAt: true,
    },
  });
}

/** CNPJ with valid check digits; digits only. */
export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

const ProfileSchema = z.object({
  legalName: z.string().trim().min(1, "Informe a razão social.").max(160),
  taxId: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine(isValidCnpj, "Informe um CNPJ válido."),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido.")
    .max(254),
});

export async function saveBillingProfile(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  input: Readonly<{ legalName: string; taxId: string; billingEmail: string }>,
): Promise<void> {
  requireAllowed(canManagePartnerBilling(actor));
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const data = { ...parsed.data, provider: "manual", updatedBy: actor.userId };
  await tx.partnerBillingProfile.upsert({
    where: { partnerId },
    create: { partnerId, ...data },
    update: data,
    select: { partnerId: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.billing.profile.save",
    resourceType: "partner_billing_profile",
    resourceId: partnerId,
    result: "success",
    origin: "app",
    metadata: { provider: "manual" },
  });
}

// ---------------------------------------------------------------------------
// Partner plans (prices over a plan version)
// ---------------------------------------------------------------------------

export type PartnerPlanView = Readonly<{
  id: string;
  name: string;
  priceCents: number;
  status: "active" | "archived";
  planName: string;
  planVersion: number;
  minPriceCents: number;
  billingInterval: string;
}>;

export async function listPartnerPlans(
  tx: ContextTransaction,
  partnerId: string,
  options: Readonly<{ activeOnly?: boolean }> = {},
): Promise<PartnerPlanView[]> {
  const rows = await tx.partnerPlan.findMany({
    where: {
      partnerId,
      ...(options.activeOnly ? { status: "active" } : {}),
    },
    orderBy: { priceCents: "asc" },
    include: { planVersion: { include: { plan: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    status: row.status === "archived" ? "archived" : "active",
    planName: row.planVersion.plan.name,
    planVersion: row.planVersion.version,
    minPriceCents: row.planVersion.minPriceCents,
    billingInterval: row.planVersion.billingInterval,
  }));
}

const PartnerPlanSchema = z.object({
  planId: z.string().uuid("Escolha o plano base."),
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  priceCents: z.coerce
    .number()
    .int("Use centavos inteiros.")
    .positive("Informe o preço.")
    .max(2_000_000_000),
});

/**
 * Creates a partner price over the current version of a base plan. Below
 * the floor it is refused here and again by RLS (criterion 4).
 */
export async function createPartnerPlan(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  input: Readonly<{
    planId: string;
    name: string;
    priceCents: number | string;
  }>,
): Promise<{ id: string }> {
  requireAllowed(canManagePartnerBilling(actor));
  const parsed = PartnerPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const version = await currentPlanVersion(tx, parsed.data.planId);
  if (!version) throw billingNotFound();
  if (parsed.data.priceCents < version.minPriceCents) {
    throw belowFloor(version.minPriceCents);
  }
  const taken = await tx.partnerPlan.findFirst({
    where: { partnerId, name: parsed.data.name },
    select: { id: true },
  });
  if (taken) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe um plano seu com esse nome.",
    });
  }
  const plan = await tx.partnerPlan.create({
    data: {
      partnerId,
      planVersionId: version.id,
      name: parsed.data.name,
      priceCents: parsed.data.priceCents,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.billing.plan.create",
    resourceType: "partner_plan",
    resourceId: plan.id,
    result: "success",
    origin: "app",
    metadata: {
      name: parsed.data.name,
      to: formatCents(parsed.data.priceCents),
    },
  });
  return plan;
}

export async function setPartnerPlanStatus(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  partnerPlanId: string,
  status: "active" | "archived",
): Promise<void> {
  requireAllowed(canManagePartnerBilling(actor));
  const plan = await tx.partnerPlan.findFirst({
    where: { id: partnerPlanId, partnerId },
    select: { status: true },
  });
  if (!plan) throw billingNotFound();
  if (plan.status === status) return;
  await tx.partnerPlan.update({
    where: { id: partnerPlanId },
    data: { status },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.billing.plan.status",
    resourceType: "partner_plan",
    resourceId: partnerPlanId,
    result: "success",
    origin: "app",
    metadata: { from: plan.status, to: status },
  });
}

// ---------------------------------------------------------------------------
// Customer subscriptions
// ---------------------------------------------------------------------------

export type CustomerBillingRow = Readonly<{
  organizationId: string;
  organizationName: string;
  subscription: Readonly<{
    id: string;
    status: SubscriptionStatus;
    planName: string;
    planVersion: number;
    provisional: boolean;
    mode: string;
    amountCents: number;
    billingInterval: string;
    currentPeriodEnd: Date | null;
  }> | null;
}>;

/** Customers of the partner with their open subscription, if any. */
export async function listCustomerSubscriptions(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
): Promise<CustomerBillingRow[]> {
  requireAllowed(canReadPartnerBilling(actor));
  const [organizations, subscriptions] = await Promise.all([
    tx.organization.findMany({
      where: { partnerId },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true },
    }),
    tx.subscription.findMany({
      where: { partnerId, status: { not: "canceled" } },
      include: { planVersion: { include: { plan: true } } },
    }),
  ]);
  return organizations.map((org) => {
    const sub = subscriptions.find((s) => s.organizationId === org.id);
    return {
      organizationId: org.id,
      organizationName: org.name,
      subscription:
        sub && isSubscriptionStatus(sub.status)
          ? {
              id: sub.id,
              status: sub.status,
              planName: sub.planVersion.plan.name,
              planVersion: sub.planVersion.version,
              provisional: sub.planVersion.provisional,
              mode: sub.mode,
              amountCents: sub.amountCents,
              billingInterval: sub.billingInterval,
              currentPeriodEnd: sub.currentPeriodEnd,
            }
          : null,
    };
  });
}

/**
 * Opens a pending subscription in the partner pays mode, at the partner
 * base value of the current plan version (frozen from then on). Used when
 * the customer is registered (partner_admin) and from /admin/billing.
 */
export async function startSubscription(
  tx: ContextTransaction,
  actor: BillingActor & Readonly<{ canRegisterCustomers?: boolean }>,
  partnerId: string,
  input: Readonly<{ organizationId: string; planId: string }>,
): Promise<{ id: string }> {
  requireAllowed(
    canManagePartnerBilling(actor) || Boolean(actor.canRegisterCustomers),
  );
  const organization = await tx.organization.findFirst({
    where: { id: input.organizationId, partnerId },
    select: { id: true },
  });
  if (!organization) throw billingNotFound();
  const version = await currentPlanVersion(tx, input.planId);
  if (!version) throw billingNotFound();
  if (version.partnerBasePriceCents <= 0) {
    throw invalidBillingInput("O plano ainda não tem valor base cadastrado.");
  }
  const profile = await tx.partnerBillingProfile.findUnique({
    where: { partnerId },
    select: { provider: true },
  });
  const provider = profile?.provider === "manual" || !profile ? "manual" : null;
  if (!provider || !isProviderEnabled(provider)) {
    throw invalidBillingInput("Provedor de pagamento não configurado.");
  }

  const open = await tx.subscription.findFirst({
    where: { organizationId: organization.id, status: { not: "canceled" } },
    select: { id: true },
  });
  if (open) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Esse cliente já tem uma assinatura aberta.",
    });
  }
  // The partner_admin has no read access to subscriptions: no RETURNING.
  const id = randomUUID();
  await tx.$executeRaw`
    insert into public.subscriptions
      (id, partner_id, organization_id, plan_version_id, mode, payer, provider,
       billing_interval, amount_cents, created_by)
    values
      (${id}::uuid, ${partnerId}::uuid, ${organization.id}::uuid, ${version.id}::uuid,
       'partner_pays', 'partner', ${provider}, ${version.billingInterval},
       ${version.partnerBasePriceCents}, ${actor.userId}::uuid)
  `;
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.subscription.start",
    resourceType: "subscription",
    resourceId: id,
    result: "success",
    origin: "app",
    metadata: {
      target: organization.id,
      status: "pending",
      to: formatCents(version.partnerBasePriceCents),
    },
  });
  return { id };
}

export async function changeSubscriptionStatus(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string | null,
  subscriptionId: string,
  to: ManualStatusTarget,
): Promise<void> {
  // The platform acts on any partner (partnerId null); the partner on its own.
  const platform = partnerId === null;
  requireAllowed(
    platform ? canManagePlatformBilling(actor) : canManagePartnerBilling(actor),
  );
  if (!(MANUAL_STATUS_TARGETS as readonly string[]).includes(to)) {
    throw invalidBillingInput("Situação inválida.");
  }
  const subscription = await tx.subscription.findFirst({
    where: { id: subscriptionId, ...(partnerId ? { partnerId } : {}) },
    select: { status: true, organizationId: true, provider: true },
  });
  if (!subscription || !isSubscriptionStatus(subscription.status)) {
    throw billingNotFound();
  }
  if (subscription.status === to) return;
  assertTransition(subscription.status, to);
  if (to === "canceled") {
    await getProvider(subscription.provider as "manual").cancelSubscription({
      provider: subscription.provider as "manual",
      externalId: subscriptionId,
    });
  }
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: to,
      ...(to === "canceled" ? { canceledAt: new Date() } : {}),
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.subscription.status",
    resourceType: "subscription",
    resourceId: subscriptionId,
    result: "success",
    origin: platform ? "admin" : "app",
    metadata: {
      target: subscription.organizationId,
      from: subscription.status,
      to,
    },
  });
}

// ---------------------------------------------------------------------------
// Manual payments
// ---------------------------------------------------------------------------

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

/** Real type of the evidence: PDF or the image types accepted for logos. */
export function detectEvidenceMime(
  bytes: Uint8Array,
): PaymentEvidence["mime"] | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  return detectLogoMime(bytes);
}

const PaymentSchema = z.object({
  subscriptionId: z.string().uuid(),
  amountCents: z.coerce.number().int().positive("Informe o valor pago."),
  method: z.enum(PAYMENT_METHODS, { message: "Escolha o meio de pagamento." }),
  paidOn: z.coerce.date({ message: "Informe a data do pagamento." }),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export type ManualPaymentFormInput = Readonly<{
  subscriptionId: string;
  amountCents: number | string;
  method: string;
  paidOn: Date | string;
  note?: string | null;
  evidence: Uint8Array | null;
  idempotencyKey: string;
}>;

/**
 * Records a monthly payment received outside the platform, with evidence.
 * The record activates the subscription at once (decision 2a); the platform
 * sees it in /platform/billing and may refund it. A repeated submit of the
 * same form (same idempotency key) has no second effect.
 */
export async function recordManualPayment(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  input: ManualPaymentFormInput,
  now: Date = new Date(),
): Promise<{
  outcome: "processed" | "duplicate" | "ignored";
  paymentId: string | null;
}> {
  requireAllowed(canManagePartnerBilling(actor));
  const parsed = PaymentSchema.safeParse({
    ...input,
    note: input.note ?? undefined,
  });
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const paidOn = toDateOnly(parsed.data.paidOn);
  if (paidOn > toDateOnly(now)) {
    throw invalidBillingInput("A data do pagamento não pode ser futura.");
  }
  if (!input.evidence || input.evidence.length === 0) {
    throw invalidBillingInput("Anexe o comprovante do pagamento.");
  }
  if (input.evidence.length > MAX_EVIDENCE_BYTES) {
    throw invalidBillingInput("O comprovante pode ter até 2 MB.");
  }
  const mime = detectEvidenceMime(input.evidence);
  if (!mime) {
    throw invalidBillingInput(
      "O comprovante precisa ser PDF, PNG, JPEG ou WebP.",
    );
  }

  const subscription = await tx.subscription.findFirst({
    where: { id: parsed.data.subscriptionId, partnerId },
    select: { provider: true, organizationId: true },
  });
  if (!subscription) throw billingNotFound();
  if (subscription.provider !== "manual") {
    throw invalidBillingInput("Essa assinatura não usa registro manual.");
  }

  const result = await ingestProviderEvent(
    tx,
    actor.userId,
    manualProvider.paymentEvent({
      partnerId,
      subscriptionId: parsed.data.subscriptionId,
      amountCents: parsed.data.amountCents,
      method: parsed.data.method as PaymentMethod,
      paidOn,
      note: parsed.data.note || null,
      evidence: { bytes: input.evidence, mime },
      idempotencyKey: parsed.data.idempotencyKey,
    }),
    now,
  );
  if (result.outcome === "processed") {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "partner.payment.record",
      resourceType: "payment",
      resourceId: result.paymentId,
      result: "success",
      origin: "app",
      metadata: {
        target: subscription.organizationId,
        provider: "manual",
        to: formatCents(parsed.data.amountCents),
      },
    });
  }
  return result;
}

/** Evidence file of a payment, for the partner and the platform (RLS). */
export async function loadPaymentEvidence(
  tx: ContextTransaction,
  paymentId: string,
): Promise<PaymentEvidence | null> {
  const row = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { evidence: true, evidenceMime: true },
  });
  if (!row?.evidence || !row.evidenceMime) return null;
  return {
    bytes: new Uint8Array(row.evidence),
    mime: row.evidenceMime as PaymentEvidence["mime"],
  };
}

// ---------------------------------------------------------------------------
// "Ativar checkout" switch
// ---------------------------------------------------------------------------

export type CheckoutPrerequisite = Readonly<{
  key:
    "not_blocked" | "partner_plan" | "legal" | "recipient" | "split_provider";
  label: string;
  met: boolean;
  /** P5m enforces only what exists today; the rest becomes required in P6. */
  requiredNow: boolean;
}>;

export async function checkoutPrerequisites(
  tx: ContextTransaction,
  partnerId: string,
): Promise<CheckoutPrerequisite[]> {
  const [partner, plans, legal, profile] = await Promise.all([
    tx.partner.findUnique({
      where: { id: partnerId },
      select: { checkoutBlocked: true },
    }),
    listPartnerPlans(tx, partnerId, { activeOnly: true }),
    tx.partnerLegalDocument.groupBy({
      by: ["kind"],
      where: { partnerId },
    }),
    tx.partnerBillingProfile.findUnique({
      where: { partnerId },
      select: { provider: true },
    }),
  ]);
  const kinds = new Set(legal.map((d) => d.kind));
  const provider = getProvider(
    profile?.provider === "iugu" || profile?.provider === "stripe"
      ? profile.provider
      : "manual",
  );
  return [
    {
      key: "not_blocked",
      label: "Checkout liberado pela plataforma",
      met: !partner?.checkoutBlocked,
      requiredNow: true,
    },
    {
      key: "partner_plan",
      label: "Pelo menos um plano seu com preço igual ou acima do piso",
      met: plans.some((p) => p.priceCents >= p.minPriceCents),
      requiredNow: true,
    },
    {
      key: "legal",
      label: "Termos e política de privacidade publicados",
      met: kinds.has("terms") && kinds.has("privacy"),
      requiredNow: true,
    },
    {
      key: "recipient",
      label: "Conta de recebimento verificada no provedor (P6)",
      met: false,
      requiredNow: false,
    },
    {
      key: "split_provider",
      label: "Provedor com divisão na origem (Iugu ou Stripe, P6)",
      met: provider.capabilities.split && isProviderEnabled(provider.key),
      requiredNow: false,
    },
  ];
}

/**
 * Turns the switch on or off. On, the /app shows a demonstration checkout
 * that charges nothing until P6; the customer pays mode does not start yet.
 */
export async function setCheckoutEnabled(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  enabled: boolean,
): Promise<void> {
  requireAllowed(canManagePartnerBilling(actor));
  const partner = await tx.partner.findUnique({
    where: { id: partnerId },
    select: { checkoutEnabled: true, checkoutBlocked: true },
  });
  if (!partner) throw billingNotFound();
  if (partner.checkoutEnabled === enabled) return;
  if (enabled) {
    const missing = (await checkoutPrerequisites(tx, partnerId)).filter(
      (p) => p.requiredNow && !p.met,
    );
    if (missing.length > 0) {
      throw invalidBillingInput(
        `Para ativar o checkout falta: ${missing.map((p) => p.label.toLowerCase()).join("; ")}.`,
      );
    }
  }
  await tx.partner.update({
    where: { id: partnerId },
    data: { checkoutEnabled: enabled },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.checkout.toggle",
    resourceType: "partner",
    resourceId: partnerId,
    result: "success",
    origin: "app",
    metadata: {
      from: partner.checkoutEnabled ? "on" : "off",
      to: enabled ? "on" : "off",
    },
  });
}
