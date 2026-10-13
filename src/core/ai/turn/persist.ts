import "server-only";

import type { Prisma } from "@prisma/client";

import { type AuditOrigin, recordAudit } from "@/core/audit/record";
import type { AIProvider } from "@/core/credentials/vault";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import type { ToolCallRecord } from "../tools/guard";

/**
 * What a turn writes at its end, in one short transaction (A2b): the
 * model's tool calls and their results, the answer, the usage and the
 * audit, all with the turn's execution id. The conversation text stays in
 * `ai_messages`, under RLS; the audit keeps only hashes and masked input.
 */

/** The parts of an SDK step the engine keeps. */
type StepPart = Readonly<{
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}>;

export type TurnStep = Readonly<{ content: readonly StepPart[] }>;

export type UsageOwner = Readonly<{
  keySource: "customer" | "admin" | "backup";
  partnerId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
}>;

export type TurnRecord = Readonly<{
  conversationId: string;
  agentId: string;
  executionId: string;
  provider: AIProvider;
  model: string;
  steps: readonly TurnStep[];
  /** The answer, one row per message. */
  answer: readonly string[];
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
  records: readonly ToolCallRecord[];
  owner: UsageOwner;
  audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
}>;

/** The text the model sees again for a tool call that was refused. */
const REFUSED = JSON.stringify({
  ok: false,
  error: "Ferramenta não permitida.",
});

function rows(record: TurnRecord, start: Date) {
  const data: Prisma.AiMessageCreateManyInput[] = [];
  // Rows of one transaction share now(): explicit, increasing times keep
  // the order of the turn.
  const at = () => new Date(start.getTime() + data.length);
  const base = {
    conversationId: record.conversationId,
    executionId: record.executionId,
  };
  for (const step of record.steps) {
    const calls = step.content.filter((p) => p.type === "tool-call");
    if (calls.length === 0) continue;
    data.push({
      ...base,
      createdAt: at(),
      role: "assistant",
      content: step.content
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("")
        .slice(0, 100_000),
      toolCalls: calls.map((p) => ({
        id: p.toolCallId,
        name: p.toolName,
        input: (p.input ?? null) as Prisma.InputJsonValue,
      })),
      provider: record.provider,
      model: record.model,
    });
    // Results come in the order they finished; the rows follow the calls.
    const order = new Map(calls.map((p, index) => [p.toolCallId, index]));
    const results = step.content
      .filter((p) => p.type === "tool-result" || p.type === "tool-error")
      .sort(
        (a, b) =>
          (order.get(a.toolCallId) ?? calls.length) -
          (order.get(b.toolCallId) ?? calls.length),
      );
    for (const part of results) {
      data.push({
        ...base,
        createdAt: at(),
        role: "tool",
        toolCallId: String(part.toolCallId ?? "").slice(0, 200) || "unknown",
        toolName: String(part.toolName ?? "").slice(0, 80),
        content:
          part.type === "tool-result"
            ? JSON.stringify(part.output ?? null).slice(0, 100_000)
            : REFUSED,
      });
    }
  }
  record.answer.forEach((text, index) => {
    const last = index === record.answer.length - 1;
    data.push({
      ...base,
      createdAt: at(),
      role: "assistant",
      content: text.slice(0, 100_000),
      provider: record.provider,
      model: record.model,
      // The turn's tokens go on its last message.
      ...(last
        ? {
            inputTokens: record.usage.inputTokens,
            outputTokens: record.usage.outputTokens,
          }
        : {}),
    });
  });
  return data;
}

