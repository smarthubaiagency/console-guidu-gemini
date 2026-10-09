/**
 * ============================================================================
 * File: src/core/agents/engine.ts
 * Module: AI Prompt & Agent Execution Engine with Resilient Fallbacks (C07)
 *
 * Maintenance Rationale:
 * - Implements Spec Section 16 & SMA-100 & C07:
 *   - Manages AI Agent Configurations with primary & fallback providers.
 *   - ai_agents.manage para criar e editar configuração.
 *   - ai_agents.use para executar e ler sessões.
 *   - Module remains frozen behind availability flag (C04), which blocks first.
 *   - Orchestrates prompt execution via decrypted BYOK keys inside `withContext`.
 *   - Resilient automated fallback across providers.
 * ============================================================================
 */

import "server-only";

import type { ContextTransaction, RequestContext } from "@/lib/prisma/with-context";
import { resolveProviderSecret, type AIProvider } from "@/core/credentials/vault";
import { assertModuleAvailable } from "@/core/modules/availability";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { executeProviderPrompt, type ExecutionResult } from "./providers/executor";

export type AgentConfigData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  primaryProvider: AIProvider;
  primaryModel: string;
  fallbackProvider: AIProvider | null;
  fallbackModel: string | null;
  temperature: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentSessionData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  agentConfigId: string | null;
  title: string;
  createdByUserId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentMessageData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  role: string;
  content: string;
  providerUsed: string;
  modelUsed: string;
  fallbackTriggered: boolean;
  latencyMs: number;
  tokensEstimated: number;
  createdAt: Date;
};

export type PromptExecutionResult = {
  session: AgentSessionData;
  userMessage: AgentMessageData;
  assistantMessage: AgentMessageData;
  reply: string;
  providerUsed: string;
  modelUsed: string;
  fallbackTriggered: boolean;
  latencyMs: number;
  tokensEstimated: number;
};

