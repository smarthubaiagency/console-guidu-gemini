import { AppError } from "@/shared/errors";

/**
 * Subscription state machine (Especificação §18; partners §3.1). Applied at
 * the moment of each action, without jobs (P5m): a recorded payment
 * activates, the partner or the platform marks arrears, suspension and
 * cancellation. Mirrored by the `subscriptions_guard_update` trigger.
 */

export const SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "past_due",
  "suspended",
  "canceled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type BillingInterval = "monthly" | "yearly";

const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  pending: ["active", "past_due", "canceled"],
  active: ["past_due", "suspended", "canceled"],
  past_due: ["active", "suspended", "canceled"],
  suspended: ["active", "past_due", "canceled"],
  canceled: [],
};

/** Manual marks; `active` only comes from a payment. */
export const MANUAL_STATUS_TARGETS = [
  "past_due",
  "suspended",
  "canceled",
] as const satisfies readonly SubscriptionStatus[];

export type ManualStatusTarget = (typeof MANUAL_STATUS_TARGETS)[number];

export function isSubscriptionStatus(
  value: string,
): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppError({
      code: "conflict",
      safeMessage: `A assinatura não pode passar de "${statusLabel(from)}" para "${statusLabel(to)}".`,
    });
  }
}

export function statusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case "pending":
      return "Aguardando pagamento";
    case "active":
      return "Ativa";
    case "past_due":
      return "Em atraso";
    case "suspended":
      return "Suspensa";
    case "canceled":
      return "Cancelada";
  }
}

// ---------------------------------------------------------------------------
// Periods (calendar dates in UTC)
// ---------------------------------------------------------------------------

/** Midnight UTC of the calendar date of `date`. */
export function toDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Adds months keeping the day, clamped to the end of the month. */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

export function addInterval(date: Date, interval: BillingInterval): Date {
  return addMonths(date, interval === "yearly" ? 12 : 1);
}

/**
 * The period a payment covers: it continues the current period without
 * gaps; the first payment starts on the day it was paid.
 */
export function nextPeriod(
  interval: BillingInterval,
  currentPeriodEnd: Date | null,
  paidOn: Date,
): { start: Date; end: Date } {
  const start = toDateOnly(currentPeriodEnd ?? paidOn);
  return { start, end: addInterval(start, interval) };
}

/** After a payment: active while the paid period has not ended yet. */
export function statusAfterPayment(
  periodEnd: Date,
  today: Date,
): "active" | "past_due" {
  return toDateOnly(periodEnd) > toDateOnly(today) ? "active" : "past_due";
}
