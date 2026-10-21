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
 * Test conversation of a GUIDS ("Testar agente", A2b and A4b, §5.3): a
 * person of the workspace writes to the agent and the worker answers
 * (`ai-agents.guid-turn`) with the real prompt and key and the tools
 * simulated. A paused or draft agent is tested too: the test is what turns
 * it on. The screen reads the conversation back with
 * `getGuidTestConversation` while the answer is on its way.
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
    select: { id: true, keyState: true },
  });
  if (!agent) throw notFound();
  if (agent.keyState === "failed") {
    throw new AppError({
      code: "conflict",
      safeMessage:
        "A chave do agente falhou. Teste a chave antes de conversar.",
      messageKey: "aiAgents.errors.keyFailed",
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

export type GuidTestToolCall = Readonly<{
  name: string;
  input: unknown;
  /** What the tool answered (simulated in a test), or null if refused. */
  output: unknown;
}>;

export type GuidTestMessageDto = Readonly<{
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Code of a turn that did not answer (`ai_messages.error_code`). */
  errorCode: string | null;
  /** The tools the agent called before this message. */
  tools: readonly GuidTestToolCall[];
  /** A specialist wrote it under the orchestrator's name (GF2). */
  answeredBy: "attendant" | "seller" | null;
  createdAt: string;
}>;

export type GuidTestConversationDto = Readonly<{
  conversationId: string;
  messages: readonly GuidTestMessageDto[];
  /** The last message of the person still waits for the agent. */
  waiting: boolean;
}>;

function answeredByRole(
  via: boolean,
  factoryRole: string | null | undefined,
): "attendant" | "seller" | null {
  return via && (factoryRole === "attendant" || factoryRole === "seller")
    ? factoryRole
    : null;
}

function parseOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/**
 * The test conversation of the person with a GUIDS: the one given, or the
 * latest. Each answer carries the tool calls that came before it, with
 * what they returned. Null when there is none yet.
 */
export async function getGuidTestConversation(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
  conversationId?: string,
): Promise<GuidTestConversationDto | null> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  if (!z.uuid().safeParse(agentId).success) throw notFound();
  if (conversationId && !z.uuid().safeParse(conversationId).success) {
    throw notFound();
  }
  const conversation = await tx.aiConversation.findFirst({
    where: {
      ...(conversationId ? { id: conversationId } : {}),
      kind: "guid",
      agentId,
      workspaceId: ctx.workspaceId,
      channel: "test",
      userId: ctx.userId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!conversation) {
    if (conversationId) throw notFound();
    return null;
  }
  const rows = await tx.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      role: true,
      content: true,
      toolCalls: true,
      toolCallId: true,
      errorCode: true,
      authorAgentId: true,
      viaDelegation: true,
      createdAt: true,
    },
  });
  // GF2: the role of the specialists that wrote answers by a delegation.
  const authorIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.viaDelegation && row.authorAgentId ? [row.authorAgentId] : [],
      ),
    ),
  ];
  const authors = new Map(
    (authorIds.length > 0
      ? await tx.aiAgent.findMany({
          where: { id: { in: authorIds }, workspaceId: ctx.workspaceId },
          select: { id: true, factoryRole: true },
        })
      : []
    ).map((agent) => [agent.id, agent.factoryRole]),
  );
  const outputs = new Map(
    rows
      .filter((row) => row.role === "tool" && row.toolCallId)
      .map((row) => [row.toolCallId, parseOutput(row.content)]),
  );
  const messages: GuidTestMessageDto[] = [];
  let pending: GuidTestToolCall[] = [];
  for (const row of rows) {
    if (row.role === "assistant") {
      const calls = Array.isArray(row.toolCalls)
        ? (row.toolCalls as { id?: string; name?: string; input?: unknown }[])
        : [];
      pending.push(
        ...calls.map((call) => ({
          name: String(call.name ?? ""),
          input: call.input ?? null,
          output: outputs.get(String(call.id ?? "")) ?? null,
        })),
      );
      // A row of tool calls only: its tools go with the next answer.
      if (calls.length > 0 && !row.content) continue;
    }
    if (row.role !== "user" && row.role !== "assistant") continue;
    messages.push({
      id: row.id,
      role: row.role,
      content: row.content,
      errorCode: row.errorCode,
      tools: row.role === "assistant" ? pending : [],
      answeredBy: answeredByRole(
        row.viaDelegation,
        authors.get(row.authorAgentId ?? ""),
      ),
      createdAt: row.createdAt.toISOString(),
    });
    if (row.role === "assistant") pending = [];
  }
  return {
    conversationId: conversation.id,
    messages,
    waiting: messages.at(-1)?.role === "user",
  };
}
