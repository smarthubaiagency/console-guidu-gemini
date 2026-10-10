import { randomUUID } from "node:crypto";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { billingNotFound, invalidBillingInput } from "./access";
import type {
  PaymentPaidEvent,
  PaymentRefundedEvent,
  ProviderEvent,
} from "./provider";
import { computeSplit, partnerPaysShares, type Shares } from "./split";
import {
  assertTransition,
  type BillingInterval,
  isSubscriptionStatus,
  nextPeriod,
  statusAfterPayment,
  toDateOnly,
} from "./subscriptions";

/**
 * Ingestion of normalized provider events (especificação de parceiros §3.3).
 * The event is stored with its unique key before any effect; a duplicate
 * finds the key taken and stops there (criterion 5). Effects run in the same
 * transaction as the event row, so a failed effect leaves no event behind.
 * In P5m events come from the manual adapter; webhooks arrive in P6.
 */

export type IngestOutcome = Readonly<{
  outcome: "processed" | "duplicate" | "ignored";
  paymentId: string | null;
}>;

/** What is kept of an event: never the evidence file, never credentials. */
export function eventPayload(event: ProviderEvent): Record<string, unknown> {
  switch (event.type) {
    case "payment.paid":
      return {
        subscriptionId: event.data.subscriptionId,
        amountCents: event.data.amountCents,
        method: event.data.method,
        paidOn: event.data.paidOn.toISOString().slice(0, 10),
      };
    case "payment.refunded":
      return {
        paymentId: event.data.paymentId,
        refundedOn: event.data.refundedOn.toISOString().slice(0, 10),
      };
    default:
      return { ...event.data };
  }
}

export async function ingestProviderEvent(
  tx: ContextTransaction,
  userId: string,
  event: ProviderEvent,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  const eventId = randomUUID();
  const inserted = await tx.$executeRaw`
    insert into public.payment_provider_events
      (id, provider, external_id, event_type, partner_id, payload, recorded_by)
    values
      (${eventId}::uuid, ${event.provider}, ${event.externalId}, ${event.type},
       ${event.partnerId}::uuid, ${JSON.stringify(eventPayload(event))}::jsonb, ${userId}::uuid)
    on conflict (provider, external_id) do nothing
  `;
  if (inserted === 0) return { outcome: "duplicate", paymentId: null };

  let paymentId: string | null = null;
  let status: "processed" | "ignored" = "processed";
  switch (event.type) {
    case "payment.paid":
      paymentId = await applyPaymentPaid(tx, eventId, userId, event, now);
      break;
    case "payment.refunded":
      paymentId = await applyRefund(tx, eventId, userId, event);
      break;
    default:
      // recipient.*, chargeback.* and the rest have effects only in P6.
      status = "ignored";
  }

  await tx.paymentProviderEvent.update({
    where: { id: eventId },
    data: { status, processedAt: now },
    select: { id: true },
  });
  return { outcome: status, paymentId };
}

async function applyPaymentPaid(
  tx: ContextTransaction,
  eventId: string,
  userId: string,
  event: PaymentPaidEvent,
  now: Date,
): Promise<string> {
  const subscription = await tx.subscription.findFirst({
    where: { id: event.data.subscriptionId, partnerId: event.partnerId },
    include: { planVersion: true, splitRule: true },
  });
  if (!subscription || !isSubscriptionStatus(subscription.status)) {
    throw billingNotFound();
  }
  if (subscription.status === "canceled") {
    throw new AppError({
      code: "conflict",
      safeMessage: "A assinatura está cancelada.",
    });
  }
  if (event.data.amountCents !== subscription.amountCents) {
    throw invalidBillingInput(
      "O valor pago precisa ser igual ao valor da assinatura.",
    );
  }

  let shares: Shares;
  if (subscription.mode === "partner_pays") {
    shares = partnerPaysShares(subscription.amountCents);
  } else {
    // The rule frozen in the subscription, not the current one (criterion 6).
    if (!subscription.splitRule) throw billingNotFound();
    shares = computeSplit({
      priceCents: subscription.amountCents,
      minPriceCents: subscription.planVersion.minPriceCents,
      minPlatformShareCents: subscription.planVersion.minPlatformShareCents,
      platformPercentBp: subscription.splitRule.platformPercentBp,
    });
  }

  const period = nextPeriod(
    subscription.billingInterval as BillingInterval,
    subscription.currentPeriodEnd,
    event.data.paidOn,
  );
  const payment = await tx.payment.create({
    data: {
      partnerId: subscription.partnerId,
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      kind: "payment",
      provider: event.provider,
      providerEventId: eventId,
      method: event.data.method,
      amountCents: event.data.amountCents,
      ...shares,
      periodStart: period.start,
      periodEnd: period.end,
      paidOn: toDateOnly(event.data.paidOn),
      note: event.data.note,
      evidence: event.data.evidence
        ? Buffer.from(event.data.evidence.bytes)
        : null,
      evidenceMime: event.data.evidence?.mime ?? null,
      recordedBy: userId,
    },
    select: { id: true },
  });

  const status = statusAfterPayment(period.end, now);
  assertTransition(subscription.status, status);
  await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    },
    select: { id: true },
  });
  return payment.id;
}

async function applyRefund(
  tx: ContextTransaction,
  eventId: string,
  userId: string,
  event: PaymentRefundedEvent,
): Promise<string> {
  const original = await tx.payment.findFirst({
    where: {
      id: event.data.paymentId,
      partnerId: event.partnerId,
      kind: "payment",
    },
    select: {
      id: true,
      partnerId: true,
      organizationId: true,
      subscriptionId: true,
      provider: true,
      method: true,
      amountCents: true,
      platformShareCents: true,
      partnerShareCents: true,
      periodEnd: true,
    },
  });
  if (!original) throw billingNotFound();

  const refund = await tx.payment.create({
    data: {
      partnerId: original.partnerId,
      organizationId: original.organizationId,
      subscriptionId: original.subscriptionId,
      kind: "refund",
      refundOf: original.id,
      provider: original.provider,
      providerEventId: eventId,
      method: original.method,
      amountCents: original.amountCents,
      platformShareCents: original.platformShareCents,
      partnerShareCents: original.partnerShareCents,
      paidOn: toDateOnly(event.data.refundedOn),
      note: event.data.reason,
      recordedBy: userId,
    },
    select: { id: true },
  });

  // Refunding the payment of the current period leaves it unpaid.
  const subscription = await tx.subscription.findUnique({
    where: { id: original.subscriptionId },
    select: { status: true, currentPeriodEnd: true },
  });
  if (
    subscription?.status === "active" &&
    subscription.currentPeriodEnd?.getTime() === original.periodEnd?.getTime()
  ) {
    assertTransition("active", "past_due");
    await tx.subscription.update({
      where: { id: original.subscriptionId },
      data: { status: "past_due" },
      select: { id: true },
    });
  }
  return refund.id;
}
