import "server-only";

import { getFormatter, getTranslations } from "next-intl/server";

import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { appLog } from "@/lib/telemetry/log";

import { INBOX_LIMIT, readInbox } from "./inbox";
import { renderInboxNotice } from "./inbox-content";
import { isHttpUrl } from "./markup";

/** A notice of the bell, already written in the reader's language. */
export type BellNotice = Readonly<{
  id: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  /** When it arrived, formatted for the reader. */
  when: string;
  createdAt: string;
}>;

export type BellLabels = Readonly<{
  label: string;
  labelUnread: string;
  title: string;
  empty: string;
  markRead: string;
  markAllRead: string;
  preferences: string;
  more: string;
}>;

export type NotificationBellData = Readonly<{
  unread: number;
  notices: readonly BellNotice[];
  /** More notices exist than the bell shows. */
  truncated: boolean;
  labels: BellLabels;
}>;

/**
 * The bell of the header (CF3c) for the signed-in person: the latest
 * notices, written on the server in the reader's language (the
 * `notificationCenter` messages stay out of the browser), and the unread
 * count. A failure to read leaves an empty bell instead of breaking the
 * shell; the error is logged.
 */
export async function loadNotificationBell(
  userId: string,
): Promise<NotificationBellData> {
  const t = await getTranslations("notificationCenter");
  const format = await getFormatter();
  let unread = 0;
  let notices: BellNotice[] = [];
  let truncated = false;
  try {
    const inbox = await withIdentityContext(prisma, userId, (tx) =>
      readInbox(tx, userId, INBOX_LIMIT + 1),
    );
    unread = inbox.unread;
    truncated = inbox.items.length > INBOX_LIMIT;
    notices = inbox.items.slice(0, INBOX_LIMIT).map((row) => {
      const text = renderInboxNotice(
        row,
        (key, values) => t(`events.${key}`, values),
        (value, withTime) =>
          format.dateTime(
            value,
            withTime
              ? { dateStyle: "short", timeStyle: "short" }
              : { dateStyle: "short", timeZone: "UTC" },
          ),
      );
      return {
        id: row.id,
        title: text.title,
        body: text.body,
        href: row.linkUrl && isHttpUrl(row.linkUrl) ? row.linkUrl : null,
        read: row.readAt !== null,
        when: format.relativeTime(row.createdAt),
        createdAt: row.createdAt.toISOString(),
      };
    });
  } catch (error) {
    appLog.warn("notifications.bell_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
  return {
    unread,
    notices,
    truncated,
    labels: {
      label: t("bell.label"),
      labelUnread: t("bell.labelUnread", { count: unread }),
      title: t("bell.title"),
      empty: t("bell.empty"),
      markRead: t("bell.markRead"),
      markAllRead: t("bell.markAllRead"),
      preferences: t("bell.preferences"),
      more: t("bell.more", { count: INBOX_LIMIT }),
    },
  };
}
