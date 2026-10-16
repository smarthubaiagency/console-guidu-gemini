import "server-only";

import { z } from "zod";

import type { ChannelFetch } from "@/core/channels/http";
import { appConfig } from "@/core/config/app";
import { SOURCE_LOCALE } from "@/core/i18n/locales";
import type { JobSchedule } from "@/core/jobs/definition";
import { definePlatformJob } from "@/core/jobs/definition";
import { deliverNotification } from "@/core/notifications/delivery";
import { postNotice } from "@/core/notifications/inbox";
import type { NotificationLanguage } from "@/core/notifications/notify";
import { notificationLanguages } from "@/core/notifications/language";
import { notificationTranslator } from "@/core/notifications/templates";
import { getNotificationTransport } from "@/core/notifications/transport";
import type { NotificationTransport } from "@/core/notifications/types";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { EVENT_CATALOG, eventDefinition } from "./catalog";
import {
  brandOf,
  eventAudience,
  type EventRow,
  whatsappTextOf,
} from "./dispatch";
import { emitEvent, WORKER_ACTOR } from "./emit";
import { eventNotificationSettings } from "./rule-settings";
import { effectiveRule } from "./rules";
import { textKeyOf } from "./texts";
import { deliverPersonWhatsApp, postToPartnerWebhook } from "./whatsapp";

/**
 * The hub's clock (H2), job `events.notices-tick` every 15 minutes:
 * 1. a WhatsApp held by the quiet window leaves when the window ends;
 * 2. the notices kept for the digest go as one message per person,
 *    channel and partner at the digest time (computed when queued, in the
 *    workspace's time zone);
 * 3. an approval nobody answered gets a reminder after the rule's hours
 *    and, after twice as long, goes to the audience of `escalate_to`;
 * 4. access grants past their term, and requests left 7 days without an
 *    answer, expire (the request's event follows).
 * And the job `events.access-request`: emits the event of a new access
 * request (queued by the requester; the worker has the seal's key).
 */

export const NOTICES_TICK_JOB_KIND = "events.notices-tick";
export const ACCESS_REQUEST_JOB_KIND = "events.access-request";

/** A pending request with no answer expires after this. */
export const ACCESS_REQUEST_TTL_DAYS = 7;

export type NoticesDeps = Readonly<{
  transport?: NotificationTransport;
  fetch?: ChannelFetch;
  now?: () => Date;
}>;

const EVENT_COLUMNS = `id, type, route, severity, partner_id, organization_id, workspace_id,
  subject_id, data, idempotency_key, dispatched_at, occurred_at`;

async function eventRow(
  tx: ContextTransaction,
  id: string,
): Promise<EventRow | null> {
  const [row] = await tx.$queryRawUnsafe<EventRow[]>(
    `select ${EVENT_COLUMNS} from public.events where id = $1::uuid`,
    id,
  );
  return row ?? null;
}

/** 1. WhatsApp held by the quiet window. */
export async function releaseQuietWhatsApp(
  tx: ContextTransaction,
  deps: NoticesDeps = {},
): Promise<number> {
  const rows = await tx.$queryRaw<
    { id: string; event_id: string; recipient_user_id: string }[]
  >`
    select id, event_id, recipient_user_id from public.notification_deliveries
    where status = 'queued' and hold_reason = 'quiet_hours' and channel = 'whatsapp'
      and deliver_after <= now() and event_id is not null and recipient_user_id is not null
    order by deliver_after, id
    limit 200
  `;
  let sent = 0;
  const languageOf = notificationLanguages(tx);
  for (const row of rows) {
    const event = await eventRow(tx, row.event_id);
    const definition = event ? eventDefinition(event.type) : null;
    if (!event || !definition || !event.partner_id) continue;
    const settings = await eventNotificationSettings(tx, event.id);
    const rule = effectiveRule(definition, settings.rules);
    const audience = await eventAudience(
      tx,
      event.id,
      rule.recipients === "route" ? null : rule.recipients,
    );
    const person = audience.find((a) => a.user_id === row.recipient_user_id);
    const sender = await brandOf(tx, event, definition);
    const language = person?.email
      ? await languageOf(person.email)
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
        userId: row.recipient_user_id,
        phone: person?.whatsapp ?? null,
        text: await whatsappTextOf(
          tx,
          event,
          sender.brand.name,
          language.locale,
          language.messages,
        ),
        hold: null,
      },
      deps,
    );
    if (outcome.status === "sent") sent += 1;
  }
  return sent;
}