/** One audit event per tool call, with hashes and masked input only. */
async function auditCalls(
  tx: ContextTransaction,
  turn: Readonly<{
    conversationId: string;
    agentId: string;
    executionId: string;
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
  calls: readonly ToolCallRecord[],
): Promise<void> {
  for (const call of calls) {
    await recordAudit(tx, turn.audit.ctx, {
      action: "ai.tool.call",
      resourceType: "ai_conversation",
      resourceId: turn.conversationId,
      result:
        call.decision === "allow"
          ? "success"
          : call.decision === "error"
            ? "error"
            : "denied",
      origin: turn.audit.origin,
      metadata: {
        executionId: turn.executionId,
        agentId: turn.agentId,
        tool: call.tool,
        decision: call.decision,
        rule: call.rule,
        reason: call.reason,
        inputHash: call.inputHash,
        outputHash: call.outputHash,
        payload: call.payload,
        errorId: call.errorId,
      },
    });
  }
}

export async function persistTurn(
  tx: ContextTransaction,
  record: TurnRecord,
): Promise<void> {
  const now = new Date();
  const data = rows(record, now);
  if (data.length > 0) await tx.aiMessage.createMany({ data });
  await tx.aiConversation.updateMany({
    where: { id: record.conversationId },
    data: { lastMessageAt: now },
  });
  // Without RETURNING: the person who talks does not always read usage.
  await tx.aiUsageEvent.createMany({
    data: {
      executionId: record.executionId,
      partnerId: record.owner.partnerId,
      organizationId: record.owner.organizationId,
      workspaceId: record.owner.workspaceId,
      agentId: record.agentId,
      conversationId: record.conversationId,
      keySource: record.owner.keySource,
      provider: record.provider,
      model: record.model,
      usageKind: "chat",
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
    },
  });
  await auditCalls(tx, record, record.records);
  await recordAudit(tx, record.audit.ctx, {
    action: "ai.turn",
    resourceType: "ai_conversation",
    resourceId: record.conversationId,
    result: "success",
    origin: record.audit.origin,
    metadata: {
      executionId: record.executionId,
      agentId: record.agentId,
      provider: record.provider,
      model: record.model,
    },
  });
}

/**
 * A turn that did not reach an answer: one assistant row with the error
 * code (empty content; the screens show a message of their own) and the
 * audit. Tool calls already made are kept with their records.
 */
export async function persistTurnError(
  tx: ContextTransaction,
  args: Readonly<{
    conversationId: string;
    agentId: string;
    executionId: string;
    errorCode: string;
    provider?: AIProvider | null;
    model?: string | null;
    records?: readonly ToolCallRecord[];
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
): Promise<void> {
  await tx.aiMessage.create({
    data: {
      conversationId: args.conversationId,
      executionId: args.executionId,
      role: "assistant",
      content: "",
      errorCode: args.errorCode,
      provider: args.provider ?? null,
      model: args.model ?? null,
    },
    select: { id: true },
  });
  await auditCalls(tx, args, args.records ?? []);
  await recordAudit(tx, args.audit.ctx, {
    action: "ai.turn",
    resourceType: "ai_conversation",
    resourceId: args.conversationId,
    result: "error",
    origin: args.audit.origin,
    metadata: {
      executionId: args.executionId,
      agentId: args.agentId,
      reason: args.errorCode,
    },
  });
}

/**
 * The customer's key failed (A2c): the tool calls already made and the
 * failure go to the audit; the turn goes on with the backup, or ends with
 * `persistTurnError`.
 */
export async function persistKeyFailure(
  tx: ContextTransaction,
  args: Readonly<{
    conversationId: string;
    agentId: string;
    executionId: string;
    errorCode: string;
    /** Whether this failure started the backup. */
    started: boolean;
    records: readonly ToolCallRecord[];
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
): Promise<void> {
  await auditCalls(tx, args, args.records);
  await recordAudit(tx, args.audit.ctx, {
    action: "ai.agent.key_failure",
    resourceType: "ai_agent",
    resourceId: args.agentId,
    result: "error",
    origin: args.audit.origin,
    metadata: {
      executionId: args.executionId,
      agentId: args.agentId,
      reason: args.errorCode,
      to: args.started ? "backup" : "unchanged",
    },
  });
}
