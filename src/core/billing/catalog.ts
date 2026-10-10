import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { hasPlatformRolePermission } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { CORE_QUOTAS } from "@/core/entitlements/quotas";
import { listRegisteredModules } from "@/modules/registry";
import { AppError } from "@/shared/errors";

import {
  type BillingActor,
  billingNotFound,
  canManagePlatformBilling,
  canReadPlatformBilling,
  invalidBillingInput,
  requireAllowed,
} from "./access";
import { ingestProviderEvent } from "./events";
import { manualProvider } from "./providers/manual";

/**
 * Platform side of billing (/platform/billing, P5m): base plans and their
 * insert-only versions, split rules, the checkout block per partner, totals
 * per partner and refunds. Prices, floors and shares are records, not code
 * (D-PA-14); seeded values are marked provisional until D-PA-11.
 */

export type PlanVersionView = Readonly<{
  id: string;
  version: number;
  billingInterval: "monthly" | "yearly";
  moduleKeys: string[];
  minPriceCents: number;
  minPlatformShareCents: number;
  partnerBasePriceCents: number;
  provisional: boolean;
  /** Quota limits of the version (F3b). */
  limits: Record<string, number>;
  createdAt: Date;
}>;

export type PlanView = Readonly<{
  id: string;
  key: string;
  name: string;
  status: "active" | "retired";
  /** Newest first; the first one is current. */
  versions: PlanVersionView[];
}>;

function toVersionView(row: {
  id: string;
  version: number;
  billingInterval: string;
  moduleKeys: string[];
  minPriceCents: number;
  minPlatformShareCents: number;
  partnerBasePriceCents: number;
  provisional: boolean;
  limits: unknown;
  createdAt: Date;
}): PlanVersionView {
  const limits =
    row.limits && typeof row.limits === "object" && !Array.isArray(row.limits)
      ? Object.fromEntries(
          Object.entries(row.limits as Record<string, unknown>).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : {};
  return {
    id: row.id,
    version: row.version,
    billingInterval: row.billingInterval === "yearly" ? "yearly" : "monthly",
    moduleKeys: row.moduleKeys,
    minPriceCents: row.minPriceCents,
    minPlatformShareCents: row.minPlatformShareCents,
    partnerBasePriceCents: row.partnerBasePriceCents,
    provisional: row.provisional,
    limits,
    createdAt: row.createdAt,
  };
}

/** Quota keys a plan version may limit: core quotas and module quotas. */
export function listQuotaKeys(): Array<{ key: string; description: string }> {
  return [
    ...CORE_QUOTAS.map((q) => ({ key: q.key, description: q.description })),
    ...listRegisteredModules().flatMap((mod) =>
      mod.manifest.entitlements
        .filter((e) => e.kind === "quota")
        .map((e) => ({ key: e.key, description: e.description })),
    ),
  ];
}

/** Plans readable by any signed-in context (the catalog is not secret). */
export async function listPlans(
  tx: ContextTransaction,
  options: Readonly<{ activeOnly?: boolean }> = {},
): Promise<PlanView[]> {
  const plans = await tx.plan.findMany({
    where: options.activeOnly ? { status: "active" } : {},
    orderBy: { createdAt: "asc" },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  return plans.map((plan) => ({
    id: plan.id,
    key: plan.key,
    name: plan.name,
    status: plan.status === "retired" ? "retired" : "active",
    versions: plan.versions.map(toVersionView),
  }));
}

export async function currentPlanVersion(
  tx: ContextTransaction,
  planId: string,
): Promise<PlanVersionView | null> {
  const row = await tx.planVersion.findFirst({
    where: { planId, plan: { status: "active" } },
    orderBy: { version: "desc" },
  });
  return row ? toVersionView(row) : null;
}

const PlanSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
      "Use letras minúsculas, números e hífen.",
    )
    .max(48),
  name: z.string().trim().min(1, "Informe o nome.").max(80),
});

