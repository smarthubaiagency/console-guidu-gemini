import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import type { LeadNoticeDto } from "@/modules/ai-agents/server/services/notices";

const STATUS_BADGE = {
  sent: "default",
  pending: "secondary",
  failed: "destructive",
  skipped: "outline",
} as const;

const REASONS = new Set([
  "no_webhook",
  "no_owner_phone",
  "email_provider_pending",
  "sms_unavailable",
  "no_contact",
  "invalid_config",
]);

/**
 * Avisos de lead of a GUIDS (A6a): the hot leads told to the merchant,
 * newest first, with the channel and whether the notice got out.
 */
export async function GuidNotices({
  notices,
}: Readonly<{ notices: readonly LeadNoticeDto[] }>) {
  const t = await getTranslations("aiAgents.guids.notices");
  const format = await getFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  const reason = (code: string | null) =>
    code === null
      ? null
      : REASONS.has(code)
        ? t(`reasons.${code}`)
        : t("reasons.delivery", { code });
  return (
    <section className="space-y-2" data-testid="guid-notices">
      <div className="space-y-1">
        <h3 className="text-12 text-text font-medium">{t("title")}</h3>
        <p className="text-11 text-text-secondary">{t("description")}</p>
      </div>
      {notices.length === 0 ? (
        <p className="text-12 text-text-secondary">{t("empty")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {notices.map((notice) => (
            <li
              key={notice.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-testid="guid-notice"
            >
              <span className="text-12 text-text-secondary">
                <span className="text-text font-medium">
                  {notice.contactName ?? t("unknownContact")}
                </span>
                {" · "}
                {t("score", { points: notice.points })}
                {" · "}
                {t(`channels.${notice.channel}`)}
                {" · "}
                {when(notice.sentAt ?? notice.createdAt)}
                {reason(notice.reason) ? ` · ${reason(notice.reason)}` : null}
              </span>
              <Badge
                variant={
                  STATUS_BADGE[notice.status as keyof typeof STATUS_BADGE] ??
                  "secondary"
                }
                data-testid="guid-notice-status"
              >
                {t(`status.${notice.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
