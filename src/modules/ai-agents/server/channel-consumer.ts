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
import type { ContactLocale } from "@/core/matrix/locale";
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

/** Where a GUIDS conversation answers: a Chatwoot conversation or a room. */
export type TurnLink =
  | Readonly<{ channel: "chatwoot"; channelConversationId: string }>
  | Readonly<{ channel: "matrix"; matrixRoomId: string }>;

/** A line said before the new message: the team's or the contact's. */
export type TurnContextLine = Readonly<{
  side: "contact" | "team";
  text: string;
}>;

export type AnswerTurnInput = Readonly<{
  agentId: string;
  link: TurnLink;
  /** The contact's new messages, as one message. */
  text: string;
  media: readonly TurnAttachment[];
  /** What was said since the agent last answered, oldest first. */
  context: readonly TurnContextLine[];
  /** Events with the contact's phone or e-mail, to find the CRM contact. */
  contactEvents: readonly InboundEvent[];
  limits: Readonly<{ maxMessages: number; maxChars: number }>;
  voiceReply: boolean;
  /** The contact's language, when the hub knows it (TR1). */
  contactLocale?: ContactLocale | null;
  /**
   * The conversation was resolved since the agent last answered (GF2): a
   * specialist that held it gives it back to the orchestrator.
   */
  reopened?: boolean;
}>;

export type AnswerTurnOutput = Readonly<{
  messages: string[];
  /** A specialist wrote the answer, with the orchestrator's name (GF2). */
  answeredBy: "attendant" | "seller" | null;
  handoff: Readonly<{ reason: string; summary: string }> | null;
  handoffNote: string | null;
  voice: SpokenAnswer | null;
  files: ChannelOutboundFile[];
}>;

/**
 * One turn of a GUIDS for a channel or a hub (A5b, IN6): keeps one open
 * conversation of the agent per link, writes what was said and the new
 * message, runs the GUIDS's turn and returns the answer, sending nothing.
 */
export async function answerTurn(
  session: JobSession,
  ctx: RequestContext,
  input: AnswerTurnInput,
  deps: GuidTurnDeps = {},
): Promise<AnswerTurnOutput> {
  const { agentId, text, media } = input;
  if (!text && media.length === 0) {
    return {
      messages: [],
      answeredBy: null,
      handoff: null,
      handoffNote: null,
      voice: null,
      files: [],
    };
  }
  const linkWhere =
    input.link.channel === "chatwoot"
      ? { channelConversationId: input.link.channelConversationId }
      : { matrixRoomId: input.link.matrixRoomId };
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
        ...linkWhere,
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
          channel: input.link.channel,
          ...linkWhere,
          contactId: await matchContact(tx, ctx, input.contactEvents),
        },
        select: { id: true, status: true, contactId: true },
      });
    } else if (conversation.status === "handoff") {
      // Back from the team: the hub only asks while the conversation is
      // the agent's again (pending in Chatwoot or in the Inbox).
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: {
          status: "active",
          delegatedAgentId: null,
          delegatedUntil: null,
        },
      });
    } else if (input.reopened) {
      // Resolved and back: the reception answers again (GF2).
      await tx.aiConversation.updateMany({
        where: { id: conversation.id, delegatedAgentId: { not: null } },
        data: { delegatedAgentId: null, delegatedUntil: null },
      });
    }
    // Explicit times keep the order: context first, then the message.
    const now = Date.now();
    const said = input.context.flatMap(
      (line): { role: "user" | "assistant"; content: string }[] => {
        const content = line.text.trim();
        if (!content) return [];
        return line.side === "team"
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
    {
      ...deps,
      answerLimits: input.limits,
      media,
      speak: input.voiceReply,
      contactLocale: input.contactLocale ?? null,
    },
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
  const handoff =
    state?.status === "handoff"
      ? (state.handoff ?? { reason: "", summary: "" })
      : null;
  return {
    // The text beside a tool call is the model thinking, not the answer.
    messages: answers
      .filter((a) => !Array.isArray(a.toolCalls) || a.toolCalls.length === 0)
      .map((a) => a.content),
    answeredBy: state?.answeredBy ?? null,
    handoff,
    handoffNote: state?.handoff
      ? handoffNote(prepared.language, prepared.agentName, state.handoff)
      : null,
    voice: spoken ?? null,
    files: (state?.outbox ?? []).map((file) => ({ ...file })),
  };
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
  const answer = await answerTurn(
    session,
    ctx,
    {
      agentId: input.consumerRef,
      link: {
        channel: "chatwoot",
        channelConversationId: input.conversation.id,
      },
      text: groupedText(input.events),
      media: groupedAttachments(input),
      context: input.context.map((event) => ({
        side:
          event.sender === "agent" ? ("team" as const) : ("contact" as const),
        text: event.message?.text ?? "",
      })),
      contactEvents: input.events,
      limits: input.limits,
      voiceReply: input.voiceReply,
    },
    deps,
  );
  return { ...answer, handoff: answer.handoff !== null };
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