type DigestGroup = Readonly<{
  channel: "email" | "app" | "whatsapp";
  partner_id: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  due: Date;
  ids: string[];
  event_ids: string[];
  subjects: (string | null)[];
}>;

/** 2. The daily digest of each person, channel and partner. */
export async function sendDigests(
  tx: ContextTransaction,
  deps: NoticesDeps = {},
): Promise<number> {
  const groups = await tx.$queryRaw<DigestGroup[]>`
    select channel, partner_id, recipient_user_id, recipient_email,
           min(deliver_after) as due,
           array_agg(id::text order by created_at, id) as ids,
           array_agg(event_id::text order by created_at, id) as event_ids,
           array_agg(subject order by created_at, id) as subjects
    from public.notification_deliveries
    where status = 'queued' and hold_reason = 'digest' and deliver_after <= now()
    group by channel, partner_id, recipient_user_id, recipient_email
    order by min(deliver_after)
    limit 100
  `;
  const transport = deps.transport ?? getNotificationTransport();
  const languageOf = notificationLanguages(tx);
  let sent = 0;
  for (const group of groups) {
    const first = group.event_ids[0] ? await eventRow(tx, group.event_ids[0]) : null;
    const definition = first ? eventDefinition(first.type) : null;
    const sender =
      first && definition ? await brandOf(tx, first, definition) : null;
    const brand = sender?.brand ?? {
      name: appConfig.name,
      supportEmail: null,
      supportUrl: null,
    };
    const stamp = group.due.toISOString().slice(0, 16);
    const count = group.ids.length;
    let status: "sent" | "skipped" | "failed" = "sent";
    let reason: string | null = "digest";
    let provider: string | null = "digest";
    if (group.channel === "email" && group.recipient_email) {
      const language = await languageOf(group.recipient_email);
      const t = notificationTranslator(language.locale, language.messages);
      await deliverNotification(tx, {
        transport,
        language,
        brand,
        partnerId: group.partner_id,
        senderPartnerId: sender?.senderPartnerId ?? null,
        relatedId: group.event_ids[0] ?? group.ids[0]!,
        recipientUserId: group.recipient_user_id,
        eventId: null,
        bell: false,
        event: {
          type: "events.notice",
          recipientEmail: group.recipient_email,
          idempotencyKey: `digest:email:${group.recipient_email}:${group.partner_id}:${stamp}`.slice(0, 200),
          data: {
            eventType: "events.digest",
            subject: t("digest.subject", {
              count,
            } as unknown as Record<string, string>),
            paragraphs: [
              t("digest.intro"),
              ...group.subjects.filter(Boolean).map((subject) => `• ${subject}`),
            ],
            actionLabel: t("hub.action"),
            url: new URL("/app", appConfig.url).toString(),
          },
        },
      });
    } else if (group.channel === "app" && group.recipient_user_id) {
      await postNotice(tx, {
        userId: group.recipient_user_id,
        notice: {
          eventType: "events.digest",
          data: { count: String(count) },
          linkUrl: null,
        },
        idempotencyKey: `digest:app:${group.recipient_user_id}:${group.partner_id}:${stamp}`,
      });
      provider = "bell";
    } else if (group.channel === "whatsapp" && group.recipient_user_id && first) {
      const [phone] = await tx.$queryRaw<{ phone: string | null }[]>`
        select private.delivery_whatsapp(${group.ids[0]}::uuid) as phone
      `;
      if (!phone?.phone) {
        status = "skipped";
        reason = "no_whatsapp_consent";
        provider = null;
      } else {
        const t = notificationTranslator(SOURCE_LOCALE);
        const names: string[] = [];
        for (const id of group.event_ids) {
          const row = id ? await eventRow(tx, id) : null;
          if (row) names.push(t(`names.${textKeyOf(row.type)}`));
        }
        const failure = await postToPartnerWebhook(
          tx,
          {
            webhookEventId: first.id,
            eventId: null,
            wireName: "events.digest",
            to: phone.phone,
            message: {
              text: t("digest.whatsapp", {
                marca: brand.name,
                count,
                items: [...new Set(names)].join("; "),
              } as unknown as Record<string, string>),
            },
          },
          deps,
        );
        if (failure) {
          status = failure === "no_webhook" ? "skipped" : "failed";
          reason = failure;
          provider = failure === "no_webhook" ? null : "partner_webhook";
        } else {
          provider = "partner_webhook";
        }
      }
    } else {
      status = "skipped";
      reason = "no_recipient";
      provider = null;
    }
    await tx.$executeRaw`
      update public.notification_deliveries
      set status = ${status}, reason = ${reason}, provider = ${provider},
          attempts = attempts + 1
      where id = any(${group.ids}::uuid[]) and status = 'queued'
    `;
    if (status === "sent") sent += 1;
  }
  return sent;
}

