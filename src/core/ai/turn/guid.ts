import "server-only";

import {
  APICallError,
  generateText,
  isStepCount,
  NoSuchToolError,
  Output,
  type ModelMessage,
} from "ai";
import { z } from "zod";

import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import { resolveQuota } from "@/core/entitlements/quotas";
import { defineDetachedJob, type JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  backupServes,
  isKeyFailure,
  loadBackupKey,
  startKeyBackup,
} from "../backup";
import { type AgentConfig, parseAgentConfig } from "../config/schema";
import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
} from "../providers";
import { renderSystemPrompt } from "../prompt/render";
import { promptLocale } from "../prompt/texts";
import { buildTools, recordRefusedCall, type ToolEnv } from "../tools/catalog";
import { contextValues } from "./context";
import { persistKeyFailure, persistTurn, persistTurnError } from "./persist";
import { ResponsePlan, turnErrorCode } from "./plan";
import { TURN_LIMITS, type TurnState } from "./types";

/**
 * Turn of a GUIDS (A2b), a detached job of the worker: it answers one
 * message of a conversation with the customer's key, as the person who
 * sent it (the test of the agent until the channels of the A5).
 *
 * 1. A short transaction loads the conversation, the agent and the key and
 *    checks that the turn may run (module, permission, paused agent, plan
 *    limit, prompt, model and key).
 * 2. The model runs outside any transaction; each tool opens its own.
 * 3. A short transaction writes the answer, the usage and the audit.
 *
 * When the customer's key fails, the turn goes on with the platform key
 * (A2c, `../backup.ts`), only in a conversation opened before the failure.
 *
 * The answer is a response plan (canais.md §6.1) validated by Zod before
 * it is written. The job's run id is the turn's execution id: a turn that
 * already wrote its answer is not answered again.
 */

export const GUID_TURN_JOB_KIND = "ai-agents.guid-turn";

export const GuidTurnPayload = z.strictObject({
  conversationId: z.uuid(),
  messageId: z.uuid(),
});
export type GuidTurnPayload = z.infer<typeof GuidTurnPayload>;

export type GuidTurnDeps = Readonly<{
  createModel?: ModelFactory;
  now?: () => Date;
}>;

const MODULE_KEY = "ai-agents";

type Blocked = Readonly<{
  kind: "blocked";
  code: string;
  message: string;
  conversationId: string;
  agentId: string;
}>;

type TurnKey = ChatModelKey & Readonly<{ source: "customer" | "backup" }>;

type Ready = Readonly<{
  kind: "ready";
  conversationId: string;
  agentId: string;
  conversationCreatedAt: Date;
  config: AgentConfig;
  key: TurnKey;
  systemPrompt: string;
  history: ModelMessage[];
  state: TurnState;
}>;

function blocked(
  code: string,
  message: string,
  ids: Readonly<{ conversationId: string; agentId: string }>,
): Blocked {
  return { kind: "blocked", code, message, ...ids };
}

