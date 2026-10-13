import "server-only";

import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { decryptSecret } from "@/core/credentials/crypto";
import { defineDetachedJob, type JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type { RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

import {
  CHATWOOT_CAPABILITIES,
  ChatwootConfig,
  ChatwootSecrets,
  handoffChatwootConversation,
  isTrigger,
  sendChatwootMessage,
} from "./chatwoot";
import type { ChannelConsumer } from "./consumer";
import { InboundEvent } from "./contract";
import { type ChannelFetch, ChannelHttpError } from "./http";
import { resolveServiceSettings, shapeAnswer } from "./settings";

/**
 * Dispatch of a routed conversation (canais.md §4, steps 2 to 6; A5b): a
 * detached job of the worker, enqueued by the ingestion when a contact
 * writes on a routed inbox and started after the grouping window. It runs
 * as the person who turned the route on, with the same checks as any job.
 *
 * 1. A short transaction claims the conversation's new events: the
 *    contact's public messages are dispatched, everything else (team, bot,
 *    notes, status) is context and is set aside. Nothing is dispatched
 *    while the conversation is not "pending" in Chatwoot: the team has it.
 * 2. The route's consumer answers (ai-agents: the GUIDS's turn), outside
 *    any transaction.
 * 3. The core sends the answer in at most `max_messages` parts, with the
 *    pause of the settings between them, each part recorded once per run
 *    (`channel_deliveries`), and hands the conversation to the team when
 *    the consumer asks.
 *
 * One conversation is answered at a time (job group per conversation); two
 * conversations of a workspace are answered side by side.
 */

export const CHANNEL_DISPATCH_JOB_KIND = "channels.dispatch";

export const ChannelDispatchPayload = z.strictObject({
  conversationId: z.uuid(),
});
export type ChannelDispatchPayload = z.infer<typeof ChannelDispatchPayload>;

export type ChannelDispatchDeps = Readonly<{
  consumers: readonly ChannelConsumer[];
  fetch?: ChannelFetch;
  sleep?: (ms: number) => Promise<unknown>;
}>;

type Claimed = Readonly<{
  routeId: string;
  consumerModule: string;
  consumerRef: string;
  connectionId: string;
  kind: string;
  scope: string;
  conversation: Readonly<{
    id: string;
    externalId: string;
    externalContactId: string | null;
  }>;
  events: InboundEvent[];
  eventIds: string[];
  config: ChatwootConfig;
  secrets: ChatwootSecrets;
}>;

type Outcome =
  | Readonly<{ kind: "claimed"; claimed: Claimed }>
  | Readonly<{ kind: "idle"; reason: string }>;

async function claim(
  session: JobSession,
  ctx: RequestContext,
  conversationId: string,
): Promise<Outcome> {
  return session.transaction(async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_READ);
    const conversation = await tx.channelConversation.findFirst({
      where: { id: conversationId, workspaceId: ctx.workspaceId },
    });
    if (!conversation) throw new SkipJobError("Conversa não encontrada.");
    const connection = await tx.channelConnection.findFirst({
      where: {
        id: conversation.connectionId,
        workspaceId: ctx.workspaceId,
        status: "active",
      },
    });
    if (!connection) throw new SkipJobError("A conexão está desativada.");
    const events = await tx.channelInboundEvent.findMany({
      where: { conversationId: conversation.id, status: "routed" },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    const triggers: { id: string; event: InboundEvent }[] = [];
    for (const row of events) {
      const parsed = InboundEvent.safeParse(row.payload);
      if (parsed.success && isTrigger(parsed.data)) {
        triggers.push({ id: row.id, event: parsed.data });
      }
    }
    const route = await tx.channelRoute.findFirst({
      where: {
        connectionId: connection.id,
        scope: conversation.scope,
        status: "active",
      },
    });
    // Chatwoot's status rules the conversation (canais.md §5): only a
    // "pending" one is the bot's.
    const external = conversation.externalStatus;
    const ours = external === null || external === "pending";
    const dispatch = route && ours ? triggers.map((t) => t.id) : [];
    const setAside = events
      .map((row) => row.id)
      .filter((id) => !dispatch.includes(id));
    if (dispatch.length > 0) {
      await tx.channelInboundEvent.updateMany({
        where: { id: { in: dispatch }, status: "routed" },
        data: { status: "dispatched" },
      });
    }
    if (setAside.length > 0) {
      await tx.channelInboundEvent.updateMany({
        where: { id: { in: setAside }, status: "routed" },
        data: { status: "ignored" },
      });
    }
    if (!route) return { kind: "idle", reason: "no_route" };
    if (!ours) return { kind: "idle", reason: "with_team" };
    if (dispatch.length === 0) return { kind: "idle", reason: "nothing_new" };
    const config = ChatwootConfig.safeParse(connection.config);
    const secrets = ChatwootSecrets.safeParse(
      JSON.parse(decryptSecret(connection.encryptedSecrets)),
    );
    if (!config.success || !secrets.success) {
      throw new SkipJobError("A conexão está incompleta.");
    }
    return {
      kind: "claimed",
      claimed: {
        routeId: route.id,
        consumerModule: route.consumerModule,
        consumerRef: route.consumerRef,
        connectionId: connection.id,
        kind: connection.kind,
        scope: conversation.scope,
        conversation: {
          id: conversation.id,
          externalId: conversation.externalId,
          externalContactId: conversation.externalContactId,
        },
        events: triggers.map((t) => t.event),
        eventIds: dispatch,
        config: config.data,
        secrets: secrets.data,
      },
    };
  });
}

export async function runChannelDispatch(
  session: JobSession,
  ctx: RequestContext,
  payload: ChannelDispatchPayload,
  deps: ChannelDispatchDeps,
): Promise<Record<string, string | number>> {
  const executionId = session.jobRunId;
  const outcome = await claim(session, ctx, payload.conversationId);
  if (outcome.kind === "idle") return { status: outcome.reason };
  const { claimed } = outcome;
  const consumer = deps.consumers.find(
    (c) => c.module === claimed.consumerModule,
  );
  if (!consumer) {
    throw new SkipJobError("O módulo desta inbox não atende canais.");
  }
  const settings = resolveServiceSettings(claimed.config, claimed.scope);
  let answer: Awaited<ReturnType<ChannelConsumer["answer"]>>;
  try {
    answer = await consumer.answer(session, ctx, {
      routeId: claimed.routeId,
      consumerRef: claimed.consumerRef,
      connectionId: claimed.connectionId,
      kind: claimed.kind,
      scope: claimed.scope,
      conversation: claimed.conversation,
      events: claimed.events,
      limits: {
        maxMessages: settings.max_messages,
        maxChars: settings.max_chars,
      },
    });
  } catch (error) {
    // The messages stay visible as not answered (health of the connection).
    await session
      .transaction((tx) =>
        tx.channelInboundEvent.updateMany({
          where: { id: { in: claimed.eventIds }, status: "dispatched" },
          data: { status: "failed" },
        }),
      )
      .catch(() => undefined);
    throw error;
  }

  const account = {
    baseUrl: claimed.config.base_url,
    accountId: claimed.config.account_id,
  };
  const parts = shapeAnswer(
    answer.messages,
    settings,
    CHATWOOT_CAPABILITIES.output.text?.maxLength ?? 4000,
  );
  const pause = deps.sleep ?? sleep;
  const http = deps.fetch ? { fetch: deps.fetch } : {};
  let sent = 0;
  let failed: string | null = null;
  for (const [part, content] of parts.entries()) {
    const delivery = await session.transaction(async (tx) => {
      const existing = await tx.channelDelivery.findUnique({
        where: { executionId_part: { executionId, part } },
      });
      if (existing) return existing;
      return tx.channelDelivery.create({
        data: {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          connectionId: claimed.connectionId,
          conversationId: claimed.conversation.id,
          executionId,
          part,
          content,
        },
      });
    });
    if (delivery.status === "sent") {
      sent += 1;
      continue;
    }
    if (part > 0 && settings.interval_ms > 0) {
      await pause(settings.interval_ms);
    }
    try {
      const message = await sendChatwootMessage(
        account,
        claimed.secrets.botToken,
        claimed.conversation.externalId,
        content,
        http,
      );
      await session.transaction((tx) =>
        tx.channelDelivery.update({
          where: { id: delivery.id },
          data: { status: "sent", externalId: message.id, sentAt: new Date() },
        }),
      );
      sent += 1;
    } catch (error) {
      if (!(error instanceof ChannelHttpError)) throw error;
      failed = error.code;
      await session.transaction((tx) =>
        tx.channelDelivery.update({
          where: { id: delivery.id },
          data: { status: "failed", error: error.code },
        }),
      );
      appLog.warn("channels.delivery.failed", {
        executionId,
        connectionId: claimed.connectionId,
        code: error.code,
      });
      // The order matters: the rest of the answer waits for this part.
      break;
    }
  }

  let handoff = 0;
  if (answer.handoff) {
    try {
      await handoffChatwootConversation(
        account,
        claimed.secrets.botToken,
        claimed.conversation.externalId,
        http,
      );
      handoff = 1;
    } catch (error) {
      if (!(error instanceof ChannelHttpError)) throw error;
      failed ??= error.code;
      appLog.warn("channels.handoff.failed", {
        executionId,
        connectionId: claimed.connectionId,
        code: error.code,
      });
    }
  }
  return {
    status: failed ? "delivery_failed" : "answered",
    events: claimed.events.length,
    parts: parts.length,
    sent,
    handoff,
  };
}

export function createChannelDispatchJob(deps: ChannelDispatchDeps) {
  return defineDetachedJob<ChannelDispatchPayload>({
    kind: CHANNEL_DISPATCH_JOB_KIND,
    description: "Resposta a uma conversa de um canal (Chatwoot).",
    payload: ChannelDispatchPayload,
    // The answer is not asked twice of the consumer; the parts already
    // sent are never sent again (channel_deliveries).
    maxAttempts: 1,
    expireInSeconds: 240,
    group: (payload) => payload.conversationId,
    run: (session, ctx, payload) =>
      runChannelDispatch(session, ctx, payload, deps),
  });
}
