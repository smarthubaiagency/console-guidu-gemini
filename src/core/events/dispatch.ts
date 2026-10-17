import "server-only";

import { z } from "zod";

import {
  LEAD_NOTICE_EVENT_TYPES,
  recordLeadNoticeOutcome,
} from "@/core/ai/notices/hub";
import type { ChannelFetch } from "@/core/channels/http";
import { appConfig } from "@/core/config/app";
import { definePlatformJob } from "@/core/jobs/definition";
import { SOURCE_LOCALE, type Messages } from "@/core/i18n/locales";
import { deliverNotification } from "@/core/notifications/delivery";
import { postNotice, preferencesOf } from "@/core/notifications/inbox";
import {
  inboxNotice,
  type InboxNotice,
  type NotificationContent,
} from "@/core/notifications/inbox-content";
import type { NotificationLanguage } from "@/core/notifications/notify";
import { notificationLanguages } from "@/core/notifications/language";
import { isHttpUrl } from "@/core/notifications/markup";
import { getNotificationTransport } from "@/core/notifications/transport";
import type {
  NotificationBrand,
  NotificationEvent,
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
import { eventNotificationSettings } from "./rule-settings";
import {
  bypassesQuietHours,
  effectiveRule,
  inQuietHours,
  nextDigestAt,
  quietWindowEnd,
} from "./rules";
import {
  defaultWhatsappText,
  fillTags,
  hubNoticeText,
  tagValues,
} from "./texts";
import { deliverPersonWhatsApp, deliverWhatsApp } from "./whatsapp";

/**
 * Destination `notify` of the Event Hub (H1, rules in H2): the job `events.dispatch`
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
 *
 * H2: the rule of the type (`notifications.rules` of the cascade, read for
 * the event's partner and workspace) says whether it is on, the channels,
 * the audience (the route, or roles) and immediate or digest. WhatsApp to
 * a person needs their accepted number and respects the quiet window
 * (urgent security events go through); a digest queues the delivery for
 * `events.notices-tick`. With no rule anywhere the H1 behaviour holds.
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

export type EventRow = Readonly<{
  id: string;
  type: string;
  route: string;
  severity: string;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  subject_id: string | null;
  data: Record<string, unknown>;
  idempotency_key: string;
  dispatched_at: Date | null;
  occurred_at: Date;
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
    case "events.access_requested":
      return {
        eventType: type,
        data: {
          requester: str(data.requester).slice(0, MAX_VALUE),
          workspace: str(data.workspaceName).slice(0, MAX_VALUE),
          hours: String(Number(data.hours) || 72),
        },
        linkUrl,
      };
    case "security.api_key_created":
    case "security.api_key_revoked":
    case "security.mfa_requirement_off":
      return {
        eventType: type,
        data: {
          workspace: str(data.workspaceName).slice(0, MAX_VALUE),
          key: (str(data.keyName) || str(data.prefix)).slice(0, MAX_VALUE),
        },
        linkUrl,
      };
    default:
      return null;
  }
}

export async function brandOf(
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

/**
 * Channels of the rule a person keeps on: essential events always on e-mail
 * and the bell; WhatsApp is the person's choice even then (they accepted
 * the number, and may turn a type off).
 */
async function personChannels(
  tx: ContextTransaction,
  definition: EventDefinition,
  channels: readonly EventChannel[],
  userId: string | null,
): Promise<ReadonlySet<EventChannel>> {
  const preferences = userId
    ? await preferencesOf(tx, userId, definition.type)
    : [];
  return new Set(
    channels.filter((channel) => {
      const off =
        preferences.find((p) => p.channel === channel)?.enabled === false;
      if (channel === "whatsapp") return !off;
      return definition.essential || !off;
    }),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A person or an address to tell, with the role and accepted WhatsApp. */
export type AudienceMember = Readonly<{
  user_id: string | null;
  email: string | null;
  role: string | null;
  whatsapp: string | null;
}>;

/** Who to tell: the route (`roles` null) or the roles of a rule. */
export async function eventAudience(
  tx: ContextTransaction,
  eventId: string,
  roles: readonly string[] | null,
): Promise<AudienceMember[]> {
  return roles === null
    ? tx.$queryRaw<AudienceMember[]>`
        select user_id, email, role, whatsapp
        from private.event_audience(${eventId}::uuid, null::text[])`
    : tx.$queryRaw<AudienceMember[]>`
        select user_id, email, role, whatsapp
        from private.event_audience(${eventId}::uuid, ${[...roles]}::text[])`;
}

/** The WhatsApp text of an event for a person, in their language. */
export async function whatsappTextOf(
  tx: ContextTransaction,
  event: Pick<EventRow, "type" | "partner_id" | "data">,
  brand: string,
  locale: string,
  messages?: Messages,
): Promise<string> {
  const [row] = await tx.$queryRaw<{ body: string }[]>`
    select body from private.whatsapp_template(
      ${event.partner_id}::uuid, ${event.type}, ${locale})
  `;
  const body = row?.body ?? defaultWhatsappText(event.type, locale, messages);
  return fillTags(body, tagValues(event.type, event.data, brand, locale));
}

/** Queues a delivery of the digest (e-mail or bell): sent by the tick job. */
async function queueDigest(
  tx: ContextTransaction,
  args: Readonly<{
    event: EventRow;
    channel: "email" | "app";
    userId: string | null;
    email: string | null;
    subject: string | null;
    relatedId: string;
    until: Date;
  }>,
): Promise<number> {
  if (!args.event.partner_id) return 0;
  const who = args.channel === "email" ? args.email : `user:${args.userId}`;
  if (!who) return 0;
  const key =
    `${args.event.idempotency_key}:digest:${args.channel}:${who}`.slice(0, 200);
  const inserted = await tx.$executeRaw`
    insert into public.notification_deliveries
      (partner_id, event_type, idempotency_key, related_id, event_id, channel,
       recipient_user_id, recipient_email, subject)
    values (${args.event.partner_id}::uuid, ${args.event.type}, ${key},
            ${args.relatedId}::uuid, ${args.event.id}::uuid, ${args.channel},
            ${args.userId}::uuid, ${args.email}, ${args.subject})
    on conflict (idempotency_key) do nothing
  `;
  if (inserted > 0) {
    await tx.$executeRaw`
      update public.notification_deliveries
      set status = 'queued', hold_reason = 'digest', deliver_after = ${args.until},
          reason = 'digest'
      where idempotency_key = ${key} and status = 'pending'
    `;
  }
  return inserted;
}

export async function dispatchEvent(
  tx: ContextTransaction,
  eventId: string,
  deps: DispatchDeps = {},
): Promise<DispatchResult> {
  const now = deps.now ?? (() => new Date());
  const [event] = await tx.$queryRaw<EventRow[]>`
    select id, type, route, severity, partner_id, organization_id, workspace_id, subject_id,
           data, idempotency_key, dispatched_at, occurred_at
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
  const settings = await eventNotificationSettings(tx, event.id);
  const rule = effectiveRule(definition, settings.rules);
  if (!rule.enabled) {
    await markDone();
    return { status: "skipped", notices: 0, bell: 0, whatsapp: null };
  }
  const explicit = definition.route === "explicit";
  const personWhatsApp = !explicit && rule.channels.includes("whatsapp");
  // E-mail and the bell are done once; only a failed WhatsApp comes back.
  if (event.dispatched_at && !rule.channels.includes("whatsapp")) {
    return { status: "done", notices: 0, bell: 0, whatsapp: null };
  }

  const relatedId =
    event.subject_id && UUID.test(event.subject_id)
      ? event.subject_id
      : event.id;
  const digest = rule.delivery === "digest";
  const digestAt = nextDigestAt(now(), settings.digestTime, settings.timeZone);

  let notices = 0;
  let bell = 0;
  let whatsapp: string | null = null;
  const needsAudience =
    (!event.dispatched_at &&
      (rule.channels.includes("email") || rule.channels.includes("app"))) ||
    personWhatsApp;
  if (needsAudience) {
    const recipients = await eventAudience(
      tx,
      event.id,
      rule.recipients === "route" ? null : rule.recipients,
    );
    const content = notificationContentOf(event.type, event.data);
    const notice =
      bellNoticeOf(event.type, event.data) ??
      ({ eventType: event.type, data: {}, linkUrl: null } as InboxNotice);
    const languageOf = notificationLanguages(tx);
    const sender =
      recipients.length > 0 ? await brandOf(tx, event, definition) : null;
    const transport = deps.transport ?? getNotificationTransport();
    for (const recipient of recipients) {
      const on = await personChannels(
        tx,
        definition,
        rule.channels,
        recipient.user_id,
      );
      if (!event.dispatched_at) {
        const wantsEmail =
          on.has("email") &&
          Boolean(recipient.email) &&
          Boolean(sender) &&
          Boolean(event.partner_id);
        const wantsBell = on.has("app") && Boolean(recipient.user_id);
        if (digest) {
          if (wantsEmail && recipient.email) {
            const language = await languageOf(recipient.email);
            notices += await queueDigest(tx, {
              event,
              channel: "email",
              userId: recipient.user_id,
              email: recipient.email,
              subject: hubNoticeText(
                definition,
                event.data,
                sender?.brand.name ?? appConfig.name,
                language.locale,
                language.messages,
              ).subject.slice(0, 200),
              relatedId,
              until: digestAt,
            });
          }
          if (wantsBell) {
            bell += await queueDigest(tx, {
              event,
              channel: "app",
              userId: recipient.user_id,
              email: null,
              subject: null,
              relatedId,
              until: digestAt,
            });
          }
        } else if (
          wantsEmail &&
          recipient.email &&
          sender &&
          event.partner_id
        ) {
          const language = await languageOf(recipient.email);
          const generic = content
            ? null
            : hubNoticeText(
                definition,
                event.data,
                sender.brand.name,
                language.locale,
                language.messages,
              );
          const link = str(event.data.linkUrl);
          const emailContent: NotificationContent = content ?? {
            type: "events.notice",
            data: {
              eventType: event.type,
              subject: generic!.subject,
              paragraphs: [generic!.body],
              actionLabel: generic!.action,
              url: link && isHttpUrl(link) ? link : null,
            },
          };
          // Applies the preferences again and posts the bell with the e-mail.
          notices += await deliverNotification(tx, {
            transport,
            language,
            brand: sender.brand,
            partnerId: event.partner_id,
            senderPartnerId: sender.senderPartnerId,
            relatedId,
            recipientUserId: recipient.user_id,
            eventId: event.id,
            bell: wantsBell,
            event: {
              ...emailContent,
              recipientEmail: recipient.email,
              idempotencyKey: `${event.idempotency_key}:${recipient.email}`,
            } as NotificationEvent,
          });
          // A generic e-mail has no bell of its own: post it here.
          if (!content && wantsBell && recipient.user_id) {
            bell += await postNotice(tx, {
              userId: recipient.user_id,
              notice,
              idempotencyKey: `${event.idempotency_key}:user:${recipient.user_id}`,
              eventId: event.id,
            });
          }
        } else if (wantsBell && recipient.user_id) {
          bell += await postNotice(tx, {
            userId: recipient.user_id,
            notice,
            idempotencyKey: `${event.idempotency_key}:user:${recipient.user_id}`,
            eventId: event.id,
          });
        }
      }
      if (
        personWhatsApp &&
        recipient.user_id &&
        on.has("whatsapp") &&
        event.partner_id
      ) {
        const hold = digest
          ? { reason: "digest" as const, until: digestAt }
          : !bypassesQuietHours(definition) &&
              inQuietHours(now(), settings.quiet, settings.timeZone)
            ? {
                reason: "quiet_hours" as const,
                until: quietWindowEnd(now(), settings.quiet, settings.timeZone),
              }
            : null;
        const language = recipient.email
          ? await languageOf(recipient.email)
          : ({ locale: SOURCE_LOCALE } as NotificationLanguage);
        const outcome = await deliverPersonWhatsApp(
          tx,
          {
            event: {
              id: event.id,
              type: event.type,
              partnerId: event.partner_id,
              subjectId: event.subject_id,
              idempotencyKey: event.idempotency_key,
              data: event.data,
            },
            userId: recipient.user_id,
            phone: recipient.whatsapp,
            text: await whatsappTextOf(
              tx,
              event,
              sender?.brand.name ?? appConfig.name,
              language.locale,
              language.messages,
            ),
            hold,
          },
          deps,
        );
        whatsapp = outcome.status;
      }
    }
  }

  if (explicit && rule.channels.includes("whatsapp") && event.partner_id) {
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
