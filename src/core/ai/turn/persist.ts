import "server-only";

import type { Prisma } from "@prisma/client";

import { type AuditOrigin, recordAudit } from "@/core/audit/record";
import type { AIProvider } from "@/core/credentials/vault";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { delegationUntil } from "../delegation";
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
  /** A specialist wrote it while the contact talks to the reception (GF2). */
  viaDelegation?: boolean;
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
    // GF2: who wrote the row, and whether by a delegation. Only the GUIDS
    // turns say it (the Assistant's agent is not a GUIDS of a workspace).
    ...(record.viaDelegation === undefined
      ? {}
      : { authorAgentId: record.agentId, viaDelegation: record.viaDelegation }),
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
 * A failed model call in the usage (CF6a): zero tokens and the error code,
 * so the AI dashboard counts errors by provider and by partner. Without
 * RETURNING, like the usage of a turn.
 */
async function recordFailedCall(
  tx: ContextTransaction,
  args: Readonly<{
    executionId: string;
    agentId: string;
    conversationId: string;
    errorCode: string;
    provider: AIProvider;
    model: string;
    owner: UsageOwner;
  }>,
): Promise<void> {
  await tx.aiUsageEvent.createMany({
    data: {
      executionId: args.executionId,
      partnerId: args.owner.partnerId,
      organizationId: args.owner.organizationId,
      workspaceId: args.owner.workspaceId,
      agentId: args.agentId,
      conversationId: args.conversationId,
      keySource: args.owner.keySource,
      provider: args.provider,
      model: args.model.slice(0, 200),
      usageKind: "chat",
      errorCode: args.errorCode.slice(0, 80),
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
    /** Whose key failed: with provider and model, the call goes to the usage. */
    owner?: UsageOwner;
    viaDelegation?: boolean;
    records?: readonly ToolCallRecord[];
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
): Promise<void> {
  if (args.owner && args.provider && args.model) {
    await recordFailedCall(tx, {
      ...args,
      provider: args.provider,
      model: args.model,
      owner: args.owner,
    });
  }
  await tx.aiMessage.create({
    data: {
      conversationId: args.conversationId,
      executionId: args.executionId,
      role: "assistant",
      content: "",
      errorCode: args.errorCode,
      provider: args.provider ?? null,
      model: args.model ?? null,
      ...(args.viaDelegation === undefined
        ? {}
        : { authorAgentId: args.agentId, viaDelegation: args.viaDelegation }),
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
    /** The customer's key that failed, for the usage (CF6a). */
    failed?: Readonly<{
      provider: AIProvider;
      model: string;
      owner: UsageOwner;
    }>;
    records: readonly ToolCallRecord[];
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
): Promise<void> {
  if (args.failed) await recordFailedCall(tx, { ...args, ...args.failed });
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

/**
 * The automatic answer after hours (A6c): one assistant message of the
 * turn, written without a model, so no usage; the audit says why.
 */
export async function persistAutoReply(
  tx: ContextTransaction,
  args: Readonly<{
    conversationId: string;
    agentId: string;
    executionId: string;
    content: string;
    /** The turn's time: the next turn compares it with the hours. */
    at: Date;
    viaDelegation?: boolean;
    audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
  }>,
): Promise<void> {
  const now = args.at;
  await tx.aiMessage.create({
    data: {
      conversationId: args.conversationId,
      executionId: args.executionId,
      role: "assistant",
      content: args.content,
      createdAt: now,
      authorAgentId: args.agentId,
      viaDelegation: args.viaDelegation ?? false,
    },
    select: { id: true },
  });
  await tx.aiConversation.updateMany({
    where: { id: args.conversationId },
    data: { lastMessageAt: now },
  });
  await recordAudit(tx, args.audit.ctx, {
    action: "ai.turn",
    resourceType: "ai_conversation",
    resourceId: args.conversationId,
    result: "success",
    origin: args.audit.origin,
    metadata: {
      executionId: args.executionId,
      agentId: args.agentId,
      autoReply: "after_hours",
    },
  });
}

type DelegationTurn = Readonly<{
  conversationId: string;
  /** The orchestrator, which asked for the delegation. */
  agentId: string;
  executionId: string;
  audit: Readonly<{ ctx: RequestContext; origin: AuditOrigin }>;
}>;

/**
 * The orchestrator handed the conversation to a specialist (GF2): the
 * conversation is the specialist's until it returns it, the conversation is
 * resolved or the contact is silent for 24 h, and the audit says who handed
 * it to whom, never what was said.
 */
export async function persistDelegation(
  tx: ContextTransaction,
  turn: DelegationTurn,
  to: Readonly<{ role: string; agentId: string }>,
  now: Date,
): Promise<void> {
  await tx.aiConversation.updateMany({
    where: { id: turn.conversationId },
    data: {
      delegatedAgentId: to.agentId,
      delegatedUntil: delegationUntil(now),
    },
  });
  await recordAudit(tx, turn.audit.ctx, {
    action: "ai_agents.guid.delegate",
    resourceType: "ai_conversation",
    resourceId: turn.conversationId,
    result: "success",
    origin: turn.audit.origin,
    metadata: {
      executionId: turn.executionId,
      agentId: turn.agentId,
      target: to.agentId,
      from: "orchestrator",
      to: to.role,
    },
  });
}

/**
 * The delegation ended (GF2): the specialist returned the conversation, or
 * the conversation went to the team. `reason` is a code, never text.
 */
export async function persistDelegationEnd(
  tx: ContextTransaction,
  turn: DelegationTurn,
  end: Readonly<{
    action: string;
    role: string;
    code?: string;
    /** A test conversation: the hand-over is told, not written (as the simulated `handoff`). */
    keepStatus?: boolean;
  }>,
): Promise<void> {
  await tx.aiConversation.updateMany({
    where: { id: turn.conversationId },
    data: { delegatedAgentId: null, delegatedUntil: null },
  });
  // A failed delegation goes to the team, as the `handoff` tool does.
  if (end.code && !end.keepStatus) {
    await tx.aiConversation.updateMany({
      where: { id: turn.conversationId, status: "active" },
      data: { status: "handoff" },
    });
  }
  await recordAudit(tx, turn.audit.ctx, {
    action: end.action,
    resourceType: "ai_conversation",
    resourceId: turn.conversationId,
    result: end.code ? "error" : "success",
    origin: turn.audit.origin,
    metadata: {
      executionId: turn.executionId,
      agentId: turn.agentId,
      from: end.role,
      to: end.action === "ai_agents.guid.return" ? "orchestrator" : "team",
      ...(end.code ? { reason: end.code } : {}),
    },
  });
}
