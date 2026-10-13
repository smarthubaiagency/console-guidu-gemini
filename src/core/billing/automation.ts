import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { appConfig } from "@/core/config/app";
import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import { notificationLanguages } from "@/core/notifications/language";
import { deliverNotification } from "@/core/notifications/delivery";
import type { NotificationLanguage } from "@/core/notifications/notify";
import { getNotificationTransport } from "@/core/notifications/transport";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
} from "@/core/notifications/types";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { partnerHostOrigin } from "@/core/partners/hosts";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { toDateOnly } from "./subscriptions";

/**
 * Billing in jobs (F3c, plano F3 decision 4, D-PA-13):
 *
 * - Daily: an active subscription whose period ended `pastDueAfterDays` ago
 *   goes to "em atraso"; one in arrears `suspendAfterDays` after that goes to
 *   "suspensa". Both terms live in `billing_settings` (provisional). Each run
 *   moves a subscription one step at most, so the partner always hears
 *   about the arrears before a suspension.
 * - Only the partner is notified (billing e-mail, else its owners), through
 *   the notification port; each delivery is recorded once per key, as
 *   "não enviada" while there is no e-mail provider (D-PA-08).
 * - Monthly: payout report per partner for the closed month.
 *
 * Both jobs run as app_worker (no user), with the narrow policies of the
 * F3c migration, and are safe to run again: a repeated date or month has no
 * further effect.
 */

export type BillingTerms = Readonly<{
  pastDueAfterDays: number;
  suspendAfterDays: number;
}>;

export const DEFAULT_BILLING_TERMS: BillingTerms = {
  pastDueAfterDays: 3,
  suspendAfterDays: 7,
};

