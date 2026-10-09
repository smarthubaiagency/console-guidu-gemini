/**
 * ============================================================================
 * File: src/core/agents/actions.ts
 * Module: AI Prompt & Agent Execution Server Actions (C07 & C10)
 *
 * Maintenance Rationale:
 * - Server actions bridge between client chat UI and backend prompt engine.
 * - All mutations execute securely within `withContext` (ADR 0001).
 * - No decrypted keys or raw payloads ever leak to the browser.
 * - Enforces permission checks and safe standardized error contracts via `toSafeError`.
 * ============================================================================
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import type { AIProvider } from "@/core/credentials/vault";
import { assertModuleAvailable } from "@/core/modules/availability";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import {
  createAgentConfig,
  executeAgentPrompt,
  getSessionWithMessages,
  type PromptExecutionResult,
  type AgentConfigData,
  type AgentSessionData,
  type AgentMessageData,
} from "./engine";

const ExecutePromptInput = z.object({
  workspaceSlug: z.string().min(1),
  prompt: z.string().min(1, "O prompt não pode estar vazio").max(8000),
  agentConfigId: z.string().uuid().optional().or(z.literal("")),
  sessionId: z.string().uuid().optional().or(z.literal("")),
});

export type ExecutePromptActionState = {
  success?: boolean;
  result?: PromptExecutionResult;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

/**
 * Dispatches an interactive prompt to the AI agent engine.
 */
export async function executePromptAction(
  _prev: ExecutePromptActionState,
  formData: FormData,
): Promise<ExecutePromptActionState> {
  const parsed = ExecutePromptInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    prompt: formData.get("prompt"),
    agentConfigId: formData.get("agentConfigId") || undefined,
    sessionId: formData.get("sessionId") || undefined,
  });

  if (!parsed.success) {
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para execução do agente.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, prompt, agentConfigId, sessionId } = parsed.data;

  try {
    assertModuleAvailable("ai-agents");
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    const result = await withContext(prisma, context, async (tx) => {
      return executeAgentPrompt(tx, context, {
        prompt,
        agentConfigId: agentConfigId || undefined,
        sessionId: sessionId || undefined,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/ai-agents`);

    return {
      success: true,
      result,
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}

const CreateAgentConfigInput = z.object({
  workspaceSlug: z.string().min(1),
  name: z.string().min(2, "O nome do agente deve ter ao menos 2 caracteres").max(64),
  description: z.string().max(256).optional(),
  systemPrompt: z.string().min(5, "O prompt de sistema deve ter ao menos 5 caracteres"),
  primaryProvider: z.enum(["openai", "anthropic", "gemini"]),
  primaryModel: z.string().min(2),
  fallbackProvider: z.enum(["openai", "anthropic", "gemini"]).optional().or(z.literal("")),
  fallbackModel: z.string().optional().or(z.literal("")),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
});

export type CreateAgentConfigActionState = {
  success?: boolean;
  config?: AgentConfigData;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

/**
 * Registers a new agent profile / persona in the workspace.
 */
export async function createAgentConfigAction(
  _prev: CreateAgentConfigActionState,
  formData: FormData,
): Promise<CreateAgentConfigActionState> {
  const parsed = CreateAgentConfigInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    systemPrompt: formData.get("systemPrompt"),
    primaryProvider: formData.get("primaryProvider"),
    primaryModel: formData.get("primaryModel"),
    fallbackProvider: formData.get("fallbackProvider") || undefined,
    fallbackModel: formData.get("fallbackModel") || undefined,
    temperature: formData.get("temperature") || 0.7,
  });

  if (!parsed.success) {
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Configurações inválidas para o agente.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const {
    workspaceSlug,
    name,
    description,
    systemPrompt,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    temperature,
  } = parsed.data;

  try {
    assertModuleAvailable("ai-agents");
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    const config = await withContext(prisma, context, async (tx) => {
      return createAgentConfig(tx, context, {
        name,
        description,
        systemPrompt,
        primaryProvider: primaryProvider as AIProvider,
        primaryModel,
        fallbackProvider: (fallbackProvider as AIProvider) || null,
        fallbackModel: fallbackModel || null,
        temperature,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/ai-agents`);

    return {
      success: true,
      config,
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}

/**
 * Loads messages for a specific session.
 */
export async function loadSessionMessagesAction(
  workspaceSlug: string,
  sessionId: string,
): Promise<{
  session: AgentSessionData | null;
  messages: AgentMessageData[];
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
}> {
  try {
    assertModuleAvailable("ai-agents");
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    const result = await withContext(prisma, context, async (tx) => {
      return getSessionWithMessages(tx, context, sessionId);
    });

    return {
      session: result.session,
      messages: result.messages,
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return {
      session: null,
      messages: [],
      error: safe.safeMessage,
      code: safe.code,
      requestId: safe.requestId,
    };
  }
}
