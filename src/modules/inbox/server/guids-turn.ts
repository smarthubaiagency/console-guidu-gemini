import "server-only";

import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import type { GuidTurnDeps } from "@/core/ai/turn/guid";
import { shapeAnswer } from "@/core/channels/settings";
import {
  defineDetachedJob,
  type JobResult,
  type JobSession,
} from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import {
  joinAgent,
  type RoomMessage,
  recentMessages,
  sendAsAgent,
  setAgentTyping,
} from "@/core/matrix/agent";
import { matrixConfig } from "@/core/matrix/config";
import { readConversationState } from "@/core/matrix/conversation";
import { messageSide } from "@/core/matrix/events";
import { requestAgentSync } from "@/core/matrix/jobs";
import {
  createSynapseClient,
  setConversationState,
  type SynapseClient,
} from "@/core/matrix/synapse";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import type { RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import {
  runTurn,
  type HubTurnPlan,
  type TurnContextLine,
} from "@/modules/ai-agents/server";

import { inboxConfigOf, resolveInboxService } from "../settings";

/**
 * Turn of the Inbox GUIDS in a room (IN6, plano-in4b-in6.md §2): a
 * detached job of the worker, enqueued by the core when the consumer
 * writes in a pending room (`private.inbox_guids_enqueue`) and started
 * after the grouping window. It runs as the person who chose the GUIDS in
 * the Inbox settings, with the same checks as any job of the workspace.
 *
 * 1. Checks the module, the room, the settings and the agent's user, and
 *    reads the state of the conversation from the room: only a pending
 *    conversation is the GUIDS's (never an open or resolved one).
 * 2. Reads the latest messages from Synapse as the core and takes the
 *    consumer's messages after the last one the GUIDS answered (and after
 *    the team's last message); what the team and the consumer said before
 *    them is context. The newest one is recorded before the turn, so a
 *    message is never answered twice.
 * 3. Asks the GUIDS for the answer (`runTurn` of the AI agents module,
 *    outside any transaction) with "typing…" in the room.
 * 4. Sends the answer as the agent's user within the service rules (most
 *    messages, the pause between them), unless the team took the
 *    conversation meanwhile, and hands it to the team when the agent asks:
 *    the core writes "open, without an assignee" and the summary stays in
 *    the database for the context panel, never in the room.
 *
 * One room at a time (job group per room); the parts go with a transaction
 * id per run and part, so Synapse never shows a part twice.
 */

export const INBOX_GUIDS_TURN_KIND = "inbox.guids-turn";

export const GuidsTurnPayload = z.strictObject({
  roomId: z.string().regex(/^![^\s]{1,254}$/),
});
export type GuidsTurnPayload = z.infer<typeof GuidsTurnPayload>;

export type GuidsTurnDeps = Readonly<{
  client?: SynapseClient;
  turnDeps?: GuidTurnDeps;
  /** The GUIDS's turn; the AI agents module's by default. */
  turn?: typeof runTurn;
  sleep?: (ms: number) => Promise<unknown>;
}>;

/** Messages of context given to the GUIDS, the most recent ones. */
const MAX_CONTEXT = 20;
/** Longest part sent to the room. */
const MAX_PART = 4000;

type Loaded = Readonly<{
  agentId: string;
  agentMxid: string | null;
  joined: boolean;
  consumerMxid: string | null;
  lastAnsweredTs: number | null;
  lastAnsweredEventId: string | null;
  service: ReturnType<typeof resolveInboxService>;
}>;

async function load(
  session: JobSession,
  ctx: RequestContext,
  roomId: string,
): Promise<Loaded> {
  return session.transaction(async (tx) => {
    try {
      await assertModuleOperational(tx, ctx, "inbox", "write");
    } catch (error) {
      if (error instanceof ModuleUnavailableError) {
        throw new SkipJobError("O Inbox não está disponível neste workspace.");
      }
      throw error;
    }
    const room = await tx.matrixRoom.findFirst({
      where: { roomId, workspaceId: ctx.workspaceId, state: "active" },
      select: { consumerMxid: true },
    });
    if (!room) throw new SkipJobError("Conversa não encontrada.");
    const inbox = await tx.workspaceModule.findFirst({
      where: { workspaceId: ctx.workspaceId, moduleKey: "inbox" },
      select: { config: true },
    });
    const config = inboxConfigOf(inbox?.config);
    if (!config.guids_agent_id) {
      throw new SkipJobError("Nenhum GUIDS atende o Inbox.");
    }
    const agent = await tx.matrixAgentUser.findUnique({
      where: { agentId: config.guids_agent_id },
      select: { mxid: true, state: true, workspaceId: true },
    });
    const usable =
      agent?.state === "active" && agent.workspaceId === ctx.workspaceId;
    const member = usable
      ? await tx.matrixRoomMember.findUnique({
          where: { roomId_userMxid: { roomId, userMxid: agent.mxid } },
          select: { membership: true },
        })
      : null;
    const cursor = await tx.inboxGuidsRoom.findUnique({
      where: { roomId },
      select: { lastAnsweredTs: true, lastAnsweredEventId: true },
    });
    return {
      agentId: config.guids_agent_id,
      agentMxid: usable ? agent.mxid : null,
      joined: member?.membership === "join",
      consumerMxid: room.consumerMxid,
      lastAnsweredTs:
        cursor?.lastAnsweredTs !== null && cursor?.lastAnsweredTs !== undefined
          ? Number(cursor.lastAnsweredTs)
          : null,
      lastAnsweredEventId: cursor?.lastAnsweredEventId ?? null,
      service: resolveInboxService(config),
    };
  });
}

export type TurnInput = Readonly<{
  /** The consumer's new messages, oldest first. */
  fresh: readonly RoomMessage[];
  context: readonly TurnContextLine[];
}>;

/**
 * What the GUIDS answers now (pure): the consumer's messages after the
 * last one it answered and after the team's last message, said while the
 * conversation was not with the team (pending, or resolved: a resolved
 * conversation reopens to the GUIDS). What the team and the consumer said
 * otherwise, since the last answer, is context. The agent's own messages
 * are already in its history. Before the first change of state in view,
 * the conversation is taken as pending (a room is born pending).
 */
export function pickTurnInput(
  client: SynapseClient,
  messages: readonly RoomMessage[],
  input: Readonly<{
    consumerMxid: string | null;
    lastAnsweredTs: number | null;
    lastAnsweredEventId: string | null;
  }>,
): TurnInput {
  let status: string = "pending";
  const said: {
    message: RoomMessage;
    side: ReturnType<typeof messageSide>;
    withTeam: boolean;
  }[] = [];
  for (const m of messages) {
    if (m.status) {
      status = m.status;
      continue;
    }
    if (
      m.eventId === input.lastAnsweredEventId ||
      (input.lastAnsweredTs !== null && m.ts <= input.lastAnsweredTs)
    ) {
      continue;
    }
    said.push({
      message: m,
      side: messageSide(client, m.sender, input.consumerMxid),
      withTeam: status === "open",
    });
  }
  const lastTeam = said.reduce(
    (latest, s) =>
      s.side === "team" && s.message.ts > latest ? s.message.ts : latest,
    -1,
  );
  const fresh = said
    .filter(
      (s) => s.side === "consumer" && !s.withTeam && s.message.ts > lastTeam,
    )
    .map((s) => s.message);
  const freshIds = new Set(fresh.map((m) => m.eventId));
  const context = said
    .filter(
      (s) =>
        !freshIds.has(s.message.eventId) &&
        (s.side === "consumer" || s.side === "team"),
    )
    .map((s): TurnContextLine => ({
      side: s.side === "team" ? "team" : "contact",
      text: s.message.body,
    }))
    .slice(-MAX_CONTEXT);
  return { fresh, context };
}

function synapse(deps: GuidsTurnDeps): SynapseClient {
  if (deps.client) return deps.client;
  const config = matrixConfig();
  if (!config) throw new SkipJobError("Matrix não configurado.");
  return createSynapseClient(config);
}

export async function runGuidsTurn(
  session: JobSession,
  ctx: RequestContext,
  payload: GuidsTurnPayload,
  deps: GuidsTurnDeps = {},
): Promise<JobResult> {
  const client = synapse(deps);
  const { roomId } = payload;
  const loaded = await load(session, ctx, roomId);
  if (!loaded.agentMxid) {
    // The worker registers the agent's user; the next message finds it.
    await session.transaction((tx) => requestAgentSync(tx, ctx.workspaceId));
    throw new SkipJobError("O GUIDS ainda não está nas salas do Inbox.");
  }
  const agentMxid = loaded.agentMxid;

  const state = await readConversationState(client, roomId);
  if (state.status !== "pending") return { status: "with_team" };

  const messages = await recentMessages(client, roomId);
  const input = pickTurnInput(client, messages, loaded);
  const newest = input.fresh.at(-1);
  if (!newest) return { status: "nothing_new" };

  // Claimed before the turn: a crash never answers these messages twice.
  // Raw insert: only the granted columns (Prisma would send created_at).
  await session.transaction(
    (tx) => tx.$executeRaw`
      insert into public.inbox_guids_rooms
        (room_id, workspace_id, organization_id, agent_id, last_answered_event_id, last_answered_ts)
      values (${roomId}, ${ctx.workspaceId}::uuid, ${ctx.organizationId}::uuid,
              ${loaded.agentId}::uuid, ${newest.eventId}, ${BigInt(newest.ts)})
      on conflict (room_id) do update
        set agent_id = excluded.agent_id,
            last_answered_event_id = excluded.last_answered_event_id,
            last_answered_ts = excluded.last_answered_ts
    `,
  );

  if (!loaded.joined) await joinAgent(client, roomId, agentMxid);
  await setAgentTyping(client, roomId, agentMxid, true);
  let plan: HubTurnPlan;
  try {
    plan = await (deps.turn ?? runTurn)(
      session,
      ctx,
      {
        agentId: loaded.agentId,
        conversation: { hub: "inbox", roomId },
        messages: input.fresh.map((m) => m.body),
        context: input.context,
        limits: {
          maxMessages: loaded.service.max_messages,
          maxChars: loaded.service.max_chars,
        },
      },
      deps.turnDeps,
    );
  } catch (error) {
    await setAgentTyping(client, roomId, agentMxid, false);
    throw error;
  }

  // The team may have taken the conversation during the turn.
  const after = await readConversationState(client, roomId);
  if (after.status !== "pending") {
    await setAgentTyping(client, roomId, agentMxid, false);
    return { status: "taken_during_turn", messages: input.fresh.length };
  }

  const parts = shapeAnswer(plan.messages, loaded.service, MAX_PART);
  const pause = deps.sleep ?? sleep;
  let sent = 0;
  for (const [index, part] of parts.entries()) {
    if (index > 0) {
      await setAgentTyping(client, roomId, agentMxid, true);
      if (loaded.service.interval_ms > 0) {
        await pause(loaded.service.interval_ms);
      }
    }
    await sendAsAgent(
      client,
      roomId,
      agentMxid,
      `guids-${session.jobRunId}-${index}`,
      part,
    );
    sent += 1;
  }
  await setAgentTyping(client, roomId, agentMxid, false);

  let handoff = 0;
  if (plan.handoff) {
    const { summary, reason } = plan.handoff;
    await session.transaction((tx) =>
      tx.inboxGuidsRoom.update({
        where: { roomId },
        data: {
          handoffSummary: summary.trim().slice(0, 4000) || "—",
          handoffReason: reason.trim().slice(0, 1000) || null,
          handoffAt: new Date(),
        },
      }),
    );
    // The core writes the state: open, without an assignee ("Não
    // atribuídas"); the mirror follows from the Application Service.
    await setConversationState(client, roomId, {
      status: "open",
      assignee: null,
    });
    handoff = 1;
    await noticeHandoff(session, ctx, roomId);
    appLog.info("inbox.guids.handoff", {
      executionId: session.jobRunId,
      workspaceId: ctx.workspaceId,
    });
  }
  return {
    status: "answered",
    messages: input.fresh.length,
    parts: parts.length,
    sent,
    handoff,
  };
}

/**
 * The GUIDS handed a conversation to the team: the notice "conversa nova"
 * of the IN4b goes to the attendants. Wired at the merge with the IN4b
 * (`noticeNewConversation(tx, { roomId, workspaceId, consumerName })` of
 * `./notices.ts`); until then it does nothing.
 */
async function noticeHandoff(
  session: JobSession,
  ctx: RequestContext,
  roomId: string,
): Promise<void> {
  // MERGE-IN4B: call noticeNewConversation here, in a transaction of
  // `session`, with `ctx.workspaceId` and `roomId`.
  void session;
  void ctx;
  void roomId;
}

export function createGuidsTurnJob(deps: GuidsTurnDeps = {}) {
  return defineDetachedJob<GuidsTurnPayload>({
    kind: INBOX_GUIDS_TURN_KIND,
    description: "Resposta do GUIDS a uma conversa do Inbox.",
    payload: GuidsTurnPayload,
    // The answer is not asked twice of the GUIDS (the claim above).
    maxAttempts: 1,
    expireInSeconds: 240,
    group: (payload) => payload.roomId,
    run: (session, ctx, payload) => runGuidsTurn(session, ctx, payload, deps),
  });
}

export const guidsTurnJob = createGuidsTurnJob();
