import "server-only";

import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  ChannelHttpError,
  type ChannelFetch,
  providerJson,
} from "@/core/channels/http";
import { decryptSecret } from "@/core/credentials/crypto";
import { contextPartnerId, emitEvent } from "@/core/events/emit";
import type { EventType } from "@/core/events/catalog";
import { defineDetachedJob, type JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { type AgentConfig, parseAgentConfig } from "../config/schema";
import type { LeadTemperature } from "../config/scoring";
import { format, promptLocale, promptTexts } from "../prompt/texts";

/**
 * The hot-lead notice of a GUIDS (A6a, plano-a6.md): when `score_lead`
 * scores a contact at or above the agent's notice score (`notify_on_score`,
 * else the hot threshold), or with a rule marked "avisar na hora", the
 * merchant hears about it once per agent and contact.
 *
 * - WhatsApp: a signed POST to the partner's webhook; the partner's flow
 *   sends it from the merchant's Assistant number (Marcelo, 14/10/2026).
 * - E-mail and SMS wait for a provider: the notice is kept, skipped.
 * The panel lists every notice with its state. A referral the GUIDS gives
 * a contact (A6b) is told the same way, with its own event.
 *
 * Since the Event Hub (H1) the notice is an event (`ai.agent.lead_hot` or
 * `ai.agent.referral_recommended`, route `explicit`) emitted in the
 * transaction of the scoring, with the message already written (the
 * worker of the hub never reads the agent, the contact or the referral);
 * `events.dispatch` posts it by the partner's webhook and writes the state
 * back to `ai_lead_notices`. The job `ai-agents.lead-notice` stays for the
 * runs queued before the hub.
 */

export const LEAD_NOTICE_JOB_KIND = "ai-agents.lead-notice";
export const LEAD_NOTICE_EVENT = "lead.hot";
export const REFERRAL_NOTICE_EVENT = "referral.recommended";

/** The events of the Event Hub (H1) for each kind of notice. */
export const LEAD_HUB_EVENT: EventType = "ai.agent.lead_hot";
export const REFERRAL_HUB_EVENT: EventType = "ai.agent.referral_recommended";

type Rules = AgentConfig["rules"];

/** The score at which the merchant is told; null: only "avisar na hora". */
export function noticeScore(rules: Rules): number | null {
  return rules.notify_on_score ?? rules.hot_score_threshold ?? null;
}

export function shouldNotice(
  rules: Rules,
  score: Readonly<{ points: number; ruleIds: readonly string[] }>,
): boolean {
  const immediate = (rules.lead_scoring_rules ?? []).some(
    (rule) => rule.notify_immediately && score.ruleIds.includes(rule.rule_id),
  );
  if (immediate) return true;
  const threshold = noticeScore(rules);
  return threshold !== null && score.points >= threshold;
}

/**
 * Records the notice, once per agent and contact, and asks its delivery.
 * Runs in the transaction of the scoring, as whom runs the turn.
 */
export async function recordLeadNotice(
  tx: ContextTransaction,
  ctx: RequestContext,
  notice: Readonly<{
    agentId: string;
    contactId: string;
    conversationId: string;
    points: number;
    temperature: LeadTemperature;
    rules: Rules;
  }>,
): Promise<string | null> {
  const created = await tx.aiLeadNotice.createMany({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      agentId: notice.agentId,
      contactId: notice.contactId,
      conversationId: notice.conversationId,
      points: notice.points,
      temperature: notice.temperature,
      channel: notice.rules.notify_channel ?? "whatsapp",
    },
    skipDuplicates: true,
  });
  if (created.count === 0) return null;
  const row = await tx.aiLeadNotice.findFirstOrThrow({
    where: {
      kind: "lead",
      agentId: notice.agentId,
      contactId: notice.contactId,
    },
    select: { id: true },
  });
  await emitNoticeEvent(tx, ctx, row.id);
  return row.id;
}

/**
 * A referral given to a contact, told to the merchant (A6b, Marcelo
 * 14/10/2026: the merchant tells the referral, never GUIDU). Once per
 * conversation and referral; only when the agent's "avisar a indicação"
 * (`partner_referral_notify`) is on.
 */
