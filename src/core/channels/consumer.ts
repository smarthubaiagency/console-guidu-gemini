import type { JobSession } from "@/core/jobs/definition";
import type { RequestContext } from "@/lib/prisma/with-context";

import type { InboundEvent } from "./contract";

/**
 * Contract between the core's channels and a consumer module (canais.md
 * §3.5, A5b). The consumer receives the normalized messages of one
 * external conversation and answers with the text to send; it never sees
 * the provider's payload, the connection's secrets nor the delivery. The
 * core sends the answer and, when the consumer asks, hands the
 * conversation to the team.
 */

export type ChannelTurnInput = Readonly<{
  routeId: string;
  /** What the consumer registered on the route (ai-agents: the GUIDS). */
  consumerRef: string;
  connectionId: string;
  /** The connection's provider, e.g. `chatwoot`. */
  kind: string;
  /** The inbox (Chatwoot). */
  scope: string;
  conversation: Readonly<{
    /** `channel_conversations.id`. */
    id: string;
    externalId: string;
    externalContactId: string | null;
  }>;
  /** The contact's new messages, oldest first (grouped by the window). */
  events: readonly InboundEvent[];
  /** Shape of the answer, from the integration's settings. */
  limits: Readonly<{ maxMessages: number; maxChars: number }>;
}>;

export type ChannelTurnOutput = Readonly<{
  /** The answer, in order; empty sends nothing. */
  messages: readonly string[];
  /** Hand the conversation to the team after the answer. */
  handoff: boolean;
}>;

export type ChannelConsumer = Readonly<{
  /** The module key, as on `channel_routes.consumer_module`. */
  module: string;
  answer(
    session: JobSession,
    ctx: RequestContext,
    input: ChannelTurnInput,
  ): Promise<ChannelTurnOutput>;
}>;
