import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { listPartnerPlans } from "./partner";
import { isSubscriptionStatus, type SubscriptionStatus } from "./subscriptions";

/**
 * Customer side of billing (/app/[slug]/settings/billing, P5m). In the
 * partner pays mode the customer sees only the plan and its state, never
 * checkout, invoices or payments (criterion 9). With the "Ativar checkout"
 * switch on, a demonstration checkout is shown that charges nothing; with
 * it off the server refuses to open one, even on a direct call
 * (criterion 11).
 */

export type WorkspaceBillingView = Readonly<{
  subscription: Readonly<{
    status: SubscriptionStatus;
    planName: string;
    mode: "partner_pays" | "customer_pays";
    billingInterval: string;
    currentPeriodEnd: Date | null;
  }> | null;
  checkoutAvailable: boolean;
  /** Who bills the company: the partner of the host. */
  partnerName: string;
}>;

async function requireBillingViewer(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_SETTINGS_UPDATE,
  );
}

async function partnerCheckout(
  tx: ContextTransaction,
  partnerId: string,
): Promise<{ available: boolean; name: string }> {
  const partner = await tx.partner.findUnique({
    where: { id: partnerId },
    select: { name: true, checkoutEnabled: true, checkoutBlocked: true },
  });
  return {
    available: Boolean(partner?.checkoutEnabled && !partner.checkoutBlocked),
    name: partner?.name ?? "",
  };
}

export async function getWorkspaceBilling(
  tx: ContextTransaction,
  ctx: RequestContext,
  partnerId: string,
): Promise<WorkspaceBillingView> {
  await requireBillingViewer(tx, ctx);
  const [subscription, partner] = await Promise.all([
    tx.subscription.findFirst({
      where: {
        organizationId: ctx.organizationId,
        status: { not: "canceled" },
      },
      select: {
        status: true,
        mode: true,
        billingInterval: true,
        currentPeriodEnd: true,
        planVersion: { select: { plan: { select: { name: true } } } },
      },
    }),
    partnerCheckout(tx, partnerId),
  ]);
  return {
    subscription:
      subscription && isSubscriptionStatus(subscription.status)
        ? {
            status: subscription.status,
            planName: subscription.planVersion.plan.name,
            mode:
              subscription.mode === "customer_pays"
                ? "customer_pays"
                : "partner_pays",
            billingInterval: subscription.billingInterval,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
    checkoutAvailable: partner.available,
    partnerName: partner.name,
  };
}

export function checkoutUnavailable(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Checkout indisponível.",
  });
}

export type DemoCheckoutView = Readonly<{
  demo: true;
  plans: ReadonlyArray<
    Readonly<{
      id: string;
      name: string;
      priceCents: number;
      billingInterval: string;
    }>
  >;
}>;

/** Plans of the partner for the demonstration checkout; nothing is charged. */
export async function openDemoCheckout(
  tx: ContextTransaction,
  ctx: RequestContext,
  partnerId: string,
): Promise<DemoCheckoutView> {
  await requireBillingViewer(tx, ctx);
  if (!(await partnerCheckout(tx, partnerId)).available) {
    throw checkoutUnavailable();
  }
  const plans = await listPartnerPlans(tx, partnerId, { activeOnly: true });
  return {
    demo: true,
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceCents: plan.priceCents,
      billingInterval: plan.billingInterval,
    })),
  };
}

/**
 * "Pays" in the demonstration: validates the switch and the plan and
 * records nothing. The real checkout arrives with the provider (P6).
 */
export async function simulateDemoCheckout(
  tx: ContextTransaction,
  ctx: RequestContext,
  partnerId: string,
  partnerPlanId: string,
): Promise<{ demo: true; charged: false; planName: string }> {
  const checkout = await openDemoCheckout(tx, ctx, partnerId);
  const plan = checkout.plans.find((p) => p.id === partnerPlanId);
  if (!plan) throw checkoutUnavailable();
  return { demo: true, charged: false, planName: plan.name };
}
