import { getFormatter, getTranslations } from "next-intl/server";

import {
  type SubscriptionStatus,
  statusKey,
} from "@/core/billing/subscriptions";

/** Visual helpers shared by the billing pages (P5m). */

const TONES: Record<SubscriptionStatus, string> = {
  pending: "bg-info-bg text-info-text border-info-border",
  active: "bg-success-bg text-success-text border-success-border",
  past_due: "bg-warning-bg text-warning-text border-warning-border",
  suspended: "bg-danger-bg text-danger-text border-danger-border",
  canceled: "border-border text-text-secondary",
};

export async function SubscriptionBadge({
  status,
}: Readonly<{ status: SubscriptionStatus }>) {
  const t = await getTranslations("billing");
  return (
    <span
      className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${TONES[status]}`}
      data-testid="subscription-status"
    >
      {t(`status.${statusKey(status)}`)}
    </span>
  );
}

/** Values the Commercial team has not confirmed yet (D-PA-11). */
export async function ProvisionalBadge() {
  const t = await getTranslations("billing");
  return (
    <span className="bg-warning-bg text-warning-text border-warning-border text-11 rounded-full border px-2 py-0.5 font-semibold">
      {t("provisional")}
    </span>
  );
}

/** Calendar dates are stored at midnight UTC. */
export function formatDate(date: Date | null | undefined): string {
  return date ? date.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
}

/** formatDate in the request language. */
export async function calendarDateFormatter(): Promise<
  (date: Date | null | undefined) => string
> {
  const format = await getFormatter();
  return (date) =>
    date ? format.dateTime(date, { dateStyle: "short", timeZone: "UTC" }) : "—";
}

/** Cents as BRL in the request language (the currency stays BRL). */
export async function centsFormatter(): Promise<(cents: number) => string> {
  const format = await getFormatter();
  return (cents) =>
    format.number(cents / 100, { style: "currency", currency: "BRL" });
}

/** Today in the yyyy-mm-dd form of date inputs. */
export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Cents as the "99,90" text the reais inputs accept. */
export function centsInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Portuguese label; see billingLabels for the request language. */
export function intervalLabel(interval: string): string {
  return interval === "yearly" ? "ano" : "mês";
}

export const METHOD_LABELS: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transfer: "Transferência",
  card: "Cartão",
  other: "Outro",
};

const METHOD_KEYS = new Set(Object.keys(METHOD_LABELS));

/** intervalLabel and METHOD_LABELS in the request language (I3). */
export async function billingLabels(): Promise<{
  interval: (interval: string) => string;
  method: (method: string) => string;
}> {
  const t = await getTranslations("billing.labels");
  return {
    interval: (interval) => t(interval === "yearly" ? "year" : "month"),
    method: (method) =>
      METHOD_KEYS.has(method) ? t(`methods.${method}`) : method,
  };
}

export const sectionClass =
  "border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs";
