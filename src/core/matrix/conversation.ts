import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { ATTENDANT_LOCALPART } from "./jwt";
import {
  CONVERSATION_STATE,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  type InboxAccess,
  MatrixHttpError,
  REPLY_POWER,
  setConversationState,
  type SynapseClient,
} from "./synapse";

/**
 * Changes of the conversation state from the Inbox (IN4a). The attendants
 * have no power over the state in the room: the console checks who may do
 * what and writes the new state as the core, which mirrors it back from the
 * Application Service.
 * - take: whoever answers, when the conversation has nobody or is theirs
 *   (a manager who answers may take it from someone);
 * - resolve and reopen: whoever answers (decision of 17/10/2026);
 * - assign to someone (or to nobody): the managers (`inbox.manage`), to a
 *   person who answers in that room.
 */

export type ConversationAction =
  | Readonly<{ kind: "take" }>
  | Readonly<{ kind: "resolve" }>
  | Readonly<{ kind: "reopen" }>
  | Readonly<{ kind: "assign"; assignee: string | null }>;

export type ConversationState = Readonly<{
  status: ConversationStatus;
  assignee: string | null;
}>;

export type InboxActor = Readonly<{
  /** The person's Matrix account, when they have one. */
  mxid: string | null;
  level: InboxAccess | null;
  manages: boolean;
}>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "errors.permissionDenied",
  });
}

function conflict(safeMessage: string, messageKey: string): AppError {
  return new AppError({ code: "conflict", safeMessage, messageKey });
}

/** The state the room holds now (read as the core), or the default. */
export async function readConversationState(
  client: SynapseClient,
  roomId: string,
): Promise<ConversationState> {
  try {
    const content = await client.request<{
      status?: unknown;
      assignee?: unknown;
    }>(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${CONVERSATION_STATE}/`,
    );
    const status = (CONVERSATION_STATUSES as readonly unknown[]).includes(
      content.status,
    )
      ? (content.status as ConversationStatus)
      : "pending";
    const assignee =
      typeof content.assignee === "string" ? content.assignee : null;
    return { status, assignee };
  } catch (error) {
    if (error instanceof MatrixHttpError && error.status === 404) {
      return { status: "pending", assignee: null };
    }
    throw error;
  }
}

/** The next state, or an error when the actor may not do it. */
export function nextConversationState(
  current: ConversationState,
  action: ConversationAction,
  actor: InboxActor,
): ConversationState {
  const answers = actor.level === "reply" && actor.mxid !== null;
  switch (action.kind) {
    case "take": {
      if (!answers) throw denied();
      if (
        current.assignee !== null &&
        current.assignee !== actor.mxid &&
        !actor.manages
      ) {
        throw conflict(
          "Esta conversa já tem um responsável.",
          "inbox.errors.alreadyAssigned",
        );
      }
      return { status: "open", assignee: actor.mxid };
    }
    case "resolve": {
      if (!answers) throw denied();
      return { status: "resolved", assignee: current.assignee };
    }
    case "reopen": {
      if (!answers) throw denied();
      if (current.status !== "resolved") {
        throw conflict(
          "A conversa não está resolvida.",
          "inbox.errors.notResolved",
        );
      }
      return { status: "open", assignee: current.assignee ?? actor.mxid };
    }
    case "assign": {
      if (!actor.manages) throw denied();
      return action.assignee === null
        ? { status: "pending", assignee: null }
        : { status: "open", assignee: action.assignee };
    }
  }
}

/**
 * Applies an action to a room of the context workspace. `tx` runs in the
 * web context: the room is found through its policies, so a room of
 * another workspace is "not found".
 */
export async function changeConversation(
  tx: ContextTransaction,
  client: SynapseClient,
  input: Readonly<{
    roomId: string;
    action: ConversationAction;
    actor: InboxActor;
  }>,
): Promise<ConversationState> {
  const room = await tx.matrixRoom.findFirst({
    where: { roomId: input.roomId, state: "active" },
    select: { roomId: true },
  });
  if (!room?.roomId) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Conversa não encontrada.",
      messageKey: "inbox.errors.conversationNotFound",
    });
  }
  if (input.action.kind === "assign" && input.action.assignee !== null) {
    const target = input.action.assignee;
    const local = /^@([^:]+):/.exec(target)?.[1] ?? "";
    const member = ATTENDANT_LOCALPART.test(local)
      ? await tx.matrixRoomMember.findUnique({
          where: {
            roomId_userMxid: { roomId: room.roomId, userMxid: target },
          },
          select: { membership: true, power: true },
        })
      : null;
    if (member?.membership !== "join" || member.power !== REPLY_POWER) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Só um atendente desta conversa pode ser o responsável.",
        messageKey: "inbox.errors.assigneeNotAttendant",
      });
    }
  }
  const current = await readConversationState(client, room.roomId);
  const next = nextConversationState(current, input.action, input.actor);
  if (next.status === current.status && next.assignee === current.assignee) {
    return next;
  }
  await setConversationState(client, room.roomId, next, input.actor.mxid);
  return next;
}
