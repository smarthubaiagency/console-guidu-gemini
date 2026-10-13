import "server-only";

import { z } from "zod";

import { guidTurnJob } from "@/core/ai/turn/guid";
import { TURN_LIMITS } from "@/core/ai/turn/types";
import { enqueueJob } from "@/core/jobs/service";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

/**
 * Test conversation of a GUIDS (A2b): a person of the workspace writes to
 * the agent and the worker answers (`ai-agents.guid-turn`). The screen of
 * "Testar agente" arrives in A4 and the real channels in A5; this service
 * is the entry both will use for a message that starts a turn.
 */

const MODULE_KEY = "ai-agents";

export const GuidTestMessageInput = z.strictObject({
  agentId: z.uuid(),
  /** Absent: a new test conversation. */
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(TURN_LIMITS.maxUserMessage),
});

export type GuidTestMessageResult = Readonly<{
  conversationId: string;
  messageId: string;
  jobRunId: string;
}>;

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Conversa ou agente não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

export async function sendGuidTestMessage(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<GuidTestMessageResult> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  const parsed = GuidTestMessageInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Mensagem inválida.",
    });
  }
  const { agentId, conversationId, text } = parsed.data;

  const agent = await tx.aiAgent.findFirst({
    where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
    select: { id: true, status: true },
  });
  if (!agent) throw notFound();
  if (agent.status === "paused") {
    throw new AppError({
      code: "conflict",
      safeMessage: "O agente está pausado.",
    });
  }

  let conversation: { id: string; status: string };
  if (conversationId) {
    const found = await tx.aiConversation.findFirst({
      where: {
        id: conversationId,
        kind: "guid",
        agentId,
        workspaceId: ctx.workspaceId,
        channel: "test",
        userId: ctx.userId,
      },
      select: { id: true, status: true },
    });
    if (!found) throw notFound();
    conversation = found;
  } else {
    conversation = await tx.aiConversation.create({
      data: {
        kind: "guid",
        agentId,
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        channel: "test",
      },
      select: { id: true, status: true },
    });
  }
  if (conversation.status !== "active") {
    throw new AppError({
      code: "conflict",
      safeMessage: "Esta conversa não está mais com o agente.",
    });
  }

  const message = await tx.aiMessage.create({
    data: { conversationId: conversation.id, role: "user", content: text },
    select: { id: true },
  });
  await tx.aiConversation.updateMany({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  const run = await enqueueJob(
    tx,
    ctx,
    guidTurnJob,
    { conversationId: conversation.id, messageId: message.id },
    { idempotencyKey: `ai-turn:${message.id}` },
  );
  return {
    conversationId: conversation.id,
    messageId: message.id,
    jobRunId: run.id,
  };
}