export async function createPlan(
  tx: ContextTransaction,
  actor: BillingActor,
  input: Readonly<{ key: string; name: string }>,
): Promise<{ id: string }> {
  requireAllowed(canManagePlatformBilling(actor));
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const existing = await tx.plan.findUnique({
    where: { key: parsed.data.key },
    select: { id: true },
  });
  if (existing) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe um plano com essa chave.",
    });
  }
  const plan = await tx.plan.create({
    data: { ...parsed.data, createdBy: actor.userId },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.plan.create",
    resourceType: "plan",
    resourceId: plan.id,
    result: "success",
    origin: "admin",
    metadata: { name: parsed.data.name, target: parsed.data.key },
  });
  return plan;
}

export async function setPlanStatus(
  tx: ContextTransaction,
  actor: BillingActor,
  planId: string,
  status: "active" | "retired",
): Promise<void> {
  requireAllowed(canManagePlatformBilling(actor));
  const plan = await tx.plan.findUnique({
    where: { id: planId },
    select: { status: true },
  });
  if (!plan) throw billingNotFound();
  if (plan.status === status) return;
  await tx.plan.update({ where: { id: planId }, data: { status } });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.plan.status",
    resourceType: "plan",
    resourceId: planId,
    result: "success",
    origin: "admin",
    metadata: { from: plan.status, to: status },
  });
}

const CentsSchema = z.coerce
  .number({ message: "Informe um valor em centavos." })
  .int("Use centavos inteiros.")
  .min(0, "O valor não pode ser negativo.")
  .max(2_000_000_000);

const VersionSchema = z
  .object({
    billingInterval: z.enum(["monthly", "yearly"]),
    moduleKeys: z.array(z.string()).max(32),
    minPriceCents: CentsSchema,
    minPlatformShareCents: CentsSchema,
    partnerBasePriceCents: CentsSchema,
    provisional: z.boolean(),
    limits: z
      .record(z.string(), z.number().int().min(0).max(1_000_000))
      .default({}),
  })
  .refine((v) => v.minPlatformShareCents <= v.minPriceCents, {
    message: "O repasse mínimo não pode passar do piso.",
  });

export type PlanVersionInput = z.input<typeof VersionSchema>;

/**
 * Publishes the next version of a plan. Existing subscriptions keep the
 * version they were created with (criterion 6).
 */
