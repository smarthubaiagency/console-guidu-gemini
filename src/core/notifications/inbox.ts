import { Prisma } from "@prisma/client";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  canChangePersonChannel,
  notificationEventDefinition,
  resolveChannels,
  type ChannelPreference,
  type NotificationChannel,
} from "./channels";
import {
  inboxNotice,
  type InboxNotice,
  type NotificationContent,
} from "./inbox-content";

/**
 * Notices of the bell and notification preferences (CF3c).
 *
 * - The worker (app_worker) posts notices to a person it knows, after
 *   reading their preferences, and to the active owners of a partner
 *   through `private.post_partner_notice` (it never reads who they are).
 * - The dashboard (app_runtime, `withIdentityContext`) lists, marks as read
 *   and sets preferences. RLS limits every query to the person of the
 *   request; the queries also name that person, so a connection that
 *   bypasses RLS (the e2e database) still shows each person only theirs.
 */

/** Preferences of a person for an event (worker; the person's own on the dashboard). */
export async function preferencesOf(
  tx: ContextTransaction,
  userId: string,
  eventType: string,
): Promise<ChannelPreference[]> {
  return tx.notificationPreference.findMany({
    where: { userId, eventType },
    select: { eventType: true, channel: true, enabled: true },
  });
}

/**
 * The channels an event reaches for a person (null: an address with no
 * known person, which keeps every channel the event has).
 */
export async function channelsFor(
  tx: ContextTransaction,
  userId: string | null,
  eventType: string,
): Promise<ReadonlySet<NotificationChannel>> {
  const definition = notificationEventDefinition(eventType);
  return resolveChannels(
    definition,
    userId && definition && !definition.essential
      ? await preferencesOf(tx, userId, eventType)
      : [],
  );
}

/**
 * Posts the event to the bell of a person, when the event has the bell and
 * the person keeps it on; 1 when a notice was new.
 */
export async function postToBell(
  tx: ContextTransaction,
  userId: string,
  content: NotificationContent,
  idempotencyKey: string,
): Promise<number> {
  const notice = inboxNotice(content);
  if (!notice) return 0;
  if (!(await channelsFor(tx, userId, content.type)).has("app")) return 0;
  return postNotice(tx, { userId, notice, idempotencyKey });
}

/** Posts a notice to one person; 1 when new, 0 for a repeated key. */
export async function postNotice(
  tx: ContextTransaction,
  args: Readonly<{
    userId: string;
    notice: InboxNotice;
    idempotencyKey: string;
    /** The Event Hub event of the notice (H2), for its trace. */
    eventId?: string | null;
  }>,
): Promise<number> {
  return tx.$executeRaw`
    insert into public.user_notifications
      (user_id, event_type, data, link_url, idempotency_key, event_id)
    values (${args.userId}::uuid, ${args.notice.eventType},
            ${JSON.stringify(args.notice.data)}::jsonb, ${args.notice.linkUrl},
            ${args.idempotencyKey}, ${args.eventId ?? null}::uuid)
    on conflict (idempotency_key) do nothing
  `;
}

/**
 * Posts a partner's notice to the bell of its active owners (billing);
 * returns how many notices were new. The key gets each owner's id.
 */
export async function postPartnerNotice(
  tx: ContextTransaction,
  args: Readonly<{
    partnerId: string;
    notice: InboxNotice;
    idempotencyKey: string;
  }>,
): Promise<number> {
  const essential =
    notificationEventDefinition(args.notice.eventType)?.essential ?? true;
  const rows = await tx.$queryRaw<{ posted: number }[]>`
    select private.post_partner_notice(
      ${args.partnerId}::uuid, ${args.notice.eventType},
      ${JSON.stringify(args.notice.data)}::jsonb, ${args.notice.linkUrl},
      ${args.idempotencyKey}, ${essential}
    ) as posted
  `;
  return Number(rows[0]?.posted ?? 0);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const INBOX_LIMIT = 20;

export type InboxRow = Readonly<{
  id: string;
  eventType: string;
  data: Prisma.JsonValue;
  linkUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}>;

/** The latest notices of the person and how many are unread. */
export async function readInbox(
  tx: ContextTransaction,
  userId: string,
  limit: number = INBOX_LIMIT,
): Promise<Readonly<{ unread: number; items: InboxRow[] }>> {
  const [unread, items] = await Promise.all([
    tx.userNotification.count({ where: { userId, readAt: null } }),
    tx.userNotification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        eventType: true,
        data: true,
        linkUrl: true,
        readAt: true,
        createdAt: true,
      },
    }),
  ]);
  return { unread, items };
}

/** Marks one notice as read; false when it is not the person's. */
export async function markNoticeRead(
  tx: ContextTransaction,
  userId: string,
  id: string,
): Promise<boolean> {
  const updated = await tx.userNotification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count > 0) return true;
  // Already read is fine; someone else's (or none) is not found.
  return (await tx.userNotification.count({ where: { id, userId } })) > 0;
}

/** Marks every unread notice of the person as read; returns how many. */
export async function markAllNoticesRead(
  tx: ContextTransaction,
  userId: string,
): Promise<number> {
  const updated = await tx.userNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count;
}

/** The person's own preference rows. */
export async function myPreferences(
  tx: ContextTransaction,
  userId: string,
): Promise<ChannelPreference[]> {
  return tx.notificationPreference.findMany({
    where: { userId },
    select: { eventType: true, channel: true, enabled: true },
  });
}

/**
 * Turns a channel of an optional event on or off for the person. On is the
 * default, so it removes the row. Essential events and channels the event
 * does not have are refused.
 */
export async function saveMyPreference(
  tx: ContextTransaction,
  userId: string,
  input: Readonly<{ eventType: string; channel: string; enabled: boolean }>,
): Promise<void> {
  // H2: the WhatsApp column and the hub's other notices.
  const definition = canChangePersonChannel(input.eventType, input.channel)
    ? { type: input.eventType }
    : null;
  if (!definition) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Este aviso é obrigatório e não pode ser desligado.",
      messageKey: "notificationCenter.preferences.errors.locked",
    });
  }
  const where = {
    userId_eventType_channel: {
      userId,
      eventType: definition.type,
      channel: input.channel,
    },
  };
  if (input.enabled) {
    await tx.notificationPreference.deleteMany({
      where: { userId, eventType: definition.type, channel: input.channel },
    });
    return;
  }
  await tx.notificationPreference.upsert({
    where,
    create: {
      userId,
      eventType: definition.type,
      channel: input.channel,
      enabled: false,
    },
    update: { enabled: false },
  });
}
