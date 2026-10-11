import { getFormatter, getTranslations } from "next-intl/server";

import {
  calendarDateFormatter,
  sectionClass,
} from "@/components/billing/billing-ui";
import type {
  NotificationDeliveryView,
  PayoutReportView,
} from "@/core/billing/operations";

/** Payout reports and notices of the billing jobs (F3c). */

export async function PayoutReportsSection({
  reports,
  showPartner,
}: Readonly<{ reports: readonly PayoutReportView[]; showPartner: boolean }>) {
  const t = await getTranslations("billing.payouts");
  const format = await getFormatter();
  const formatDate = await calendarDateFormatter();
  const money = (cents: number) =>
    format.number(cents / 100, { style: "currency", currency: "BRL" });
  const monthLabel = (date: Date) =>
    format.dateTime(date, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className={sectionClass}>
      <h2 className="text-14 text-text font-semibold">{t("title")}</h2>
      <p className="text-12 text-text-secondary">{t("description")}</p>
      <ul className="divide-border divide-y" data-testid="payout-reports">
        {reports.map((r) => (
          <li key={r.id} className="text-12 text-text-secondary py-2">
            <span className="text-text font-semibold">
              {monthLabel(r.periodStart)}
            </span>
            {showPartner ? ` · ${r.partnerName}` : ""} ·{" "}
            {t("line", {
              payments: r.paymentsCount,
              received: money(r.receivedCents),
              refunded: money(r.refundedCents),
              platform: money(r.platformNetCents),
              partner: money(r.partnerNetCents),
              generated: formatDate(r.generatedAt),
            })}
          </li>
        ))}
        {reports.length === 0 ? (
          <li className="text-12 text-text-secondary py-2">{t("empty")}</li>
        ) : null}
      </ul>
    </section>
  );
}

const NOTICE_KEYS: Record<string, string> = {
  "billing.subscription.past_due": "pastDue",
  "billing.subscription.suspended": "suspended",
};

function deliveryKey(
  status: NotificationDeliveryView["status"],
  reason: string | null,
): string {
  if (status === "skipped" && reason === "no_provider") {
    return "skippedNoProvider";
  }
  return status;
}

export async function NoticesSection({
  notices,
  showPartner,
}: Readonly<{
  notices: readonly NotificationDeliveryView[];
  showPartner: boolean;
}>) {
  const t = await getTranslations("billing.notices");
  const formatDate = await calendarDateFormatter();
  const noticeLabel = (eventType: string) => {
    const key = NOTICE_KEYS[eventType];
    return key ? t(key) : eventType;
  };
  return (
    <section className={sectionClass}>
      <h2 className="text-14 text-text font-semibold">{t("title")}</h2>
      <p className="text-12 text-text-secondary">{t("description")}</p>
      <ul className="divide-border divide-y" data-testid="billing-notices">
        {notices.map((n) => (
          <li key={n.id} className="text-12 text-text-secondary py-2">
            <span className="text-text font-semibold">
              {noticeLabel(n.eventType)}
            </span>
            {showPartner ? ` · ${n.partnerName}` : ""} · {n.subject} ·{" "}
            {t("to", { email: n.recipientEmail })} ·{" "}
            {t(deliveryKey(n.status, n.reason))} · {formatDate(n.createdAt)}
          </li>
        ))}
        {notices.length === 0 ? (
          <li className="text-12 text-text-secondary py-2">{t("empty")}</li>
        ) : null}
      </ul>
    </section>
  );
}