const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(toDateOnly(date).getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of a UTC calendar date. */
export function isoDate(date: Date): string {
  return toDateOnly(date).toISOString().slice(0, 10);
}

/** Day the subscription becomes past due and day it is suspended. */
export function overdueSchedule(
  periodEnd: Date,
  terms: BillingTerms,
): { pastDueOn: Date; suspendOn: Date } {
  const pastDueOn = addDays(periodEnd, terms.pastDueAfterDays);
  return { pastDueOn, suspendOn: addDays(pastDueOn, terms.suspendAfterDays) };
}

/** Next automatic status of a subscription on `today`, if any. */
export function transitionFor(
  subscription: Readonly<{ status: string; currentPeriodEnd: Date | null }>,
  today: Date,
  terms: BillingTerms,
): "past_due" | "suspended" | null {
  if (!subscription.currentPeriodEnd) return null;
  const day = toDateOnly(today);
  const { pastDueOn, suspendOn } = overdueSchedule(
    subscription.currentPeriodEnd,
    terms,
  );
  if (subscription.status === "active" && day >= pastDueOn) return "past_due";
  if (subscription.status === "past_due" && day >= suspendOn) {
    return "suspended";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Daily transitions
// ---------------------------------------------------------------------------

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export async function readBillingTerms(
  tx: ContextTransaction,
): Promise<BillingTerms> {
  const row = await tx.billingSettings.findUnique({
    where: { id: 1 },
    select: { pastDueAfterDays: true, suspendAfterDays: true },
  });
  return row ?? DEFAULT_BILLING_TERMS;
}

type Recipient = Readonly<{
  partnerName: string;
  emails: readonly string[];
  billingUrl: string;
}>;

async function partnerRecipient(
  tx: ContextTransaction,
  partnerId: string,
): Promise<Recipient | null> {
  const [partner, profile, owners, domains] = await Promise.all([
    tx.partner.findUnique({
      where: { id: partnerId },
      select: { name: true, isHouse: true },
    }),
    tx.partnerBillingProfile.findUnique({
      where: { partnerId },
      select: { billingEmail: true },
    }),
    // Raw: the worker reads only these columns of partner_members.
    tx.$queryRaw<{ email: string }[]>`
      select email from public.partner_members
      where partner_id = ${partnerId}::uuid and role = 'partner_owner' and status = 'active'
      order by created_at
    `,
    tx.partnerDomain.findMany({
      where: { partnerId, status: "active" },
      orderBy: { host: "asc" },
      select: { host: true, kind: true },
    }),
  ]);
  if (!partner) return null;
  const emails = profile
    ? [profile.billingEmail]
    : owners.map((owner) => owner.email);
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  // The partner console of its own domain (custom first); the platform
  // host for the house partner or a partner still without a domain.
  const domain = domains.find((d) => d.kind === "custom") ?? domains[0] ?? null;
  const origin =
    partner.isHouse || partnerId === HOUSE_PARTNER_ID || !domain
      ? appConfig.url
      : partnerHostOrigin(domain.host, process.env);
  return {
    partnerName: partner.name,
    emails: unique.filter((e) => e.length > 0),
    billingUrl: new URL("/admin/billing", origin).toString(),
  };
}

function platformBrand(): NotificationBrand {
  return { name: appConfig.name, supportEmail: null, supportUrl: null };
}

export type DailyTransitionsResult = Readonly<{
  date: string;
  pastDue: number;
  suspended: number;
  notices: number;
}>;

export async function runDailyTransitions(
  tx: ContextTransaction,
  date: string,
  transport: NotificationTransport = getNotificationTransport(),
): Promise<DailyTransitionsResult> {
  const today = parseDate(date);
  const terms = await readBillingTerms(tx);
  const candidates = await tx.subscription.findMany({
    where: {
      status: { in: ["active", "past_due"] },
      currentPeriodEnd: { lte: addDays(today, -terms.pastDueAfterDays) },
    },
    orderBy: { currentPeriodEnd: "asc" },
    select: {
      id: true,
      partnerId: true,
      organizationId: true,
      status: true,
      currentPeriodEnd: true,
    },
  });

  const recipients = new Map<string, Recipient | null>();
  const languageOf = notificationLanguages(tx);
  const organizationNames = new Map<string, string>();
  let pastDue = 0;
  let suspended = 0;
  let notices = 0;

  for (const subscription of candidates) {
    const to = transitionFor(subscription, today, terms);
    if (!to || !subscription.currentPeriodEnd) continue;
    // Only from the status read: a payment recorded meanwhile wins.
    const changed = await tx.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: to },
    });
    if (changed.count === 0) continue;
    if (to === "past_due") pastDue += 1;
    else suspended += 1;

    await recordAudit(
      tx,
      {
        userId: "",
        workspaceId: "",
        organizationId: "",
        principalType: "service",
      },
      {
        action: "billing.subscription.status",
        resourceType: "subscription",
        resourceId: subscription.id,
        result: "success",
        origin: "worker",
        metadata: {
          target: subscription.organizationId,
          from: subscription.status,
          to,
          reason: "overdue",
        },
      },
    );

    if (!recipients.has(subscription.partnerId)) {
      recipients.set(
        subscription.partnerId,
        await partnerRecipient(tx, subscription.partnerId),
      );
    }
    const recipient = recipients.get(subscription.partnerId);
    if (!recipient) continue;
    if (!organizationNames.has(subscription.organizationId)) {
      const organization = await tx.organization.findUnique({
        where: { id: subscription.organizationId },
        select: { name: true },
      });
      organizationNames.set(
        subscription.organizationId,
        organization?.name ?? "Cliente",
      );
    }
    const periodEnd = toDateOnly(subscription.currentPeriodEnd);
    const { suspendOn } = overdueSchedule(periodEnd, terms);
    for (const email of recipient.emails) {
      notices += await deliver(
        tx,
        transport,
        await languageOf(email),
        {
          type:
            to === "past_due"
              ? "billing.subscription.past_due"
              : "billing.subscription.suspended",
          recipientEmail: email,
          idempotencyKey: `subscription:${subscription.id}:${to}:${isoDate(periodEnd)}:${email}`,
          data: {
            partnerName: recipient.partnerName,
            organizationName:
              organizationNames.get(subscription.organizationId) ?? "Cliente",
            periodEnd,
            nextStepOn: to === "past_due" ? suspendOn : null,
            billingUrl: recipient.billingUrl,
          },
        },
        subscription.partnerId,
        subscription.id,
      );
    }
  }
  return { date, pastDue, suspended, notices };
}