async function loadTurn(
  tx: ContextTransaction,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  executionId: string,
  now: Date,
): Promise<Ready | Blocked | { kind: "done" }> {
  // RLS shows the conversation only to who may read it.
  const conversation = await tx.aiConversation.findFirst({
    where: {
      id: payload.conversationId,
      kind: "guid",
      workspaceId: ctx.workspaceId,
    },
  });
  if (!conversation) throw new SkipJobError("Conversa não encontrada.");
  const answered = await tx.aiMessage.count({
    where: { conversationId: conversation.id, executionId },
  });
  if (answered > 0) return { kind: "done" };
  const message = await tx.aiMessage.findFirst({
    where: {
      id: payload.messageId,
      conversationId: conversation.id,
      role: "user",
    },
    select: { id: true },
  });
  if (!message) throw new SkipJobError("Mensagem não encontrada.");

  const ids = {
    conversationId: conversation.id,
    agentId: conversation.agentId,
  };
  try {
    await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  } catch (error) {
    if (!(error instanceof ModuleUnavailableError)) throw error;
    return blocked(
      "module_unavailable",
      "O módulo de agentes não está disponível neste workspace.",
      ids,
    );
  }
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  if (conversation.status !== "active") {
    return blocked(
      `conversation_${conversation.status}`,
      "A conversa não está mais com o agente.",
      ids,
    );
  }

  const agent = await tx.aiAgent.findFirst({
    where: {
      id: conversation.agentId,
      kind: "guid",
      workspaceId: ctx.workspaceId,
    },
  });
  if (!agent) throw new SkipJobError("Agente não encontrado.");
  if (agent.status === "paused") {
    return blocked("agent_paused", "O agente está pausado.", ids);
  }
  if (agent.keyState === "failed") {
    return blocked("key_failed", "A chave do agente falhou.", ids);
  }
  if (
    agent.keyState === "backup" &&
    (!agent.backupStartedAt ||
      !backupServes(conversation.createdAt, agent.backupStartedAt, now))
  ) {
    // The backup only finishes conversations already open (§9.2).
    return blocked(
      "key_failed",
      "A chave do agente falhou; o backup só termina conversas já abertas.",
      ids,
    );
  }
  const [count, quota] = await Promise.all([
    tx.aiAgent.count({ where: { workspaceId: ctx.workspaceId, kind: "guid" } }),
    resolveQuota(tx, ctx.organizationId, "ai-agents.max"),
  ]);
  if (quota.limit !== null && count > quota.limit) {
    return blocked(
      "plan_limit",
      "O workspace tem mais agentes do que o plano permite.",
      ids,
    );
  }
  const parsed = parseAgentConfig("guid", agent.configVersion, agent.config);
  if (!parsed.success) {
    return blocked(
      "invalid_config",
      "A configuração do agente é inválida.",
      ids,
    );
  }
  const config = parsed.data;
  let key: TurnKey;
  if (agent.keyState === "backup") {
    const backup = await loadBackupKey(tx, agent.id);
    if (!backup) {
      return blocked(
        "key_failed",
        "A chave do agente falhou e não há chave de backup.",
        ids,
      );
    }
    key = { ...backup, source: "backup" };
  } else {
    const credentialId = config.model.credential_id;
    const modelName = config.model.model_name;
    if (!credentialId || !modelName) {
      return blocked(
        "no_model",
        "O agente não tem chave e modelo escolhidos.",
        ids,
      );
    }
    const credential = await tx.credential.findFirst({
      where: {
        id: credentialId,
        workspaceId: ctx.workspaceId,
        status: "active",
        purpose: { in: ["chat", "all"] },
      },
      select: { provider: true, encryptedPayload: true },
    });
    if (!credential) {
      return blocked("no_key", "A chave do agente não está ativa.", ids);
    }
    key = {
      provider: credential.provider as AIProvider,
      secret: decryptSecret(credential.encryptedPayload),
      model: modelName,
      source: "customer",
    };
  }

  const [contact, organization, workspace, role, messagesCount, recent] =
    await Promise.all([
      conversation.contactId
        ? tx.crmContact.findFirst({
            where: { id: conversation.contactId, workspaceId: ctx.workspaceId },
          })
        : null,
      tx.organization.findFirst({
        where: { id: ctx.organizationId },
        select: { name: true },
      }),
      tx.workspace.findFirst({
        where: { id: ctx.workspaceId },
        select: { name: true, defaultLocale: true },
      }),
      getEffectiveWorkspaceRole(tx, ctx),
      tx.aiMessage.count({ where: { conversationId: conversation.id } }),
      tx.aiMessage.findMany({
        where: {
          conversationId: conversation.id,
          role: { in: ["user", "assistant"] },
          errorCode: null,
          content: { not: "" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: TURN_LIMITS.historyMessages,
        select: { role: true, content: true },
      }),
    ]);

  const memory = (conversation.variables ?? {}) as Record<string, unknown>;
  const locale = promptLocale(config.overview.language);
  const systemPrompt = renderSystemPrompt({
    kind: "guid",
    config,
    locale,
    memory,
    context: contextValues({
      kind: "guid",
      agentId: agent.id,
      config,
      now,
      dateLocale: config.overview.language ?? "pt-BR",
      company: {
        name: organization?.name ?? workspace?.name ?? null,
        locale: workspace?.defaultLocale ?? null,
      },
      user: { name: null, role },
      contact: contact
        ? {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            companyName: contact.companyName,
            jobTitle: contact.jobTitle,
          }
        : null,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        startedAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        messagesCount,
      },
    }),
  });
  if (!systemPrompt) {
    return blocked("no_prompt", "O agente não tem prompt.", ids);
  }

  return {
    kind: "ready",
    ...ids,
    conversationCreatedAt: conversation.createdAt,
    config,
    key,
    systemPrompt,
    history: recent
      .reverse()
      .map((m): ModelMessage =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content },
      ),
    state: {
      contactId: conversation.contactId,
      status: conversation.status as TurnState["status"],
      memory: { ...memory },
      records: [],
    },
  };
}

