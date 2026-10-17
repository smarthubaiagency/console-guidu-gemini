import "server-only";

import { z } from "zod";

import {
  LEAD_NOTICE_EVENT_TYPES,
  recordLeadNoticeOutcome,
} from "@/core/ai/notices/hub";
import type { ChannelFetch } from "@/core/channels/http";
import { appConfig } from "@/core/config/app";
import {
  defineDetachedPlatformJob,
  type PlatformJobSession,
} from "@/core/jobs/definition";
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
import { serviceModeRecipients } from "@/core/service-modes/notices";
import { isWorkspaceActive } from "@/core/workspaces/active";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import {
  type EventChannel,
  type EventDefinition,
  eventDefinition,
  isWorkspaceDeletionEvent,
} from "./catalog";
import { EVENTS_DISPATCH_JOB_KIND } from "./emit";
import { type HandoffDeps, queueHandoffs } from "./handoffs";
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
import {
  deliverPersonWhatsApp,
  deliverWhatsApp,
  sendClaimedWhatsApp,
  type WhatsAppMode,
  type WhatsAppSend,
} from "./whatsapp";

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
 *
 * H4: the dispatch also hands the event to its subscribers (destination
 * `subscribers`, `handoffs.ts`), and the WhatsApp leaves the transaction:
 * `dispatchEvent` only claims the deliveries (`sending`) and returns them;
 * the job `events.dispatch` is detached and posts them after the commit,
 * recording each result in a short transaction of its own
 * (`runEventDispatch`). A caller inside its own transaction leaves the
 * WhatsApp to a follow-up run (`whatsapp: "defer"`, the default).
 */

export type DispatchDeps = Readonly<{
  transport?: NotificationTransport;
  fetch?: ChannelFetch;
  now?: () => Date;
  /** `claim` only inside `runEventDispatch`; `defer` by default. */
  whatsapp?: WhatsAppMode;
  handoffs?: HandoffDeps;
}>;