export async function recordReferralNotice(
  tx: ContextTransaction,
  ctx: RequestContext,
  notice: Readonly<{
    agentId: string;
    contactId: string | null;
    conversationId: string;
    referralId: string;
    reasonText: string;
    rules: Rules;
  }>,
): Promise<string | null> {
  const created = await tx.aiLeadNotice.createMany({
    data: {
      kind: "referral",
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      agentId: notice.agentId,
      contactId: notice.contactId,
      conversationId: notice.conversationId,
      referralId: notice.referralId,
      reasonText: notice.reasonText.slice(0, 500),
      channel: notice.rules.notify_channel ?? "whatsapp",
    },
    skipDuplicates: true,
  });
  if (created.count === 0) return null;
  const row = await tx.aiLeadNotice.findFirstOrThrow({
    where: {
      kind: "referral",
      conversationId: notice.conversationId,
      referralId: notice.referralId,
    },
    select: { id: true },
  });
  await emitNoticeEvent(tx, ctx, row.id);
  return row.id;
}

// ----------------------------------------------------------------------------
// The text
// ----------------------------------------------------------------------------

export type NoticeFacts = Readonly<{
  agentName: string;
  contact: Readonly<{
    name: string;
    phone: string | null;
    email: string | null;
  }>;
  points: number;
  temperature: LeadTemperature;
  reasons: readonly string[];
}>;

const TAG = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

/** The agent's `notify_template`, else the default text of its language. */
export function noticeText(config: AgentConfig, facts: NoticeFacts): string {
  const texts = promptTexts(promptLocale(config.overview.language)).leadNotice;
  const temperature = texts.temperature[facts.temperature] ?? facts.temperature;
  const reasons = facts.reasons.length > 0 ? facts.reasons.join(", ") : "-";
  const values: Record<string, string> = {
    "agent.name": facts.agentName,
    "contact.name": facts.contact.name,
    "contact.phone": facts.contact.phone ?? "-",
    "contact.email": facts.contact.email ?? "-",
    "lead.score": String(facts.points),
    "lead.temperature": temperature,
    "lead.reasons": reasons,
  };
  const template = config.rules.notify_template?.trim();
  if (template) {
    return template
      .replace(TAG, (match, key: string) => values[key] ?? match)
      .slice(0, 2000);
  }
  return format(texts.text, {
    agent: facts.agentName,
    name: facts.contact.name,
    phone: facts.contact.phone ?? "-",
    score: String(facts.points),
    temperature,
    reasons,
  });
}

export type ReferralFacts = Readonly<{
  agentName: string;
  contact: Readonly<{ name: string; phone: string | null }> | null;
  referral: Readonly<{ name: string; phone: string | null }>;
  reason: string;
}>;

/** The merchant's text of a referral, in the agent's language. */
export function referralNoticeText(
  config: AgentConfig,
  facts: ReferralFacts,
): string {
  const texts = promptTexts(
    promptLocale(config.overview.language),
  ).referralNotice;
  return format(texts.text, {
    agent: facts.agentName,
    referral: facts.referral.name,
    referralPhone: facts.referral.phone ?? "-",
    name: facts.contact?.name ?? texts.unknownContact,
    phone: facts.contact?.phone ?? "-",
    reason: facts.reason.replace(/[\s.!?]+$/, "") || "-",
  });
}