/** 3. Reminders and escalation of approvals nobody answered. */
export async function escalatePending(
  tx: ContextTransaction,
  deps: NoticesDeps = {},
): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const approvalTypes = EVENT_CATALOG.filter((d) => d.approval).map(
    (d) => d.type,
  );
  if (approvalTypes.length === 0) return 0;
  const rows = await tx.$queryRawUnsafe<EventRow[]>(
    `select ${EVENT_COLUMNS} from public.events
     where status = 'pending' and type = any($1::text[])
       and occurred_at > now() - interval '30 days'
     order by occurred_at limit 200`,
    approvalTypes,
  );
  const transport = deps.transport ?? getNotificationTransport();
  const languageOf = notificationLanguages(tx);
  let told = 0;
  for (const event of rows) {
    const definition = eventDefinition(event.type);
    if (!definition || !event.partner_id) continue;
    const settings = await eventNotificationSettings(tx, event.id);
    const rule = effectiveRule(definition, settings.rules);
    const hours = rule.escalateAfterHours;
    if (!rule.enabled || !hours) continue;
    const age = (now().getTime() - event.occurred_at.getTime()) / 3_600_000;
    const stages: Array<{
      stage: "reminder" | "escalation";
      roles: readonly string[] | null;
    }> = [];
    if (age >= hours) {
      stages.push({
        stage: "reminder",
        roles: rule.recipients === "route" ? null : rule.recipients,
      });
    }
    if (age >= 2 * hours && rule.escalateTo.length > 0) {
      stages.push({ stage: "escalation", roles: rule.escalateTo });
    }
    if (stages.length === 0) continue;
    const sender = await brandOf(tx, event, definition);
    const link =
      typeof event.data.linkUrl === "string" && /^https?:\/\//.test(event.data.linkUrl)
        ? event.data.linkUrl
        : null;
    for (const { stage, roles } of stages) {
      const audience = await eventAudience(tx, event.id, roles);
      for (const person of audience) {
        const language = person.email
          ? await languageOf(person.email)
          : ({ locale: SOURCE_LOCALE } as NotificationLanguage);
        const t = notificationTranslator(language.locale, language.messages);
        const values = {
          event: t(`names.${textKeyOf(event.type)}`),
          hours: String(Math.floor(age)),
        };
        if (person.user_id && rule.channels.includes("app")) {
          told += await postNotice(tx, {
            userId: person.user_id,
            notice: {
              eventType: stage === "reminder" ? "events.reminder" : "events.escalation",
              data: values,
              linkUrl: link,
            },
            idempotencyKey: `${event.idempotency_key}:${stage}:user:${person.user_id}`.slice(0, 200),
            eventId: event.id,
          });
        }
        if (person.email && rule.channels.includes("email")) {
          told += await deliverNotification(tx, {
            transport,
            language,
            brand: sender.brand,
            partnerId: event.partner_id,
            senderPartnerId: sender.senderPartnerId,
            relatedId: event.id,
            recipientUserId: person.user_id,
            eventId: event.id,
            bell: false,
            event: {
              type: "events.notice",
              recipientEmail: person.email,
              idempotencyKey: `${event.idempotency_key}:${stage}:${person.email}`.slice(0, 200),
              data: {
                eventType: event.type,
                subject: t(`hub.${stage}.subject`, values),
                paragraphs: [t(`hub.${stage}.body`, values)],
                actionLabel: t("hub.action"),
                url: link,
              },
            },
          });
        }
      }
    }
  }
  return told;
}