async function deliver(
  tx: ContextTransaction,
  transport: NotificationTransport,
  language: NotificationLanguage,
  event: NotificationEvent,
  partnerId: string,
  relatedId: string,
): Promise<number> {
  return deliverNotification(tx, {
    transport,
    language,
    event,
    brand: platformBrand(),
    partnerId,
    relatedId,
  });
}

export const dailyTransitionsJob = definePlatformJob({
  kind: "billing.daily-transitions",
  description:
    "Marca assinaturas em atraso e suspensas pelos prazos e avisa o parceiro.",
  payload: z.object({ date: DATE }),
  maxAttempts: 5,
  retryDelaySeconds: 60,
  async run(tx, payload) {
    return runDailyTransitions(tx, payload.date);
  },
});

// ---------------------------------------------------------------------------
// Payout report
// ---------------------------------------------------------------------------

export function monthBounds(month: string): { start: Date; end: Date } {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, m - 1, 1)),
    end: new Date(Date.UTC(year, m, 1)),
  };
}

/** `YYYY-MM` of the month before the one of `date` (UTC). */
export function previousMonth(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
  );
  return d.toISOString().slice(0, 7);
}

export type PayoutReportResult = Readonly<{
  month: string;
  partners: number;
  created: number;
}>;

/**
 * Totals per partner of the payments and refunds dated in the month. A
 * report already generated for a partner and month is kept as it is.
 */
export async function runPayoutReport(
  tx: ContextTransaction,
  month: string,
): Promise<PayoutReportResult> {
  const { start, end } = monthBounds(month);
  const sums = await tx.payment.groupBy({
    by: ["partnerId", "kind"],
    where: { paidOn: { gte: start, lt: end } },
    _sum: {
      amountCents: true,
      platformShareCents: true,
      partnerShareCents: true,
    },
    _count: { _all: true },
  });
  const partnerIds = [...new Set(sums.map((s) => s.partnerId))].sort();
  const rows = partnerIds.map((partnerId) => {
    const paid = sums.find(
      (s) => s.partnerId === partnerId && s.kind === "payment",
    );
    const refunded = sums.find(
      (s) => s.partnerId === partnerId && s.kind === "refund",
    );
    return {
      partnerId,
      periodStart: start,
      periodEnd: end,
      paymentsCount: paid?._count._all ?? 0,
      receivedCents: paid?._sum.amountCents ?? 0,
      refundedCents: refunded?._sum.amountCents ?? 0,
      platformNetCents:
        (paid?._sum.platformShareCents ?? 0) -
        (refunded?._sum.platformShareCents ?? 0),
      partnerNetCents:
        (paid?._sum.partnerShareCents ?? 0) -
        (refunded?._sum.partnerShareCents ?? 0),
    };
  });
  const created =
    rows.length > 0
      ? (await tx.payoutReport.createMany({ data: rows, skipDuplicates: true }))
          .count
      : 0;
  return { month, partners: rows.length, created };
}

export const payoutReportJob = definePlatformJob({
  kind: "billing.payout-report",
  description: "Gera o relatório de repasse do mês fechado por parceiro.",
  payload: z.object({ month: MONTH }),
  maxAttempts: 5,
  retryDelaySeconds: 60,
  async run(tx, payload) {
    return runPayoutReport(tx, payload.month);
  },
});

// ---------------------------------------------------------------------------
// Registry and schedules
// ---------------------------------------------------------------------------

/** Hour (UTC) after which the day's transitions run: 06:00 in Brasília. */
export const DAILY_RUN_HOUR_UTC = 9;

export const billingSchedules: readonly JobSchedule[] = [
  {
    kind: dailyTransitionsJob.kind,
    description: "Diária, a partir das 06:00 (Brasília).",
    due(now) {
      if (now.getUTCHours() < DAILY_RUN_HOUR_UTC) return null;
      const date = isoDate(now);
      return { key: date, payload: { date } };
    },
  },
  {
    kind: payoutReportJob.kind,
    description: "Mensal, do mês anterior, a partir do dia 1.",
    due(now) {
      const month = previousMonth(now);
      return { key: month, payload: { month } };
    },
  },
];

export const billingJobs = [dailyTransitionsJob, payoutReportJob] as const;