export class AgentExecutionError extends Error {
  constructor(message: string, public readonly primaryError?: unknown, public readonly fallbackError?: unknown) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

type CreateAgentConfigParams = {
  name: string;
  description?: string | null | undefined;
  systemPrompt: string;
  primaryProvider: AIProvider;
  primaryModel: string;
  fallbackProvider?: AIProvider | null | undefined;
  fallbackModel?: string | null | undefined;
  temperature?: number | undefined;
};

/**
 * Creates a new Agent Configuration for a workspace.
 * Requires `ai_agents.manage`.
 */
export async function createAgentConfig(
  tx: ContextTransaction,
  ctxOrParams:
    | RequestContext
    | (CreateAgentConfigParams & {
        organizationId: string;
        workspaceId: string;
        userId?: string;
      }),
  maybeParams?: CreateAgentConfigParams,
): Promise<AgentConfigData> {
  assertModuleAvailable("ai-agents");

  const ctx: RequestContext =
    "userId" in ctxOrParams && ctxOrParams.userId
      ? (ctxOrParams as RequestContext)
      : {
          organizationId: ctxOrParams.organizationId,
          workspaceId: ctxOrParams.workspaceId,
          userId: (ctxOrParams as { userId?: string }).userId ?? "",
        };

  const params: CreateAgentConfigParams =
    maybeParams ?? (ctxOrParams as CreateAgentConfigParams);

  if (ctx.userId) {
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  }

  const record = await tx.agentConfig.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      name: params.name.trim(),
      description: params.description?.trim() || null,
      systemPrompt: params.systemPrompt.trim(),
      primaryProvider: params.primaryProvider,
      primaryModel: params.primaryModel.trim(),
      fallbackProvider: params.fallbackProvider || null,
      fallbackModel: params.fallbackModel?.trim() || null,
      temperature: params.temperature ?? 0.7,
      status: "active",
    },
  });

  return {
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description,
    systemPrompt: record.systemPrompt,
    primaryProvider: record.primaryProvider as AIProvider,
    primaryModel: record.primaryModel,
    fallbackProvider: record.fallbackProvider as AIProvider | null,
    fallbackModel: record.fallbackModel,
    temperature: Number(record.temperature),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Lists all active agent configurations in a workspace.
 * Requires `ai_agents.use`.
 */
export async function listAgentConfigs(
  tx: ContextTransaction,
  ctxOrWorkspaceId: RequestContext | string,
): Promise<AgentConfigData[]> {
  assertModuleAvailable("ai-agents");

  const workspaceId =
    typeof ctxOrWorkspaceId === "string"
      ? ctxOrWorkspaceId
      : ctxOrWorkspaceId.workspaceId;

  if (typeof ctxOrWorkspaceId === "object" && ctxOrWorkspaceId.userId) {
    await requireWorkspacePermission(tx, ctxOrWorkspaceId, Permissions.AI_AGENTS_USE);
  }

  const records = await tx.agentConfig.findMany({
    where: { workspaceId, status: "active" },
    orderBy: { createdAt: "asc" },
  });

  return records.map((record) => ({
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description,
    systemPrompt: record.systemPrompt,
    primaryProvider: record.primaryProvider as AIProvider,
    primaryModel: record.primaryModel,
    fallbackProvider: record.fallbackProvider as AIProvider | null,
    fallbackModel: record.fallbackModel,
    temperature: Number(record.temperature),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

/**
 * Fetches an agent configuration by ID.
 * Requires `ai_agents.use`.
 */
export async function getAgentConfig(
  tx: ContextTransaction,
  ctxOrId: RequestContext | string,
  maybeId?: string,
): Promise<AgentConfigData | null> {
  assertModuleAvailable("ai-agents");

  const id = maybeId ?? (typeof ctxOrId === "string" ? ctxOrId : "");

  if (typeof ctxOrId === "object" && ctxOrId.userId) {
    await requireWorkspacePermission(tx, ctxOrId, Permissions.AI_AGENTS_USE);
  }

  const record = await tx.agentConfig.findUnique({
    where: { id },
  });

  if (!record) return null;

  return {
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description,
    systemPrompt: record.systemPrompt,
    primaryProvider: record.primaryProvider as AIProvider,
    primaryModel: record.primaryModel,
    fallbackProvider: record.fallbackProvider as AIProvider | null,
    fallbackModel: record.fallbackModel,
    temperature: Number(record.temperature),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

type CreateAgentSessionParams = {
  agentConfigId?: string | null | undefined;
  title?: string | undefined;
};

/**
 * Creates an agent chat session.
 * Requires `ai_agents.use`.
 */
export async function createAgentSession(
  tx: ContextTransaction,
  ctxOrParams:
    | RequestContext
    | (CreateAgentSessionParams & {
        organizationId: string;
        workspaceId: string;
        createdByUserId: string;
      }),
  maybeParams?: CreateAgentSessionParams,
): Promise<AgentSessionData> {
  assertModuleAvailable("ai-agents");

  const ctx: RequestContext =
    "userId" in ctxOrParams && ctxOrParams.userId
      ? (ctxOrParams as RequestContext)
      : {
          organizationId: ctxOrParams.organizationId,
          workspaceId: ctxOrParams.workspaceId,
          userId: (ctxOrParams as { createdByUserId: string }).createdByUserId,
        };

  const params: CreateAgentSessionParams =
    maybeParams ?? (ctxOrParams as CreateAgentSessionParams);

  if (ctx.userId) {
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  }

  const record = await tx.agentSession.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      createdByUserId: ctx.userId,
      agentConfigId: params.agentConfigId || null,
      title: params.title || "Nova Conversa",
      status: "active",
    },
  });

  return {
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    agentConfigId: record.agentConfigId,
    title: record.title,
    createdByUserId: record.createdByUserId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Lists recent agent sessions for a workspace.
 * Requires `ai_agents.use`.
 */
export async function listAgentSessions(
  tx: ContextTransaction,
  ctxOrWorkspaceId: RequestContext | string,
  limit: number = 30,
): Promise<AgentSessionData[]> {
  assertModuleAvailable("ai-agents");

  const workspaceId =
    typeof ctxOrWorkspaceId === "string"
      ? ctxOrWorkspaceId
      : ctxOrWorkspaceId.workspaceId;

  if (typeof ctxOrWorkspaceId === "object" && ctxOrWorkspaceId.userId) {
    await requireWorkspacePermission(tx, ctxOrWorkspaceId, Permissions.AI_AGENTS_USE);
  }

  const records = await tx.agentSession.findMany({
    where: { workspaceId, status: "active" },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return records.map((record) => ({
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    agentConfigId: record.agentConfigId,
    title: record.title,
    createdByUserId: record.createdByUserId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

/**
 * Gets session details along with all messages in chronological order.
 * Requires `ai_agents.use`.
 */
export async function getSessionWithMessages(
  tx: ContextTransaction,
  ctxOrSessionId: RequestContext | string,
  maybeSessionId?: string,
): Promise<{
  session: AgentSessionData | null;
  messages: AgentMessageData[];
}> {
  assertModuleAvailable("ai-agents");

  const sessionId =
    maybeSessionId ??
    (typeof ctxOrSessionId === "string" ? ctxOrSessionId : "");

  if (typeof ctxOrSessionId === "object" && ctxOrSessionId.userId) {
    await requireWorkspacePermission(tx, ctxOrSessionId, Permissions.AI_AGENTS_USE);
  }

  const sessionRecord = await tx.agentSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!sessionRecord) {
    return { session: null, messages: [] };
  }

  const session: AgentSessionData = {
    id: sessionRecord.id,
    organizationId: sessionRecord.organizationId,
    workspaceId: sessionRecord.workspaceId,
    agentConfigId: sessionRecord.agentConfigId,
    title: sessionRecord.title,
    createdByUserId: sessionRecord.createdByUserId,
    status: sessionRecord.status,
    createdAt: sessionRecord.createdAt,
    updatedAt: sessionRecord.updatedAt,
  };

  const messages: AgentMessageData[] = sessionRecord.messages.map((m) => ({
    id: m.id,
    organizationId: m.organizationId,
    workspaceId: m.workspaceId,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content,
    providerUsed: m.providerUsed,
    modelUsed: m.modelUsed,
    fallbackTriggered: m.fallbackTriggered,
    latencyMs: m.latencyMs,
    tokensEstimated: m.tokensEstimated,
    createdAt: m.createdAt,
  }));

  return { session, messages };
}

type ExecutePromptParams = {
  prompt: string;
  agentConfigId?: string | null | undefined;
  sessionId?: string | null | undefined;
};

/**
 * Executes an AI Prompt with automatic fallback resilience and persists the interaction history.
 * Requires `ai_agents.use`.
 */
export async function executeAgentPrompt(
  tx: ContextTransaction,
  ctxOrParams:
    | RequestContext
    | (ExecutePromptParams & {
        workspaceId: string;
        organizationId: string;
        userId: string;
      }),
  paramsOrExecutor?: ExecutePromptParams | typeof executeProviderPrompt,
  maybeExecutor?: typeof executeProviderPrompt,
): Promise<PromptExecutionResult> {
  assertModuleAvailable("ai-agents");

  let ctx: RequestContext;
  let params: ExecutePromptParams;
  let executorFn: typeof executeProviderPrompt = executeProviderPrompt;

  if (
    typeof paramsOrExecutor === "object" &&
    paramsOrExecutor !== null &&
    "prompt" in paramsOrExecutor
  ) {
    ctx = ctxOrParams as RequestContext;
    params = paramsOrExecutor;
    if (maybeExecutor) {
      executorFn = maybeExecutor;
    }
  } else {
    const legacy = ctxOrParams as ExecutePromptParams & {
      workspaceId: string;
      organizationId: string;
      userId: string;
    };
    ctx = {
      workspaceId: legacy.workspaceId,
      organizationId: legacy.organizationId,
      userId: legacy.userId,
    };
    params = legacy;
    if (typeof paramsOrExecutor === "function") {
      executorFn = paramsOrExecutor;
    }
  }

  if (ctx.userId) {
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  }

  const { workspaceId, organizationId } = ctx;
  const { prompt, agentConfigId, sessionId } = params;

  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Prompt cannot be empty");
  }

  // 1. Resolve or establish Agent Configuration
  let config: AgentConfigData | null = null;
  if (agentConfigId) {
    config = await getAgentConfig(tx, ctx, agentConfigId);
    if (!config || config.workspaceId !== workspaceId) {
      throw new Error(`Agent configuration '${agentConfigId}' not found in workspace`);
    }
  } else {
    // Pick first active or fail with actionable error
    const existingConfigs = await listAgentConfigs(tx, ctx);
    if (existingConfigs.length > 0 && existingConfigs[0]) {
      config = existingConfigs[0];
    } else {
      throw new AgentExecutionError("nenhum agente configurado");
    }
  }

  if (!config) {
    throw new Error("Unable to establish active agent configuration");
  }

  // 2. Dispatch prompt with fallback resilience
  let reply = "";
  let providerUsed = config.primaryProvider;
  let modelUsed = config.primaryModel;
  let fallbackTriggered = false;
  let latencyMs = 0;
  let tokensEstimated = 0;

  let primaryFailed = false;
  let primaryError: unknown = null;

  // Try primary provider
  try {
    const primaryApiKey = await resolveProviderSecret(tx, ctx, config.primaryProvider);
    const result: ExecutionResult = await executorFn({
      provider: config.primaryProvider,
      model: config.primaryModel,
      apiKey: primaryApiKey,
      systemPrompt: config.systemPrompt,
      prompt,
      temperature: config.temperature,
    });
    reply = result.reply;
    latencyMs = result.latencyMs;
    tokensEstimated = result.tokensEstimated;
  } catch (err: unknown) {
    primaryFailed = true;
    primaryError = err;
  }

  // If primary failed, attempt fallback if configured
  if (primaryFailed) {
    if (config.fallbackProvider && config.fallbackModel) {
      try {
        const fallbackApiKey = await resolveProviderSecret(tx, ctx, config.fallbackProvider);
        const result: ExecutionResult = await executorFn({
          provider: config.fallbackProvider,
          model: config.fallbackModel,
          apiKey: fallbackApiKey,
          systemPrompt: config.systemPrompt,
          prompt,
          temperature: config.temperature,
        });
        reply = result.reply;
        providerUsed = config.fallbackProvider;
        modelUsed = config.fallbackModel;
        fallbackTriggered = true;
        latencyMs = result.latencyMs;
        tokensEstimated = result.tokensEstimated;
      } catch (fallbackErr: unknown) {
        throw new AgentExecutionError(
          `Primary provider '${config.primaryProvider}' failed and fallback provider '${config.fallbackProvider}' also failed.`,
          primaryError,
          fallbackErr,
        );
      }
    } else {
      const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
      throw new AgentExecutionError(
        `Primary provider '${config.primaryProvider}' execution failed with no fallback configured: ${primaryMsg}`,
        primaryError,
      );
    }
  }

  // 3. Resolve or create chat session
  let activeSession: AgentSessionData;
  if (sessionId) {
    const existing = await tx.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error(`Chat session '${sessionId}' not found in workspace`);
    }
    activeSession = {
      id: existing.id,
      organizationId: existing.organizationId,
      workspaceId: existing.workspaceId,
      agentConfigId: existing.agentConfigId,
      title: existing.title,
      createdByUserId: existing.createdByUserId,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  } else {
    // Generate brief title from prompt
    const cleanPrompt = prompt.trim().replace(/\s+/g, " ");
    const title = cleanPrompt.length > 40 ? `${cleanPrompt.slice(0, 37)}...` : cleanPrompt;
    activeSession = await createAgentSession(tx, ctx, {
      agentConfigId: config.id,
      title,
    });
  }

  // 4. Persist interaction audit trail
  const userMsgRecord = await tx.agentMessage.create({
    data: {
      organizationId,
      workspaceId,
      sessionId: activeSession.id,
      role: "user",
      content: prompt,
      providerUsed: "user",
      modelUsed: "user",
      fallbackTriggered: false,
      latencyMs: 0,
      tokensEstimated: Math.ceil(prompt.length / 4),
    },
  });

  const assistantMsgRecord = await tx.agentMessage.create({
    data: {
      organizationId,
      workspaceId,
      sessionId: activeSession.id,
      role: "assistant",
      content: reply,
      providerUsed,
      modelUsed,
      fallbackTriggered,
      latencyMs,
      tokensEstimated,
    },
  });

  // Touch session updatedAt
  await tx.agentSession.update({
    where: { id: activeSession.id },
    data: { updatedAt: new Date() },
  });

  const userMessage: AgentMessageData = {
    id: userMsgRecord.id,
    organizationId: userMsgRecord.organizationId,
    workspaceId: userMsgRecord.workspaceId,
    sessionId: userMsgRecord.sessionId,
    role: userMsgRecord.role,
    content: userMsgRecord.content,
    providerUsed: userMsgRecord.providerUsed,
    modelUsed: userMsgRecord.modelUsed,
    fallbackTriggered: userMsgRecord.fallbackTriggered,
    latencyMs: userMsgRecord.latencyMs,
    tokensEstimated: userMsgRecord.tokensEstimated,
    createdAt: userMsgRecord.createdAt,
  };

  const assistantMessage: AgentMessageData = {
    id: assistantMsgRecord.id,
    organizationId: assistantMsgRecord.organizationId,
    workspaceId: assistantMsgRecord.workspaceId,
    sessionId: assistantMsgRecord.sessionId,
    role: assistantMsgRecord.role,
    content: assistantMsgRecord.content,
    providerUsed: assistantMsgRecord.providerUsed,
    modelUsed: assistantMsgRecord.modelUsed,
    fallbackTriggered: assistantMsgRecord.fallbackTriggered,
    latencyMs: assistantMsgRecord.latencyMs,
    tokensEstimated: assistantMsgRecord.tokensEstimated,
    createdAt: assistantMsgRecord.createdAt,
  };

  return {
    session: activeSession,
    userMessage,
    assistantMessage,
    reply,
    providerUsed,
    modelUsed,
    fallbackTriggered,
    latencyMs,
    tokensEstimated,
  };
}
