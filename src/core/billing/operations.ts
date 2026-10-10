import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import {
  type BillingActor,
  canManagePlatformBilling,
  canReadPartnerBilling,
  canReadPlatformBilling,
  invalidBillingInput,
  requireAllowed,
} from "./access";
import { DEFAULT_BILLING_TERMS } from "./automation";

/**
 * What the billing jobs of F3c leave for people (plano F3, decision 4): the
 * provisional terms, edited by platform billing; the notices recorded for a
 * partner; and the monthly payout reports. RLS repeats every check.
 */

export type BillingTermsView = Readonly<{
  pastDueAfterDays: number;
  suspendAfterDays: number;
  provisional: boolean;
  updatedAt: Date | null;
}>;

export async function getBillingTerms(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<BillingTermsView> {
  requireAllowed(canReadPlatformBilling(actor) || canReadPartnerBilling(actor));
  const row = await tx.billingSettings.findUnique({
    where: { id: 1 },
    select: {
      pastDueAfterDays: true,
      suspendAfterDays: true,
      provisional: true,
      updatedAt: true,
    },
  });
  return (
    row ?? { ...DEFAULT_BILLING_TERMS, provisional: true, updatedAt: null }
  );
}

const TermsSchema = z.object({
  pastDueAfterDays: z.coerce
    .number()
    .int("Use dias inteiros.")
    .min(0, "A tolerância vai de 0 a 60 dias.")
    .max(60, "A tolerância vai de 0 a 60 dias."),
  suspendAfterDays: z.coerce
    .number()
    .int("Use dias inteiros.")
    .min(1, "A carência vai de 1 a 90 dias.")
    .max(90, "A carência vai de 1 a 90 dias."),
  provisional: z.boolean(),
});

export type BillingTermsInput = z.input<typeof TermsSchema>;

/** Applies from the next daily run; past changes are not redone. */
export async function updateBillingTerms(
  tx: ContextTransaction,
  actor: BillingActor,
  input: BillingTermsInput,
): Promise<void> {
  requireAllowed(canManagePlatformBilling(actor));
  const parsed = TermsSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBillingInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const before = await getBillingTerms(tx, actor);
  await tx.billingSettings.update({
    where: { id: 1 },
    data: { ...parsed.data, updatedBy: actor.userId },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.terms.update",
    resourceType: "billing_settings",
    resourceId: "1",
    result: "success",
    origin: "admin",
    metadata: {
      from: `${before.pastDueAfterDays}+${before.suspendAfterDays}`,
      to: `${parsed.data.pastDueAfterDays}+${parsed.data.suspendAfterDays}`,
      status: parsed.data.provisional ? "provisional" : "final",
    },
  });
}

export type PayoutReportView = Readonly<{
  id: string;
  partnerId: string;
  partnerName: string;
  periodStart: Date;
  periodEnd: Date;
  paymentsCount: number;
  receivedCents: number;
  refundedCents: number;
  platformNetCents: number;
  partnerNetCents: number;
  generatedAt: Date;
}>;

/** Platform: every partner; partner: its own (`partnerId`). */
export async function listPayoutReports(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string | null,
  take = 60,
): Promise<PayoutReportView[]> {
  requireAllowed(
    partnerId ? canReadPartnerBilling(actor) : canReadPlatformBilling(actor),
  );
  const rows = await tx.payoutReport.findMany({
    where: partnerId ? { partnerId } : {},
    orderBy: [{ periodStart: "desc" }, { partnerId: "asc" }],
    take,
  });
  const names = await partnerNames(
    tx,
    rows.map((r) => r.partnerId),
  );
  return rows.map((row) => ({
    ...row,
    partnerName: names.get(row.partnerId) ?? "—",
  }));
}

export type NotificationDeliveryView = Readonly<{
  id: string;
  partnerId: string;
  partnerName: string;
  eventType: string;
  recipientEmail: string;
  subject: string;
  status: "pending" | "sent" | "skipped" | "failed";
  reason: string | null;
  createdAt: Date;
}>;

export async function listNotificationDeliveries(
  tx: ContextTransaction,
  actor: BillingActor,
  partnerId: string | null,
  take = 50,
): Promise<NotificationDeliveryView[]> {
  requireAllowed(
    partnerId ? canReadPartnerBilling(actor) : canReadPlatformBilling(actor),
  );
  const rows = await tx.notificationDelivery.findMany({
    where: partnerId ? { partnerId } : {},
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      partnerId: true,
      eventType: true,
      recipientEmail: true,
      subject: true,
      status: true,
      reason: true,
      createdAt: true,
    },
  });
  const names = await partnerNames(
    tx,
    rows.map((r) => r.partnerId),
  );
  return rows.map((row) => ({
    ...row,
    status:
      (["pending", "sent", "skipped", "failed"] as const).find(
        (s) => s === row.status,
      ) ?? "pending",
    partnerName: names.get(row.partnerId) ?? "—",
  }));
}

export function deliveryStatusLabel(
  status: NotificationDeliveryView["status"],
  reason: string | null,
): string {
  switch (status) {
    case "sent":
      return "Enviado";
    case "skipped":
      return reason === "no_provider"
        ? "Não enviado (envio desligado)"
        : "Não enviado";
    case "failed":
      return "Falhou";
    case "pending":
      return "Pendente";
  }
}

export function noticeLabel(eventType: string): string {
  switch (eventType) {
    case "billing.subscription.past_due":
      return "Assinatura em atraso";
    case "billing.subscription.suspended":
      return "Assinatura suspensa";
    default:
      return eventType;
  }
}

async function partnerNames(
  tx: ContextTransaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const partners = await tx.partner.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(partners.map((p) => [p.id, p.name]));
}
