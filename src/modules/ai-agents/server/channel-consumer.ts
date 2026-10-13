import "server-only";

import { runGuidTurn, type GuidTurnDeps } from "@/core/ai/turn/guid";
import { TURN_LIMITS } from "@/core/ai/turn/types";
import type {
  ChannelConsumer,
  ChannelTurnInput,
} from "@/core/channels/consumer";
import type { InboundEvent } from "@/core/channels/contract";
import type { JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * The GUIDS as a consumer of the core's channels (A5b, canais.md §3.5): the
 * route's `consumer_ref` is the agent. For each dispatch it keeps one open
 * conversation of the agent per external conversation, writes the
 * contact's grouped messages as one message and runs the GUIDS's turn with
 * the real tools; the core sends what the turn answered.
 *
 * - A conversation handed to the team comes back to the agent when Chatwoot
 *   says it is "pending" again: the core only dispatches then.
 * - The conversation is linked to a CRM contact with the same phone or
 *   e-mail, when there is one; otherwise the agent's tools create it.
 * - Audio, images and files reach the agent as a note of what was sent
 *   (transcription comes with the A5c).
 */

export const AI_AGENTS_MODULE = "ai-agents";

const ATTACHMENT_NOTES = {
  audio: "[O contato enviou um áudio]",
  image: "[O contato enviou uma imagem]",
  video: "[O contato enviou um vídeo]",
  file: "[O contato enviou um arquivo]",
} as const;

/** The contact's messages of one dispatch, as the agent reads them. */
export function groupedText(events: readonly InboundEvent[]): string {
  const lines = events.flatMap((event) => {
    const message = event.message;
    if (!message) return [];
    return [
      message.text.trim(),
      ...message.attachments.map((a) => ATTACHMENT_NOTES[a.kind]),
    ].filter((line) => line !== "");
  });
  return lines.join("\n").slice(0, TURN_LIMITS.maxUserMessage);
}

async function matchContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  events: readonly InboundEvent[],
): Promise<string | null> {
  const contact = events.find((e) => e.contact)?.contact;
  const or = [
    ...(contact?.phone ? [{ phone: contact.phone }] : []),
    ...(contact?.email ? [{ email: contact.email }] : []),
  ];
  if (or.length === 0) return null;
  const found = await tx.crmContact.findFirst({
    where: { workspaceId: ctx.workspaceId, OR: or },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return found?.id ?? null;
}

export async function answerOnChannel(
  session: JobSession,
  ctx: RequestContext,
  input: ChannelTurnInput,
  deps: GuidTurnDeps = {},
): Promise<{ messages: string[]; handoff: boolean }> {
  const agentId = input.consumerRef;
  const text = groupedText(input.events);
  if (!text) return { messages: [], handoff: false };
  const prepared = await session.transaction(async (tx) => {
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
      select: { id: true, status: true },
    });
    if (!agent) throw new SkipJobError("Agente não encontrado.");
    // Only a GUIDS turned on answers contacts (a paused one is tested).
    if (agent.status !== "active") {
      throw new SkipJobError("O agente desta inbox não está ativo.");
    }
    let conversation = await tx.aiConversation.findFirst({
      where: {
        agentId,
        kind: "guid",
        workspaceId: ctx.workspaceId,
        channelConversationId: input.conversation.id,
        status: { not: "closed" },
      },
      select: { id: true, status: true, contactId: true },
    });
    if (!conversation) {
      conversation = await tx.aiConversation.create({
        data: {
          kind: "guid",
          agentId,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          channel: input.kind,
          channelConversationId: input.conversation.id,
          contactId: await matchContact(tx, ctx, input.events),
        },
        select: { id: true, status: true, contactId: true },
      });
    } else if (conversation.status === "handoff") {
      // Back from the team: Chatwoot set the conversation to pending.
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { status: "active" },
      });
    }
    const message = await tx.aiMessage.create({
      data: { conversationId: conversation.id, role: "user", content: text },
      select: { id: true },
    });
    await tx.aiConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    return { conversationId: conversation.id, messageId: message.id };
  });

  const result = await runGuidTurn(session, ctx, prepared, {
    ...deps,
    answerLimits: input.limits,
  });
  const answers = await session.transaction((tx) =>
    tx.aiMessage.findMany({
      where: {
        conversationId: prepared.conversationId,
        executionId: session.jobRunId,
        role: "assistant",
        errorCode: null,
        content: { not: "" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { content: true, toolCalls: true },
    }),
  );
  return {
    // The text beside a tool call is the model thinking, not the answer.
    messages: answers
      .filter((a) => !Array.isArray(a.toolCalls) || a.toolCalls.length === 0)
      .map((a) => a.content),
    handoff: result.status === "handoff",
  };
}

export function createAiAgentsChannelConsumer(
  deps: GuidTurnDeps = {},
): ChannelConsumer {
  return {
    module: AI_AGENTS_MODULE,
    answer: (session, ctx, input) => answerOnChannel(session, ctx, input, deps),
  };
}
