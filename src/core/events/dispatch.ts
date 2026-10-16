import "server-only";

import { z } from "zod";

import {
  LEAD_NOTICE_EVENT_TYPES,
  recordLeadNoticeOutcome,
} from "@/core/ai/notices/hub";
import type { ChannelFetch } from "@/core/channels/http";
import { appConfig } from "@/core/config/app";
import { definePlatformJob } from "@/core/jobs/definition";
import { deliverNotification } from "@/core/notifications/delivery";
import { postNotice, preferencesOf } from "@/core/notifications/inbox";
import {
  inboxNotice,
  type InboxNotice,
  type NotificationContent,
} from "@/core/notifications/inbox-content";
import { notificationLanguages } from "@/core/notifications/language";
import { isHttpUrl } from "@/core/notifications/markup";
import { getNotificationTransport } from "@/core/notifications/transport";
import type {
  NotificationBrand,
  NotificationTransport,
} from "@/core/notifications/types";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import {
  type EventChannel,
  type EventDefinition,
  eventDefinition,
} from "./catalog";
import { EVENTS_DISPATCH_JOB_KIND } from "./emit";
import { deliverWhatsApp } from "./whatsapp";

/**
 * Destination `notify` of the Event Hub (H1): the job `events.dispatch`
 * (platform, app_worker) tells the event's recipients on the channels its
 * type has. Who: `private.event_recipients` by the route (the worker never
 * reads members itself). Each person's preferences apply, except for
 * essential events. Channels:
 * - e-mail through `deliverNotification` (template, sender, language) and
 *   the bell with it when the person is known;
 * - the bell alone when there is no e-mail;
 * - WhatsApp by the partner's webhook (`whatsapp.ts`).
 * Every delivery keeps the event's id. The keys of the deliveries are the
 * event's key plus the address (or `user:<id>`, or `whatsapp`), so running
 * again is a no-op.
 */

export type DispatchDeps = Readonly<{
  transport?: NotificationTransport;
  fetch?: ChannelFetch;
  now?: () => Date;
}>;

export type DispatchResult = Readonly<{
  status: "dispatched" | "done" | "skipped";
  /** New e-mail deliveries. */
  notices: number;
  /** New bell notices without an e-mail. */
  bell: number;
  whatsapp: string | null;
}>;

type EventRow = Readonly<{
  id: string;
  type: string;
  route: string;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  subject_id: string | null;
  data: Record<string, unknown>;
  idempotency_key: string;
  dispatched_at: Date | null;
}>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

function day(value: unknown): Date {
  const raw = str(value);
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw,
  );
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * The content of an event with an e-mail template, from its data (the
 * emitter wrote `content.data` with dates as ISO text).
 */
export function notificationContentOf(
  type: string,
  data: Readonly<Record<string, unknown>>,
): NotificationContent | null {
  switch (type) {
    case "billing.subscription.past_due":
    case "billing.subscription.suspended":
      return {
        type,
        data: {
          partnerName: str(data.partnerName),
          organizationName: str(data.organizationName),
          periodEnd: day(data.periodEnd),
          nextStepOn: data.nextStepOn ? day(data.nextStepOn) : null,
          billingUrl: str(data.billingUrl),
        },
      };
    case "ai.agent.key_backup":
    case "ai.agent.key_paused":
      return {
        type,
        data: {
          workspaceName: str(data.workspaceName),
          agentName: str(data.agentName) || null,
          backupUntil: day(data.backupUntil),
          credentialsUrl: str(data.credentialsUrl),
        },
      };
    default:
      return null;
  }
}

const MAX_VALUE = 200;

/** The bell notice of an event: the template's, or the type's own. */
export function bellNoticeOf(
  type: string,
  data: Readonly<Record<string, unknown>>,
): InboxNotice | null {
  const content = notificationContentOf(type, data);
  if (content) return inboxNotice(content);
  const link = str(data.linkUrl);
  const linkUrl = link && isHttpUrl(link) && link.length <= 2000 ? link : null;
  switch (type) {
    case "google_business.analyses_done":
      return {
        eventType: type,
        data: {
          location: str(data.location).slice(0, MAX_VALUE),
          failed: str(data.failed).slice(0, 10) || "0",
        },
        linkUrl,
      };
    case "platform.events.chain_broken":
      return {
        eventType: type,
        data: { count: String(Number(data.count) || 1) },
        linkUrl,
      };
    default:
      return null;
  }
}

async function brandOf(
  tx: ContextTransaction,
  event: EventRow,
  definition: EventDefinition,
): Promise<{ brand: NotificationBrand; senderPartnerId: string | null }> {
  const platform = {
    brand: { name: appConfig.name, supportEmail: null, supportUrl: null },
    senderPartnerId: null,
  };
  // The platform speaks to the partner (billing) and to itself.
  if (
    definition.route === "partner" ||
    definition.route === "platform" ||
    !event.partner_id ||
    event.partner_id === HOUSE_PARTNER_ID
  ) {
    return platform;
  }
  const partner = await tx.partner.findUnique({
    where: { id: event.partner_id },
    select: { name: true, isHouse: true },
  });
  if (!partner || partner.isHouse) return platform;
  return {
    brand: { name: partner.name, supportEmail: null, supportUrl: null },
    senderPartnerId: event.partner_id,
  };
}

