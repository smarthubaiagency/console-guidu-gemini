/**
 * ============================================================================
 * File: src/core/agents/engine.ts
 * Module: AI Prompt & Agent Execution Engine with Resilient Fallbacks
 *
 * Maintenance Rationale:
 * - Implements Spec Section 16 & SMA-100:
 *   - Manages AI Agent Configurations with primary & fallback providers.
 *   - Orchestrates prompt execution via decrypted BYOK keys inside `withContext`.
 *   - Implements resilient automated fallback: if primary provider encounters
 *     quota, auth, or network failure, transparently dispatches to the fallback
 *     provider and flags `fallbackTriggered: true`.
 *   - Preserves complete interaction audit history (sessions and messages)
 *     with execution latency, tokens estimated, and provider metadata.
 * ============================================================================
 */

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { resolveProviderSecret, type AIProvider } from "@/core/credentials/vault";
import { assertModuleAvailable } from "@/core/modules/availability";
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

/**
 * Creates a new Agent Configuration for a workspace.
 */
export async function createAgentConfig(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    workspaceId: string;
    name: string;
    description?: string | null | undefined;
    systemPrompt: string;
    primaryProvider: AIProvider;
    primaryModel: string;
    fallbackProvider?: AIProvider | null | undefined;
    fallbackModel?: string | null | undefined;
    temperature?: number | undefined;
  },
): Promise<AgentConfigData> {
  assertModuleAvailable("ai-agents");
  const record = await tx.agentConfig.create({
    data: {
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
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
 */
export async function listAgentConfigs(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<AgentConfigData[]> {
  assertModuleAvailable("ai-agents");
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
 */
export async function getAgentConfig(
  tx: ContextTransaction,
  id: string,
): Promise<AgentConfigData | null> {
  assertModuleAvailable("ai-agents");
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

/**
 * Creates an agent chat session.
 */
export async function createAgentSession(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    workspaceId: string;
    createdByUserId: string;
    agentConfigId?: string | null | undefined;
    title?: string | undefined;
  },
): Promise<AgentSessionData> {
  assertModuleAvailable("ai-agents");
  const record = await tx.agentSession.create({
    data: {
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      createdByUserId: params.createdByUserId,
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
 */
export async function listAgentSessions(
  tx: ContextTransaction,
  workspaceId: string,
  limit: number = 30,
): Promise<AgentSessionData[]> {
  assertModuleAvailable("ai-agents");
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
 */
export async function getSessionWithMessages(
  tx: ContextTransaction,
  sessionId: string,
): Promise<{
  session: AgentSessionData | null;
  messages: AgentMessageData[];
}> {
  assertModuleAvailable("ai-agents");
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

/**
 * Executes an AI Prompt with automatic fallback resilience and persists the interaction history.
 */
export async function executeAgentPrompt(
  tx: ContextTransaction,
  params: {
    workspaceId: string;
    organizationId: string;
    userId: string;
    prompt: string;
    agentConfigId?: string | null | undefined;
    sessionId?: string | null | undefined;
  },
  executorFn: typeof executeProviderPrompt = executeProviderPrompt,
): Promise<PromptExecutionResult> {
  assertModuleAvailable("ai-agents");
  const { workspaceId, organizationId, userId, prompt, agentConfigId, sessionId } = params;

  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Prompt cannot be empty");
  }

  // 1. Resolve or establish Agent Configuration
  let config: AgentConfigData | null = null;
  if (agentConfigId) {
    config = await getAgentConfig(tx, agentConfigId);
    if (!config || config.workspaceId !== workspaceId) {
      throw new Error(`Agent configuration '${agentConfigId}' not found in workspace`);
    }
  } else {
    // Pick first active or fail with actionable error
    const existingConfigs = await listAgentConfigs(tx, workspaceId);
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
    const primaryApiKey = await resolveProviderSecret(tx, workspaceId, config.primaryProvider);
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
        const fallbackApiKey = await resolveProviderSecret(tx, workspaceId, config.fallbackProvider);
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
    activeSession = await createAgentSession(tx, {
      organizationId,
      workspaceId,
      createdByUserId: userId,
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
