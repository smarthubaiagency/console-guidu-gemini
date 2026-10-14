import "server-only";

import { parseAgentConfig } from "@/core/ai/config/schema";
import { format, promptLocale, promptTexts } from "@/core/ai/prompt/texts";
import { runGuidTurnWithState, type GuidTurnDeps } from "@/core/ai/turn/guid";
import type { TurnAttachment } from "@/core/ai/turn/media";
import type { SpokenAnswer } from "@/core/ai/turn/speech";
import { TURN_LIMITS } from "@/core/ai/turn/types";
import type {
  ChannelConsumer,
  ChannelOutboundFile,
  ChannelTurnInput,
  ConsumerRefInfo,
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
 * - Audio, images and documents are read with the customer's key (A5c,
 *   `@/core/ai/turn/media.ts`); what the key cannot read makes the agent
 *   ask the contact to write.
 * - What the team said to the contact, and what the contact said while the
 *   team had the conversation, enter the history before the new message.
 * - A handoff leaves the agent's summary as a private note for the team.
 * - A contact who sent audio gets the answer in audio when the integration
 *   says so and the agent has a voice (A5d); the files the agent picked
 *   from the Portfolio go after the answer.
 */

export const AI_AGENTS_MODULE = "ai-agents";

/** The text of the contact's messages of one dispatch, as one message. */
export function groupedText(events: readonly InboundEvent[]): string {
  const lines = events
    .map((event) => event.message?.text.trim() ?? "")
    .filter((line) => line !== "");
  return lines.join("\n").slice(0, TURN_LIMITS.maxUserMessage);
}

/** The files of the contact's messages, read by the turn. */
export function groupedAttachments(
  input: Pick<ChannelTurnInput, "events" | "loadAttachment">,
): TurnAttachment[] {
  return input.events.flatMap((event) =>
    (event.message?.attachments ?? []).map((attachment) => ({
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      load: (maxBytes: number) => input.loadAttachment(attachment, maxBytes),
    })),
  );
}

/** The private note of a handoff, in the agent's language. */
export function handoffNote(
  language: string | undefined,
  agentName: string,
  handoff: Readonly<{ reason: string; summary: string }>,
): string {
  const texts = promptTexts(promptLocale(language)).handoffNote;
  return [
    format(texts.title, { agent: agentName }),
    handoff.summary,
    format(texts.reason, { reason: handoff.reason }),
  ].join("\n\n");
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
): Promise<{
  messages: string[];
  handoff: boolean;
  handoffNote: string | null;
  voice: SpokenAnswer | null;
  files: ChannelOutboundFile[];
}> {
  const agentId = input.consumerRef;
  const text = groupedText(input.events);
  const media = groupedAttachments(input);
  if (!text && media.length === 0) {
    return {
      messages: [],
      handoff: false,
      handoffNote: null,
      voice: null,
      files: [],
    };
  }
  const prepared = await session.transaction(async (tx) => {
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
      select: { id: true, status: true, config: true, configVersion: true },
    });
    if (!agent) throw new SkipJobError("Agente não encontrado.");
    // Only a GUIDS turned on answers contacts (a paused one is tested).
    if (agent.status !== "active") {
      throw new SkipJobError("O agente desta inbox não está ativo.");
    }
    const parsed = parseAgentConfig("guid", agent.configVersion, agent.config);
    const config = parsed.success ? parsed.data : null;
    const texts = promptTexts(promptLocale(config?.overview.language));
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
    // Explicit times keep the order: context first, then the message.
    const now = Date.now();
    const said = input.context.flatMap(
      (event): { role: "user" | "assistant"; content: string }[] => {
        const content = event.message?.text.trim() ?? "";
        if (!content) return [];
        return event.sender === "agent"
          ? [
              {
                role: "assistant" as const,
                content: format(texts.teamMessage, { text: content }),
              },
            ]
          : [{ role: "user" as const, content }];
      },
    );
    for (const [index, line] of said.entries()) {
      await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: line.role,
          content: line.content.slice(0, TURN_LIMITS.maxUserMessage),
          createdAt: new Date(now - (said.length - index)),
        },
        select: { id: true },
      });
    }
    const message = await tx.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: text,
        createdAt: new Date(now),
      },
      select: { id: true },
    });
    await tx.aiConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    return {
      conversationId: conversation.id,
      messageId: message.id,
      language: config?.overview.language,
      agentName: config?.overview.agent_name ?? "GUIDS",
    };
  });

  const { state, spoken } = await runGuidTurnWithState(
    session,
    ctx,
    { conversationId: prepared.conversationId, messageId: prepared.messageId },
    { ...deps, answerLimits: input.limits, media, speak: input.voiceReply },
  );
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
    handoff: state?.status === "handoff",
    handoffNote: state?.handoff
      ? handoffNote(prepared.language, prepared.agentName, state.handoff)
      : null,
    voice: spoken ?? null,
    files: (state?.outbox ?? []).map((file) => ({ ...file })),
  };
}

/** The GUIDS of the routes: name and whether it is turned on. */
export async function describeGuids(
  tx: ContextTransaction,
  ctx: RequestContext,
  refs: readonly string[],
): Promise<Map<string, ConsumerRefInfo>> {
  const agents = await tx.aiAgent.findMany({
    where: {
      id: { in: [...refs] },
      workspaceId: ctx.workspaceId,
      kind: "guid",
    },
    select: { id: true, status: true, config: true },
  });
  return new Map(
    agents.map((agent) => [
      agent.id,
      {
        name:
          (agent.config as { overview?: { agent_name?: string } } | null)
            ?.overview?.agent_name ?? null,
        active: agent.status === "active",
      },
    ]),
  );
}

export function createAiAgentsChannelConsumer(
  deps: GuidTurnDeps = {},
): ChannelConsumer {
  return {
    module: AI_AGENTS_MODULE,
    answer: (session, ctx, input) => answerOnChannel(session, ctx, input, deps),
    describe: describeGuids,
  };
}