export async function publishPlanVersion(
  tx: ContextTransaction,
  actor: BillingActor,
  planId: string,
  input: PlanVersionInput,
): Promise<{ id: string; version: number }> {
  requireAllowed(canManagePlatformBilling(actor));
  const parsed = VersionSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const known = new Set(
    listRegisteredModules().map((mod) => mod.manifest.moduleKey),
  );
  const moduleKeys = [...new Set(parsed.data.moduleKeys)];
  if (moduleKeys.some((key) => !known.has(key))) {
    throw invalidBillingInput("Módulo desconhecido no plano.");
  }
  const quotaKeys = new Set(listQuotaKeys().map((q) => q.key));
  if (Object.keys(parsed.data.limits).some((key) => !quotaKeys.has(key))) {
    throw invalidBillingInput("Limite de cota desconhecida no plano.");
  }
  const plan = await tx.plan.findUnique({
    where: { id: planId },
    select: { id: true },
  });
  if (!plan) throw billingNotFound();

  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('plan_version:' || ${planId}::text))`;
  const latest = await tx.planVersion.findFirst({
    where: { planId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const created = await tx.planVersion.create({
    data: {
      planId,
      version,
      ...parsed.data,
      moduleKeys,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.plan_version.publish",
    resourceType: "plan",
    resourceId: planId,
    result: "success",
    origin: "admin",
    metadata: {
      to: String(version),
      status: parsed.data.provisional ? "provisional" : "final",
    },
  });
  return { id: created.id, version };
}

// ---------------------------------------------------------------------------
// Split rules
// ---------------------------------------------------------------------------

export type SplitRuleView = Readonly<{
  id: string;
  partnerId: string | null;
  version: number;
  platformPercentBp: number;
  createdAt: Date;
}>;

/** The rule in force for a partner: its own newest, else the default. */
export async function currentSplitRule(
  tx: ContextTransaction,
  partnerId: string,
): Promise<SplitRuleView | null> {
  const own = await tx.splitRule.findFirst({
    where: { partnerId },
    orderBy: { version: "desc" },
  });
  if (own) return own;
  return tx.splitRule.findFirst({
    where: { partnerId: null },
    orderBy: { version: "desc" },
  });
}

export async function listSplitRules(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<SplitRuleView[]> {
  requireAllowed(canReadPlatformBilling(actor));
  return tx.splitRule.findMany({
    orderBy: [{ partnerId: "asc" }, { version: "desc" }],
  });
}

const PercentSchema = z.coerce
  .number()
  .int("Use pontos-base inteiros (3000 = 30%).")
  .min(0)
  .max(10_000);

export async function publishSplitRule(
  tx: ContextTransaction,
  actor: BillingActor,
  input: Readonly<{
    partnerId: string | null;
    platformPercentBp: number | string;
  }>,
): Promise<{ version: number }> {
  requireAllowed(canManagePlatformBilling(actor));
  const parsed = PercentSchema.safeParse(input.platformPercentBp);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Percentual inválido.",
    );
  }
  if (input.partnerId) {
    const partner = await tx.partner.findUnique({
      where: { id: input.partnerId },
      select: { id: true },
    });
    if (!partner) throw billingNotFound();
  }
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('split_rule:' || coalesce(${input.partnerId}::text, 'default')))`;
  const latest = await tx.splitRule.findFirst({
    where: { partnerId: input.partnerId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  await tx.splitRule.create({
    data: {
      partnerId: input.partnerId,
      version,
      platformPercentBp: parsed.data,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.split_rule.publish",
    resourceType: "split_rule",
    resourceId: input.partnerId ?? "default",
    result: "success",
    origin: "admin",
    metadata: { to: `${parsed.data}bp`, target: String(version) },
  });
  return { version };
}

// ---------------------------------------------------------------------------
// Checkout block, totals and refunds
// ---------------------------------------------------------------------------

/** Blocking turns the switch off as well; partner management permission. */
export async function setCheckoutBlocked(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string,
  blocked: boolean,
): Promise<void> {
  requireAllowed(
    Boolean(
      actor.platformRole &&
      hasPlatformRolePermission(
        actor.platformRole,
        Permissions.PLATFORM_PARTNERS_MANAGE,
      ),
    ),
  );
  const partner = await tx.partner.findUnique({
    where: { id: partnerId },
    select: { checkoutBlocked: true, checkoutEnabled: true, isHouse: true },
  });
  if (!partner) throw billingNotFound();
  if (partner.isHouse) {
    throw invalidBillingInput("O parceiro da casa não pode ser bloqueado.");
  }
  if (partner.checkoutBlocked === blocked) return;
  await tx.partner.update({
    where: { id: partnerId },
    data: blocked
      ? { checkoutBlocked: true, checkoutEnabled: false }
      : { checkoutBlocked: false },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: blocked ? "billing.checkout.block" : "billing.checkout.unblock",
    resourceType: "partner",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: {
      from: partner.checkoutBlocked ? "blocked" : "unblocked",
      to: blocked ? "blocked" : "unblocked",
    },
  });
}

export type PartnerTotals = Readonly<{
  partnerId: string;
  partnerName: string;
  receivedCents: number;
  refundedCents: number;
  /** Platform share net of refunds. */
  platformNetCents: number;
  /** Partner share net of refunds (customer pays mode, payable to it). */
  partnerNetCents: number;
  openSubscriptions: number;
}>;

export async function listPartnerTotals(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<PartnerTotals[]> {
  requireAllowed(canReadPlatformBilling(actor));
  const [partners, sums, open] = await Promise.all([
    tx.partner.findMany({
      orderBy: [{ isHouse: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    tx.payment.groupBy({
      by: ["partnerId", "kind"],
      _sum: {
        amountCents: true,
        platformShareCents: true,
        partnerShareCents: true,
      },
    }),
    tx.subscription.groupBy({
      by: ["partnerId"],
      where: { status: { not: "canceled" } },
      _count: { _all: true },
    }),
  ]);
  return partners.map((partner) => {
    const paid = sums.find(
      (s) => s.partnerId === partner.id && s.kind === "payment",
    )?._sum;
    const refunded = sums.find(
      (s) => s.partnerId === partner.id && s.kind === "refund",
    )?._sum;
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      receivedCents: paid?.amountCents ?? 0,
      refundedCents: refunded?.amountCents ?? 0,
      platformNetCents:
        (paid?.platformShareCents ?? 0) - (refunded?.platformShareCents ?? 0),
      partnerNetCents:
        (paid?.partnerShareCents ?? 0) - (refunded?.partnerShareCents ?? 0),
      openSubscriptions:
        open.find((o) => o.partnerId === partner.id)?._count._all ?? 0,
    };
  });
}

export type PlatformPaymentView = Readonly<{
  id: string;
  partnerId: string;
  organizationId: string;
  kind: "payment" | "refund";
  refundOf: string | null;
  refunded: boolean;
  method: string;
  amountCents: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidOn: Date;
  hasEvidence: boolean;
  createdAt: Date;
}>;

export async function listRecentPayments(
  tx: ContextTransaction,
  actor: BillingActor,
  options: Readonly<{ partnerId?: string; take?: number }> = {},
): Promise<PlatformPaymentView[]> {
  requireAllowed(canReadPlatformBilling(actor));
  return listPayments(tx, options);
}

/** Shared by the platform and the partner listings (RLS scopes the rows). */
export async function listPayments(
  tx: ContextTransaction,
  options: Readonly<{ partnerId?: string; take?: number }> = {},
): Promise<PlatformPaymentView[]> {
  const rows = await tx.payment.findMany({
    where: options.partnerId ? { partnerId: options.partnerId } : {},
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
    select: {
      id: true,
      partnerId: true,
      organizationId: true,
      kind: true,
      refundOf: true,
      method: true,
      amountCents: true,
      periodStart: true,
      periodEnd: true,
      paidOn: true,
      evidenceMime: true,
      createdAt: true,
    },
  });
  const refundedIds = new Set(
    rows.filter((r) => r.refundOf).map((r) => r.refundOf as string),
  );
  if (rows.some((r) => r.kind === "payment" && !refundedIds.has(r.id))) {
    const refunds = await tx.payment.findMany({
      where: {
        refundOf: {
          in: rows.filter((r) => r.kind === "payment").map((r) => r.id),
        },
      },
      select: { refundOf: true },
    });
    for (const r of refunds) if (r.refundOf) refundedIds.add(r.refundOf);
  }
  return rows.map(({ evidenceMime, ...row }) => ({
    ...row,
    kind: row.kind === "refund" ? "refund" : "payment",
    refunded: refundedIds.has(row.id),
    hasEvidence: Boolean(evidenceMime),
  }));
}

/**
 * Full refund of a manual payment by the platform (decision 2a: the
 * partner's record activates at once; the platform reviews and may refund).
 */
export async function refundPayment(
  tx: ContextTransaction,
  actor: BillingActor,
  paymentId: string,
  reason: string | null,
  now: Date = new Date(),
): Promise<{ outcome: "processed" | "duplicate" | "ignored" }> {
  requireAllowed(canManagePlatformBilling(actor));
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, kind: "payment" },
    select: { id: true, partnerId: true, provider: true, amountCents: true },
  });
  if (!payment) throw billingNotFound();
  if (payment.provider !== "manual") {
    throw invalidBillingInput("Estorno disponível só para pagamentos manuais.");
  }
  await manualProvider.refund(
    { provider: "manual", externalId: payment.id },
    payment.amountCents,
  );
  const result = await ingestProviderEvent(
    tx,
    actor.userId,
    manualProvider.refundEvent({
      partnerId: payment.partnerId,
      paymentId: payment.id,
      reason: reason?.trim().slice(0, 500) || null,
      refundedOn: now,
    }),
    now,
  );
  if (result.outcome === "processed") {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "billing.payment.refund",
      resourceType: "payment",
      resourceId: payment.id,
      result: "success",
      origin: "admin",
      metadata: { target: payment.partnerId, provider: "manual" },
    });
  }
  return { outcome: result.outcome };
}
