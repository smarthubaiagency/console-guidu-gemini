import "server-only";

import type { GuidTurnDeps } from "@/core/ai/turn/guid";
import { TURN_LIMITS } from "@/core/ai/turn/types";
import type { JobSession } from "@/core/jobs/definition";
import type { ContactLocale } from "@/core/matrix/locale";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import {
  AI_AGENTS_MODULE,
  answerTurn,
  type TurnContextLine,
} from "./channel-consumer";

/**
 * Public service of the AI agents module for the hubs (canais.md §3.5,
 * "Agente acionado por um hub"; IN6). The hub owns the route of the
 * conversation: it says which GUIDS answers, gives the new messages of the
 * contact and what was said since the agent last answered, and gets back
 * the response plan without anything being sent. The hub sends the answer
 * and executes the handoff. The turn is the same as the Chatwoot one
 * (A5b): one open conversation of the agent per hub conversation, the real
 * tools, the usage and the checks of the module, the agent and the quota.
 *
 * Text only in the IN6 (audio in the room comes later).
 */

export type HubTurnInput = Readonly<{
  /** The GUIDS (ai_agents.id) the hub chose. */
  agentId: string;
  /** The hub's conversation: the Inbox room. */
  conversation: Readonly<{ hub: "inbox"; roomId: string }>;
  /** The contact's new messages, oldest first. */
  messages: readonly string[];
  /** What was said since the agent last answered, oldest first. */
  context: readonly TurnContextLine[];
  /** Shape of the answer (the hub's service rules). */
  limits: Readonly<{ maxMessages: number; maxChars: number }>;
  /** The contact's language, known by the room (TR1); null: unknown. */
  contactLocale?: ContactLocale | null;
}>;

export type HubTurnPlan = Readonly<{
  /** The answer, in order; empty sends nothing. */
  messages: readonly string[];
  /** The agent hands the conversation to the team, with its summary. */
  handoff: Readonly<{ reason: string; summary: string }> | null;
}>;

export type { TurnContextLine };

export async function runTurn(
  session: JobSession,
  ctx: RequestContext,
  input: HubTurnInput,
  deps: GuidTurnDeps = {},
): Promise<HubTurnPlan> {
  const text = input.messages
    .map((message) => message.trim())
    .filter((message) => message !== "")
    .join("\n")
    .slice(0, TURN_LIMITS.maxUserMessage);
  const answer = await answerTurn(
    session,
    ctx,
    {
      agentId: input.agentId,
      link: { channel: "matrix", matrixRoomId: input.conversation.roomId },
      text,
      media: [],
      context: input.context,
      contactEvents: [],
      limits: input.limits,
      voiceReply: false,
      contactLocale: input.contactLocale ?? null,
    },
    deps,
  );
  return { messages: answer.messages, handoff: answer.handoff };
}

export type HubGuidChoice = Readonly<{
  id: string;
  name: string;
  /** Turned on: only an active GUIDS answers contacts. */
  active: boolean;
}>;

/**
 * The GUIDS a hub may choose (IN6, Inbox settings): the workspace's agents
 * with their name and whether they are on. Empty when the module is not
 * available in the workspace.
 */
export async function listHubGuids(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<HubGuidChoice[]> {
  try {
    await assertModuleOperational(tx, ctx, AI_AGENTS_MODULE, "read");
  } catch (error) {
    if (error instanceof ModuleUnavailableError) return [];
    throw error;
  }
  const agents = await tx.aiAgent.findMany({
    where: { kind: "guid", workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, config: true },
  });
  return agents.map((agent) => ({
    id: agent.id,
    name:
      (agent.config as { overview?: { agent_name?: string } } | null)?.overview
        ?.agent_name ?? "GUIDS",
    active: agent.status === "active",
  }));
}