/** Channels of the type a person keeps on (essential ones always). */
async function personChannels(
  tx: ContextTransaction,
  definition: EventDefinition,
  userId: string | null,
): Promise<ReadonlySet<EventChannel>> {
  const preferences =
    userId && !definition.essential
      ? await preferencesOf(tx, userId, definition.type)
      : [];
  return new Set(
    definition.channels.filter(
      (channel) =>
        definition.essential ||
        preferences.find((p) => p.channel === channel)?.enabled !== false,
    ),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function dispatchEvent(
  tx: ContextTransaction,
  eventId: string,
  deps: DispatchDeps = {},
): Promise<DispatchResult> {
  const now = deps.now ?? (() => new Date());
  const [event] = await tx.$queryRaw<EventRow[]>`
    select id, type, route, partner_id, organization_id, workspace_id, subject_id,
           data, idempotency_key, dispatched_at
    from public.events where id = ${eventId}::uuid
  `;
  if (!event) return { status: "skipped", notices: 0, bell: 0, whatsapp: null };
  const definition = eventDefinition(event.type);
  const markDone = () =>
    tx.$executeRaw`
      update public.events set dispatched_at = now()
      where id = ${event.id}::uuid and dispatched_at is null
    `;
  if (!definition || !definition.destinations.includes("notify")) {
    await markDone();
    return { status: "skipped", notices: 0, bell: 0, whatsapp: null };
  }
  // E-mail and the bell are done once; only a failed WhatsApp comes back.
  if (event.dispatched_at && !definition.channels.includes("whatsapp")) {
    return { status: "done", notices: 0, bell: 0, whatsapp: null };
  }

  let notices = 0;
  let bell = 0;
  if (
    !event.dispatched_at &&
    (definition.channels.includes("email") ||
      definition.channels.includes("app"))
  ) {
    const recipients = await tx.$queryRaw<
      { user_id: string | null; email: string | null }[]
    >`select user_id, email from private.event_recipients(${event.id}::uuid)`;
    const content = notificationContentOf(event.type, event.data);
    const notice = bellNoticeOf(event.type, event.data);
    const languageOf = notificationLanguages(tx);
    const sender =
      recipients.length > 0 ? await brandOf(tx, event, definition) : null;
    const relatedId =
      event.subject_id && UUID.test(event.subject_id)
        ? event.subject_id
        : event.id;
    const transport = deps.transport ?? getNotificationTransport();
    for (const recipient of recipients) {
      const on = await personChannels(tx, definition, recipient.user_id);
      if (
        recipient.email &&
        content &&
        sender &&
        event.partner_id &&
        definition.channels.includes("email")
      ) {
        // Applies the preferences again and posts the bell with the e-mail.
        notices += await deliverNotification(tx, {
          transport,
          language: await languageOf(recipient.email),
          brand: sender.brand,
          partnerId: event.partner_id,
          senderPartnerId: sender.senderPartnerId,
          relatedId,
          recipientUserId: recipient.user_id,
          eventId: event.id,
          event: {
            ...content,
            recipientEmail: recipient.email,
            idempotencyKey: `${event.idempotency_key}:${recipient.email}`,
          },
        });
        continue;
      }
      if (recipient.user_id && notice && on.has("app")) {
        bell += await postNotice(tx, {
          userId: recipient.user_id,
          notice,
          idempotencyKey: `${event.idempotency_key}:user:${recipient.user_id}`,
        });
      }
    }
  }

  let whatsapp: string | null = null;
  if (definition.channels.includes("whatsapp") && event.partner_id) {
    const outcome = await deliverWhatsApp(
      tx,
      {
        id: event.id,
        type: event.type,
        partnerId: event.partner_id,
        subjectId: event.subject_id,
        idempotencyKey: event.idempotency_key,
        data: event.data,
      },
      deps,
    );
    whatsapp = outcome.status;
    if (outcome.status !== "done" && LEAD_NOTICE_EVENT_TYPES.has(event.type)) {
      await recordLeadNoticeOutcome(tx, event.data, {
        status: outcome.status,
        reason: outcome.reason,
        attempts: outcome.attempts,
        at: now(),
      });
    }
  }

  await markDone();
  return { status: "dispatched", notices, bell, whatsapp };
}

/** Every event not dispatched yet, oldest first (tests and recovery). */
export async function dispatchPendingEvents(
  tx: ContextTransaction,
  deps: DispatchDeps = {},
  limit = 100,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    select id from public.events where dispatched_at is null
    order by created_at, id limit ${limit}
  `;
  for (const row of rows) await dispatchEvent(tx, row.id, deps);
  return rows.length;
}

export const EventsDispatchPayload = z.strictObject({ eventId: z.uuid() });

export function createEventsDispatchJob(deps: DispatchDeps = {}) {
  return definePlatformJob<z.infer<typeof EventsDispatchPayload>>({
    kind: EVENTS_DISPATCH_JOB_KIND,
    description:
      "Avisa os destinatários de um evento da Central de Eventos (sino, e-mail e WhatsApp).",
    payload: EventsDispatchPayload,
    maxAttempts: 3,
    retryDelaySeconds: 30,
    async run(tx, payload) {
      const result = await dispatchEvent(tx, payload.eventId, deps);
      return {
        status: result.status,
        notices: result.notices,
        bell: result.bell,
        whatsapp: result.whatsapp,
      };
    },
  });
}

export const eventsDispatchJob = createEventsDispatchJob();