/** 4. Grants past their term and requests without an answer expire. */
export async function expireAccessGrants(tx: ContextTransaction): Promise<number> {
  const expired = await tx.$queryRaw<{ id: string }[]>`
    update public.event_access_grants
    set status = 'expired'
    where (status = 'approved' and expires_at <= now())
       or (status = 'pending'
           and created_at <= now() - make_interval(days => ${ACCESS_REQUEST_TTL_DAYS}))
    returning id
  `;
  if (expired.length > 0) {
    await tx.$executeRaw`
      update public.events set status = 'expired'
      where type = 'events.access_requested' and status = 'pending'
        and subject_id = any(${expired.map((row) => row.id)}::text[])
    `;
  }
  return expired.length;
}

export function createNoticesTickJob(deps: NoticesDeps = {}) {
  return definePlatformJob<{ slot: string }>({
    kind: NOTICES_TICK_JOB_KIND,
    description:
      "Envia o WhatsApp guardado pela janela de silêncio, os resumos do dia, os lembretes de aprovação e expira os acessos por evento.",
    payload: z.object({ slot: z.string().max(32) }),
    maxAttempts: 2,
    retryDelaySeconds: 120,
    async run(tx) {
      return {
        released: await releaseQuietWhatsApp(tx, deps),
        digests: await sendDigests(tx, deps),
        escalated: await escalatePending(tx, deps),
        expired: await expireAccessGrants(tx),
      };
    },
  });
}

export const noticesTickJob = createNoticesTickJob();

/** Every 15 minutes. */
export const noticesTickSchedule: JobSchedule = {
  kind: NOTICES_TICK_JOB_KIND,
  description: "A cada 15 minutos.",
  due(now) {
    const slot = new Date(now);
    slot.setUTCSeconds(0, 0);
    slot.setUTCMinutes(Math.floor(slot.getUTCMinutes() / 15) * 15);
    const key = slot.toISOString().slice(0, 16);
    return { key, payload: { slot: key } };
  },
};

// ---------------------------------------------------------------------------
// The event of an access request
// ---------------------------------------------------------------------------

type GrantRow = Readonly<{
  id: string;
  requester_kind: "platform" | "partner";
  organization_id: string;
  workspace_id: string;
  workspace_slug: string | null;
  workspace_name: string | null;
  requester_label: string | null;
  event_ids: string[];
  reason: string;
  reference: string;
  duration_hours: number;
  status: string;
}>;

export async function emitAccessRequest(
  tx: ContextTransaction,
  grantId: string,
): Promise<string | null> {
  const [grant] = await tx.$queryRaw<GrantRow[]>`
    select id, requester_kind, organization_id, workspace_id, workspace_slug, workspace_name,
           requester_label, event_ids::text[] as event_ids, reason, reference, duration_hours, status
    from public.event_access_grants where id = ${grantId}::uuid
  `;
  if (!grant || grant.status !== "pending") return null;
  const [org] = await tx.$queryRaw<{ partner_id: string | null }[]>`
    select partner_id from public.organizations where id = ${grant.organization_id}::uuid
  `;
  if (!org?.partner_id) return null;
  const link = new URL(
    `/app/${grant.workspace_slug ?? ""}/events?grant=${grant.id}`,
    appConfig.url,
  ).toString();
  const emitted = await emitEvent(tx, {
    type: "events.access_requested",
    actor: WORKER_ACTOR,
    partnerId: org.partner_id,
    organizationId: grant.organization_id,
    workspaceId: grant.workspace_id,
    subject: { type: "event_access_grant", id: grant.id },
    data: {
      requesterKind: grant.requester_kind,
      requester:
        grant.requester_kind === "platform"
          ? appConfig.name
          : (grant.requester_label ?? ""),
      reason: grant.reason,
      reference: grant.reference,
      hours: grant.duration_hours,
      count: grant.event_ids.length,
      workspaceName: grant.workspace_name ?? "",
      linkUrl: link,
    },
    idempotencyKey: `access:${grant.id}`,
    status: "pending",
  });
  return emitted.id;
}

export const accessRequestJob = definePlatformJob<{ grantId: string }>({
  kind: ACCESS_REQUEST_JOB_KIND,
  description:
    "Registra na Central de Eventos o pedido de acesso aos dados de eventos e avisa o cliente.",
  payload: z.strictObject({ grantId: z.uuid() }),
  maxAttempts: 3,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const id = await emitAccessRequest(tx, payload.grantId);
    return { status: id ? "emitted" : "skipped" };
  },
});