export async function runGuidTurn(
  session: JobSession,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  deps: GuidTurnDeps = {},
): Promise<Record<string, string | number>> {
  const executionId = session.jobRunId;
  const now = deps.now ?? (() => new Date());
  const audit = { ctx, origin: "worker" as const };
  const loaded = await session.transaction((tx) =>
    loadTurn(tx, ctx, payload, executionId, now()),
  );
  if (loaded.kind === "done") return { status: "already_answered" };
  if (loaded.kind === "blocked") {
    await session.transaction((tx) =>
      persistTurnError(tx, {
        conversationId: loaded.conversationId,
        agentId: loaded.agentId,
        executionId,
        errorCode: loaded.code,
        audit,
      }),
    );
    throw new SkipJobError(loaded.message);
  }

  const { config, state } = loaded;
  const env: ToolEnv = {
    kind: "guid",
    executionId,
    agentId: loaded.agentId,
    conversationId: loaded.conversationId,
    config,
    locale: promptLocale(config.overview.language),
    db: session,
    workspace: ctx,
    prisma: null,
    now,
    state,
  };
  const turn = {
    conversationId: loaded.conversationId,
    agentId: loaded.agentId,
    executionId,
    audit,
  };

  // The tools keep their state between the two attempts: a contact
  // created by the first is not created again by the second.
  const answerWith = async (key: TurnKey) => {
    const result = await generateText({
      model: (deps.createModel ?? createChatModel)(key),
      instructions: loaded.systemPrompt,
      messages: loaded.history,
      tools: buildTools(env),
      output: Output.object({ schema: ResponsePlan }),
      stopWhen: isStepCount(TURN_LIMITS.maxSteps),
      maxOutputTokens: TURN_LIMITS.maxOutputTokens,
      timeout: { totalMs: TURN_LIMITS.totalMs },
      maxRetries: 1,
      repairToolCall: async ({ toolCall, error }) => {
        if (NoSuchToolError.isInstance(error)) {
          recordRefusedCall(
            env,
            toolCall.toolName,
            toolCall.toolCallId,
            toolCall.input,
          );
        }
        return null;
      },
    });
    return {
      answer: ResponsePlan.parse(result.output),
      steps: result.steps,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      },
    };
  };

  const fail = async (key: TurnKey, error: unknown): Promise<never> => {
    const errorCode = turnErrorCode(error);
    appLog.warn("ai.turn.failed", {
      executionId,
      errorCode,
      keySource: key.source,
      status: APICallError.isInstance(error) ? error.statusCode : undefined,
    });
    await session.transaction((tx) =>
      persistTurnError(tx, {
        ...turn,
        errorCode,
        provider: key.provider,
        model: key.model,
        records: state.records,
      }),
    );
    throw new AppError({
      code: "provider_error",
      safeMessage: "O modelo do agente não respondeu.",
    });
  };

  let key = loaded.key;
  let outcome: Awaited<ReturnType<typeof answerWith>>;
  try {
    outcome = await answerWith(key);
  } catch (error) {
    const errorCode = turnErrorCode(error);
    if (key.source !== "customer" || !isKeyFailure(errorCode)) {
      return fail(key, error);
    }
    appLog.warn("ai.turn.key_failed", { executionId, errorCode });
    const backup = await session.transaction(async (tx) => {
      const started = await startKeyBackup(tx, loaded.agentId);
      await persistKeyFailure(tx, {
        ...turn,
        errorCode,
        started: started?.started ?? false,
        records: state.records,
      });
      if (
        !started ||
        !backupServes(loaded.conversationCreatedAt, started.startedAt, now())
      ) {
        return null;
      }
      return loadBackupKey(tx, loaded.agentId);
    });
    // Already in the audit with the failure.
    state.records.length = 0;
    if (!backup) return fail(key, error);
    key = { ...backup, source: "backup" };
    try {
      outcome = await answerWith(key);
    } catch (backupError) {
      return fail(key, backupError);
    }
  }

  const used = key;
  await session.transaction(async (tx) => {
    await persistTurn(tx, {
      ...turn,
      provider: used.provider,
      model: used.model,
      steps: outcome.steps,
      answer: outcome.answer.messages,
      usage: outcome.usage,
      records: state.records,
      owner: {
        // The backup is a courtesy of the platform (§9.2).
        keySource: used.source,
        partnerId: null,
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (used.source === "backup") {
      await tx.aiConversation.updateMany({
        where: { id: loaded.conversationId, keyMode: "own" },
        data: { keyMode: "backup" },
      });
    }
  });
  return {
    status: state.status,
    keySource: used.source,
    messages: outcome.answer.messages.length,
    tools: state.records.length,
  };
}

/** The job; tests build one with a mock model. */
export function createGuidTurnJob(deps: GuidTurnDeps = {}) {
  return defineDetachedJob<GuidTurnPayload>({
    kind: GUID_TURN_JOB_KIND,
    description: "Resposta de um GUIDS a uma mensagem da conversa.",
    payload: GuidTurnPayload,
    // A model call is not repeated by the queue: the turn records its own
    // error and, when the customer's key fails, tries the backup itself.
    maxAttempts: 1,
    expireInSeconds: 180,
    run: (session, ctx, payload) => runGuidTurn(session, ctx, payload, deps),
  });
}

export const guidTurnJob = createGuidTurnJob();