/** `sha256=<hex>` of `<timestamp>.<body>` with the partner's secret. */
export function signNotice(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

// ----------------------------------------------------------------------------
// The delivery
// ----------------------------------------------------------------------------

export const LeadNoticePayload = z.strictObject({ noticeId: z.uuid() });
export type LeadNoticePayload = z.infer<typeof LeadNoticePayload>;

export type LeadNoticeDeps = Readonly<{
  fetch?: ChannelFetch;
  now?: () => Date;
}>;

/** What a notice says, or why it cannot be sent. */
type NoticeMessage =
  | Readonly<{ kind: "skip"; reason: string }>
  | Readonly<{
      kind: "send";
      /** The A6 name of the event (`lead.hot`, `referral.recommended`). */
      event: string;
      to: string;
      /** Fields of the body besides `event`, `to` and `sent_at`. */
      message: Record<string, unknown>;
    }>;

type NoticeRow = Readonly<{
  id: string;
  kind: string;
  agentId: string;
  contactId: string | null;
  conversationId: string;
  referralId: string | null;
  reasonText: string | null;
  points: number | null;
  temperature: string | null;
  channel: string;
  createdAt: Date;
}>;

/**
 * The message of a notice, read as whom runs the turn: the agent as
 * stored, the contact, the referral and the reasons of the score.
 */
async function noticeMessage(
  tx: ContextTransaction,
  ctx: RequestContext,
  notice: NoticeRow,
): Promise<NoticeMessage> {
  const skip = (reason: string): NoticeMessage => ({ kind: "skip", reason });
  if (notice.channel === "email") return skip("email_provider_pending");
  if (notice.channel === "sms") return skip("sms_unavailable");

  const agent = await tx.aiAgent.findFirst({
    where: { id: notice.agentId, workspaceId: ctx.workspaceId },
    select: { config: true, configVersion: true },
  });
  const parsed = agent
    ? parseAgentConfig("guid", agent.configVersion, agent.config)
    : null;
  if (!parsed?.success) return skip("invalid_config");
  const config = parsed.data;
  const ownerPhone = config.rules.owner_phone;
  if (!ownerPhone) return skip("no_owner_phone");

  const workspace = await tx.workspace.findFirst({
    where: { id: ctx.workspaceId },
    select: { name: true },
  });
  const contact = notice.contactId
    ? await tx.crmContact.findFirst({
        where: { id: notice.contactId, workspaceId: ctx.workspaceId },
        select: { name: true, phone: true, email: true },
      })
    : null;
  const agentName = config.overview.agent_name ?? "GUIDS";
  const common = {
    notice_id: notice.id,
    created_at: notice.createdAt.toISOString(),
    language: config.overview.language ?? "pt-BR",
    agent: { id: notice.agentId, name: agentName },
    workspace: { id: ctx.workspaceId, name: workspace?.name ?? null },
    conversation_id: notice.conversationId,
  };
  const send = (
    event: string,
    body: Record<string, unknown>,
  ): NoticeMessage => ({
    kind: "send",
    event,
    to: ownerPhone,
    message: { ...common, ...body },
  });

  if (notice.kind === "referral") {
    const referral = notice.referralId
      ? await tx.aiAgentReferral.findFirst({
          where: { id: notice.referralId, workspaceId: ctx.workspaceId },
          select: { name: true, phone: true, specialties: true, city: true },
        })
      : null;
    if (!referral) return skip("no_referral");
    const reason = notice.reasonText ?? "";
    return send(REFERRAL_NOTICE_EVENT, {
      text: referralNoticeText(config, {
        agentName,
        contact,
        referral,
        reason,
      }),
      referral: {
        id: notice.referralId,
        name: referral.name,
        phone: referral.phone,
        specialties: referral.specialties,
        city: referral.city,
      },
      reason,
      lead: contact
        ? {
            contact_id: notice.contactId,
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
          }
        : null,
    });
  }

  if (!contact || notice.points === null) return skip("no_contact");
  const activity = await tx.aiLeadActivity.findFirst({
    where: { agentId: notice.agentId, contactId: notice.contactId ?? "" },
    orderBy: { createdAt: "desc" },
    select: { scoreBreakdown: true },
  });
  const reasons = Array.isArray(activity?.scoreBreakdown)
    ? (activity.scoreBreakdown as { label?: unknown }[])
        .map((item) => (typeof item.label === "string" ? item.label : ""))
        .filter(Boolean)
    : [];
  const temperature = (notice.temperature ?? "hot") as LeadTemperature;
  return send(LEAD_NOTICE_EVENT, {
    text: noticeText(config, {
      agentName,
      contact,
      points: notice.points,
      temperature,
      reasons,
    }),
    lead: {
      contact_id: notice.contactId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      score: notice.points,
      temperature,
      reasons,
    },
  });
}

/**
 * The notice as an event of the hub (H1), in the transaction that recorded
 * it: the message goes in the event (WhatsApp target and body), the
 * dispatch only posts it.
 */
async function emitNoticeEvent(
  tx: ContextTransaction,
  ctx: RequestContext,
  noticeId: string,
): Promise<void> {
  const notice = await tx.aiLeadNotice.findFirstOrThrow({
    where: { id: noticeId, workspaceId: ctx.workspaceId },
  });
  const message = await noticeMessage(tx, ctx, notice);
  await emitEvent(tx, {
    type: notice.kind === "referral" ? REFERRAL_HUB_EVENT : LEAD_HUB_EVENT,
    actor: {
      userId: ctx.userId,
      principalType: ctx.principalType ?? "user",
      origin: "worker",
    },
    partnerId: await contextPartnerId(tx),
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    subject: { type: "ai_lead_notice", id: notice.id },
    data: {
      noticeId: notice.id,
      whatsapp:
        message.kind === "send"
          ? {
              to: message.to,
              skip: null,
              message: message.message,
              name: message.event,
            }
          : { to: null, skip: message.reason, message: {} },
    },
    idempotencyKey: `lead-notice:${notice.id}`,
  });
}

type Prepared =
  | Readonly<{ kind: "done"; status: string }>
  | Readonly<{
      kind: "send";
      event: string;
      url: string;
      secret: string;
      body: string;
    }>;

/** The legacy job (runs queued before the hub): message and webhook. */
async function prepare(
  tx: ContextTransaction,
  ctx: RequestContext,
  noticeId: string,
  now: Date,
): Promise<Prepared> {
  const notice = await tx.aiLeadNotice.findFirst({
    where: { id: noticeId, workspaceId: ctx.workspaceId },
  });
  if (!notice) throw new SkipJobError("Aviso não encontrado.");
  if (notice.status === "sent" || notice.status === "skipped") {
    return { kind: "done", status: notice.status };
  }
  const skip = async (reason: string): Promise<Prepared> => {
    await tx.aiLeadNotice.update({
      where: { id: notice.id },
      data: { status: "skipped", reason },
    });
    return { kind: "done", status: "skipped" };
  };
  const message = await noticeMessage(tx, ctx, notice);
  if (message.kind === "skip") return skip(message.reason);
  const [webhook] = await tx.$queryRaw<
    { url: string; encrypted_secret: string }[]
  >`select url, encrypted_secret from private.ai_notice_webhook()`;
  if (!webhook) return skip("no_webhook");
  const { notice_id, created_at, ...rest } = message.message;
  return {
    kind: "send",
    event: message.event,
    url: webhook.url,
    secret: decryptSecret(webhook.encrypted_secret),
    body: JSON.stringify({
      event: message.event,
      notice_id,
      created_at,
      sent_at: now.toISOString(),
      to: message.to,
      ...rest,
    }),
  };
}

function failureReason(error: unknown): string {
  if (error instanceof ChannelHttpError) {
    return error.status ? `http_${error.status}` : error.code;
  }
  return "network";
}

export async function deliverLeadNotice(
  session: JobSession,
  ctx: RequestContext,
  payload: LeadNoticePayload,
  deps: LeadNoticeDeps = {},
): Promise<Record<string, string | number>> {
  const now = deps.now ?? (() => new Date());
  const prepared = await session.transaction((tx) =>
    prepare(tx, ctx, payload.noticeId, now()),
  );
  if (prepared.kind === "done") return { status: prepared.status };
  const timestamp = String(Math.floor(now().getTime() / 1000));
  let failure: string | null = null;
  try {
    await providerJson(
      prepared.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guidu-event": prepared.event,
          "x-guidu-timestamp": timestamp,
          "x-guidu-signature": signNotice(
            prepared.secret,
            timestamp,
            prepared.body,
          ),
        },
        body: prepared.body,
      },
      deps.fetch ? { fetch: deps.fetch } : {},
    );
  } catch (error) {
    // A 2xx answer that is not JSON is still a delivery.
    if (!(
      error instanceof ChannelHttpError && error.code === "invalid_response"
    )) {
      failure = failureReason(error);
    }
  }
  await session.transaction((tx) =>
    tx.aiLeadNotice.update({
      where: { id: payload.noticeId },
      data: failure
        ? { status: "failed", reason: failure, attempts: { increment: 1 } }
        : {
            status: "sent",
            reason: null,
            sentAt: now(),
            attempts: { increment: 1 },
          },
    }),
  );
  // The queue tries again; the panel shows the failure meanwhile.
  if (failure) throw new Error(`lead notice not delivered: ${failure}`);
  return { status: "sent" };
}

export function createLeadNoticeJob(deps: LeadNoticeDeps = {}) {
  return defineDetachedJob<LeadNoticePayload>({
    kind: LEAD_NOTICE_JOB_KIND,
    description:
      "Aviso ao responsável (lead quente ou indicação) pelo webhook do parceiro.",
    payload: LeadNoticePayload,
    maxAttempts: 3,
    expireInSeconds: 60,
    run: (session, ctx, payload) =>
      deliverLeadNotice(session, ctx, payload, deps),
  });
}

export const leadNoticeJob = createLeadNoticeJob();