export type DispatchResult = Readonly<{
  status: "dispatched" | "done" | "skipped";
  /** New e-mail deliveries. */
  notices: number;
  /** New bell notices without an e-mail. */
  bell: number;
  whatsapp: string | null;
  /** New hand-offs to subscribers (H4). */
  handoffs: number;
  /** WhatsApp deliveries claimed for the POST after the commit (H4). */
  sends: readonly WhatsAppSend[];
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
  depth?: number;
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
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed":
      return {
        type,
        data: {
          workspaceName: str(data.workspaceName),
          purgeAfter: day(data.purgeAfter),
          appUrl: str(data.appUrl),
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
    case "proposals.requested":
    case "proposals.rejected":
    case "proposals.executed":
    case "proposals.failed":
    case "proposals.expired":
      return {
        eventType: type,
        data: {
          operation: str(data.operationLabel).slice(0, MAX_VALUE),
          workspace: str(data.workspaceName).slice(0, MAX_VALUE),
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
           data, idempotency_key, dispatched_at, occurred_at, depth
    from public.events where id = ${eventId}::uuid
  `;
  const skipped = (handoffs = 0): DispatchResult => ({
    status: "skipped",
    notices: 0,
    bell: 0,
    whatsapp: null,
    handoffs,
    sends: [],
  });
  if (!event) return skipped();
  const definition = eventDefinition(event.type);
  const markDone = () =>
    tx.$executeRaw`
      update public.events set dispatched_at = now()
      where id = ${event.id}::uuid and dispatched_at is null
    `;
  // Destination `subscribers` (H4): the hand-offs are queued once; each
  // job decides on its own (module off, closed workspace, chain limit).
  const handoffs = definition?.destinations.includes("subscribers")
    ? await queueHandoffs(
        tx,
        {
          id: event.id,
          type: event.type,
          depth: Number(event.depth ?? 0),
          partner_id: event.partner_id,
          organization_id: event.organization_id,
          workspace_id: event.workspace_id,
        },
        deps.handoffs,
      )
    : 0;
  if (!definition || !definition.destinations.includes("notify")) {
    await markDone();
    return handoffs > 0 || definition?.destinations.includes("subscribers")
      ? {
          status: "dispatched",
          notices: 0,
          bell: 0,
          whatsapp: null,
          handoffs,
          sends: [],
        }
      : skipped();
  }
  // A closed workspace (WS1) tells nobody, except about its own deletion.
  if (
    event.workspace_id &&
    !isWorkspaceDeletionEvent(event.type) &&
    !(await isWorkspaceActive(tx, event.workspace_id))
  ) {
    await markDone();
    return skipped(handoffs);
  }
  const settings = await eventNotificationSettings(tx, event.id);
  const rule = effectiveRule(definition, settings.rules);
  if (!rule.enabled) {
    await markDone();
    return skipped(handoffs);
  }
  const explicit = definition.route === "explicit";
  const personWhatsApp = !explicit && rule.channels.includes("whatsapp");
  // E-mail and the bell are done once; only a failed WhatsApp comes back.
  if (event.dispatched_at && !rule.channels.includes("whatsapp")) {
    return {
      status: "done",
      notices: 0,
      bell: 0,
      whatsapp: null,
      handoffs,
      sends: [],
    };
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
  const sends: WhatsAppSend[] = [];
  // Types with their own recipients (route `explicit`, GB1c) answer them,
  // each with an e-mail and a bell of their own; the others follow the
  // rule's audience (H2).
  const ownRecipients = await serviceModeRecipients(tx, event);
  const needsAudience =
    (!event.dispatched_at &&
      (rule.channels.includes("email") || rule.channels.includes("app"))) ||
    personWhatsApp;
  if (needsAudience) {
    const recipients: readonly (AudienceMember & {
      content?: NotificationContent | null;
      notice?: InboxNotice | null;
    })[] = ownRecipients
      ? ownRecipients.map((r) => ({ ...r, role: null, whatsapp: null }))
      : await eventAudience(
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
      const ownContent = recipient.content ?? content;
      const ownNotice =
        recipient.notice ??
        (recipient.content ? inboxNotice(recipient.content) : null) ??
        notice;
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
          const generic = ownContent
            ? null
            : hubNoticeText(
                definition,
                event.data,
                sender.brand.name,
                language.locale,
                language.messages,
              );
          const link = str(event.data.linkUrl);
          const emailContent: NotificationContent = ownContent ?? {
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
          if (!ownContent && wantsBell && recipient.user_id) {
            bell += await postNotice(tx, {
              userId: recipient.user_id,
              notice: ownNotice,
              idempotencyKey: `${event.idempotency_key}:user:${recipient.user_id}`,
              eventId: event.id,
            });
          }
        } else if (wantsBell && recipient.user_id) {
          bell += await postNotice(tx, {
            userId: recipient.user_id,
            notice: ownNotice,
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
        if (outcome.send) sends.push(outcome.send);
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
    if (outcome.send) sends.push(outcome.send);
    // A claimed delivery records its state after the POST.
    if (
      outcome.status === "skipped" &&
      LEAD_NOTICE_EVENT_TYPES.has(event.type)
    ) {
      await recordLeadNoticeOutcome(tx, event.data, {
        status: outcome.status,
        reason: outcome.reason,
        attempts: outcome.attempts,
        at: now(),
      });
    }
  }

  await markDone();
  return { status: "dispatched", notices, bell, whatsapp, handoffs, sends };
}

/**
 * The whole dispatch of an event (H4): the transaction that tells e-mail
 * and the bell, queues the hand-offs and claims the WhatsApp; then each
 * POST with no transaction open and its result in a transaction of its
 * own. `whatsapp` answers the last WhatsApp outcome.
 */
export async function runEventDispatch(
  transaction: PlatformJobSession["transaction"],
  eventId: string,
  deps: DispatchDeps = {},
): Promise<DispatchResult> {
  const result = await transaction((tx) =>
    dispatchEvent(tx, eventId, { ...deps, whatsapp: "claim" }),
  );
  if (result.sends.length === 0) return result;
  const outcomes = await sendClaimedWhatsApp(
    (operation) => transaction(operation),
    result.sends,
    deps,
  );
  return {
    ...result,
    whatsapp: outcomes.at(-1)?.status ?? result.whatsapp,
    sends: [],
  };
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
  // Detached (H4): the POST of the WhatsApp never holds a transaction.
  return defineDetachedPlatformJob<z.infer<typeof EventsDispatchPayload>>({
    kind: EVENTS_DISPATCH_JOB_KIND,
    description:
      "Avisa os destinatários de um evento da Central de Eventos (sino, e-mail e WhatsApp) e passa o evento aos assinantes.",
    payload: EventsDispatchPayload,
    maxAttempts: 3,
    retryDelaySeconds: 30,
    async run(session, payload) {
      const result = await runEventDispatch(
        session.transaction,
        payload.eventId,
        deps,
      );
      return {
        status: result.status,
        notices: result.notices,
        bell: result.bell,
        whatsapp: result.whatsapp,
        handoffs: result.handoffs,
      };
    },
  });
}

export const eventsDispatchJob = createEventsDispatchJob();
