import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  isStepCount,
  type ModelMessage,
  NoSuchToolError,
  streamText,
} from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import { type AgentConfig, parseAgentConfig } from "../config/schema";
import { withBaseUrl } from "../catalog";
import { createChatModel, type ModelFactory } from "../providers";
import { renderSystemPrompt } from "../prompt/render";
import { promptLocale } from "../prompt/texts";
import { buildTools, recordRefusedCall, type ToolEnv } from "../tools/catalog";
import { contextValues } from "./context";
import { withRegionTimeZone } from "./region";
import { persistTurn, persistTurnError } from "./persist";
import { turnErrorCode } from "./plan";
import { TURN_LIMITS, type TurnDb, type TurnState } from "./types";

/**
 * Turn of the GUIDU Assistant (A2b): in the request, streaming, with the
 * permissions of the person who talks and the admin key of the partner.
 * Any member uses it (especificação §10): in the /admin as a member of the
 * partner, in the /app as a member of a workspace of one of its customers.
 * The Assistant and the key come from security definer functions that
 * answer only for the partner serving the context; the person never reads
 * them. Reads of the workspace and proposals exist only in the /app.
 *
 * The answer streams to the caller; when the stream ends, a short
 * transaction writes the messages, the usage and the audit (`done`).
 */

export type AssistantActor =
  | Readonly<{ scope: "partner"; userId: string; partnerId: string }>
  | Readonly<{ scope: "workspace"; ctx: RequestContext }>;

export const AssistantMessageInput = z.strictObject({
  /** Absent: a new conversation. */
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(TURN_LIMITS.maxUserMessage),
});

export type AssistantTurnDeps = Readonly<{
  createModel?: ModelFactory;
  now?: () => Date;
}>;

export type AssistantTurnOutcome = Readonly<
  { status: "answered" } | { status: "failed"; errorCode: string }
>;

export type AssistantTurn = Readonly<{
  conversationId: string;
  executionId: string;
  /** Text of the answer as the model writes it. */
  textStream: AsyncIterable<string>;
  /** Resolves after the turn is written (or its error). */
  done: Promise<AssistantTurnOutcome>;
}>;

function unavailable(message: string): AppError {
  return new AppError({ code: "unavailable", safeMessage: message });
}

function actorDb(prisma: PrismaClient, actor: AssistantActor): TurnDb {
  return {
    transaction: (operation) =>
      actor.scope === "workspace"
        ? withContext(prisma, actor.ctx, operation)
        : withIdentityContext(prisma, actor.userId, operation, {
            partnerId: actor.partnerId,
          }),
  };
}

type RuntimeRow = {
  agent_id: string;
  partner_id: string;
  status: string;
  config: unknown;
  config_version: number;
};

type Loaded = Readonly<{
  agentId: string;
  partnerId: string;
  conversationId: string;
  config: AgentConfig;
  key: Readonly<{
    provider: AIProvider;
    secret: string;
    model: string;
    baseURL?: string;
  }>;
  systemPrompt: string;
  history: ModelMessage[];
  state: TurnState;
}>;

async function loadTurn(
  tx: ContextTransaction,
  actor: AssistantActor,
  input: z.infer<typeof AssistantMessageInput>,
  now: Date,
): Promise<Loaded> {
  const [runtime] = await tx.$queryRaw<RuntimeRow[]>`
    select agent_id, partner_id, status, config, config_version
    from private.ai_assistant_runtime()
  `;
  if (!runtime) throw unavailable("O Assistente não está disponível aqui.");
  if (runtime.status === "paused")
    throw unavailable("O Assistente está pausado.");
  const parsed = parseAgentConfig(
    "assistant",
    runtime.config_version,
    runtime.config,
  );
  if (!parsed.success) {
    throw unavailable("A configuração do Assistente é inválida.");
  }
  const config = await withRegionTimeZone(tx, parsed.data);
  const modelName = config.model.model_name;
  const [credential] = modelName
    ? await tx.$queryRaw<{ provider: string; encrypted_payload: string }[]>`
        select provider, encrypted_payload
        from private.ai_admin_key(
          ${config.model.credential_id ?? null}::uuid,
          ${config.model.model_provider ?? null}::text
        )
      `
    : [];
  if (!credential || !modelName) {
    throw unavailable("O Assistente ainda não tem chave e modelo.");
  }

  const userId = actor.scope === "workspace" ? actor.ctx.userId : actor.userId;
  const workspace = actor.scope === "workspace" ? actor.ctx : null;
  let conversation;
  if (input.conversationId) {
    // RLS: only the person's own conversations.
    conversation = await tx.aiConversation.findFirst({
      where: {
        id: input.conversationId,
        kind: "assistant",
        agentId: runtime.agent_id,
        userId,
        workspaceId: workspace?.workspaceId ?? null,
      },
    });
    if (!conversation) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Conversa não encontrada.",
        messageKey: "apiErrors.notFound",
      });
    }
    if (conversation.status === "closed") {
      throw new AppError({
        code: "conflict",
        safeMessage: "Esta conversa foi encerrada.",
      });
    }
  } else {
    conversation = await tx.aiConversation.create({
      data: {
        kind: "assistant",
        agentId: runtime.agent_id,
        partnerId: runtime.partner_id,
        organizationId: workspace?.organizationId ?? null,
        workspaceId: workspace?.workspaceId ?? null,
        userId,
        channel: "panel",
      },
    });
  }
  await tx.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: input.text,
    },
    select: { id: true },
  });

  const [profile, company, role, messagesCount, recent] = await Promise.all([
    tx.profile.findFirst({ where: { id: userId }, select: { fullName: true } }),
    workspace
      ? tx.organization.findFirst({
          where: { id: workspace.organizationId },
          select: { name: true },
        })
      : tx.partner.findFirst({
          where: { id: runtime.partner_id },
          select: { name: true },
        }),
    workspace
      ? getEffectiveWorkspaceRole(tx, workspace)
      : tx.$queryRaw<{ role: string | null }[]>`
          select private.current_partner_role() as role
        `.then((rows) => rows[0]?.role ?? null),
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
  const systemPrompt = renderSystemPrompt({
    kind: "assistant",
    config,
    locale: promptLocale(config.overview.language),
    memory,
    context: contextValues({
      kind: "assistant",
      agentId: runtime.agent_id,
      config,
      now,
      dateLocale: config.overview.language ?? "pt-BR",
      company: { name: company?.name ?? null, locale: null },
      user: { name: profile?.fullName ?? null, role },
      contact: null,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        startedAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        messagesCount,
      },
    }),
  });
  if (!systemPrompt) throw unavailable("O Assistente ainda não tem prompt.");

  return {
    agentId: runtime.agent_id,
    partnerId: runtime.partner_id,
    conversationId: conversation.id,
    config,
    // The platform's gateway of the key's provider, when one is set (CF6a).
    key: await withBaseUrl(tx, {
      provider: credential.provider as AIProvider,
      secret: decryptSecret(credential.encrypted_payload),
      model: modelName,
    }),
    systemPrompt,
    history: recent
      .reverse()
      .map((m): ModelMessage =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content },
      ),
    state: {
      contactId: null,
      status: conversation.status as TurnState["status"],
      memory: { ...memory },
      records: [],
    },
  };
}

export async function startAssistantTurn(
  prisma: PrismaClient,
  actor: AssistantActor,
  input: unknown,
  deps: AssistantTurnDeps = {},
): Promise<AssistantTurn> {
  if (!isModuleTechnicallyAvailable("ai-agents")) {
    throw unavailable("O Assistente não está disponível neste ambiente.");
  }
  const parsed = AssistantMessageInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Mensagem inválida.",
    });
  }
  const now = deps.now ?? (() => new Date());
  const db = actorDb(prisma, actor);
  const loaded = await db.transaction((tx) =>
    loadTurn(tx, actor, parsed.data, now()),
  );

  const executionId = randomUUID();
  const workspace = actor.scope === "workspace" ? actor.ctx : null;
  const audit =
    actor.scope === "workspace"
      ? { ctx: actor.ctx, origin: "app" as const }
      : { ctx: adminAuditContext(actor.userId), origin: "admin" as const };
  const { config, key, state } = loaded;
  const env: ToolEnv = {
    kind: "assistant",
    executionId,
    agentId: loaded.agentId,
    conversationId: loaded.conversationId,
    config,
    locale: promptLocale(config.overview.language),
    db,
    workspace,
    prisma: workspace ? prisma : null,
    now,
    state,
  };

  const result = streamText({
    model: (deps.createModel ?? createChatModel)(key),
    instructions: loaded.systemPrompt,
    messages: loaded.history,
    tools: buildTools(env),
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
    // Errors are handled when the turn is written (`done`).
    onError: () => undefined,
  });

  const turn = {
    conversationId: loaded.conversationId,
    agentId: loaded.agentId,
    executionId,
    audit,
  };
  const done = (async (): Promise<AssistantTurnOutcome> => {
    try {
      const [steps, usage, text] = await Promise.all([
        result.steps,
        result.totalUsage,
        result.text,
      ]);
      if (!text.trim()) throw new Error("empty answer");
      await db.transaction((tx) =>
        persistTurn(tx, {
          ...turn,
          provider: key.provider,
          model: key.model,
          steps,
          answer: [text],
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
          },
          records: state.records,
          owner: {
            keySource: "admin",
            partnerId: loaded.partnerId,
            organizationId: workspace?.organizationId ?? null,
            workspaceId: workspace?.workspaceId ?? null,
          },
        }),
      );
      return { status: "answered" };
    } catch (error) {
      const errorCode = turnErrorCode(error);
      appLog.warn("ai.turn.failed", { executionId, errorCode });
      try {
        await db.transaction((tx) =>
          persistTurnError(tx, {
            ...turn,
            errorCode,
            provider: key.provider,
            model: key.model,
            owner: {
              keySource: "admin",
              partnerId: loaded.partnerId,
              organizationId: workspace?.organizationId ?? null,
              workspaceId: workspace?.workspaceId ?? null,
            },
            records: state.records,
          }),
        );
      } catch (persistError) {
        appLog.error("ai.turn.error_not_recorded", {
          executionId,
          error: persistError,
        });
      }
      return { status: "failed", errorCode };
    }
  })();

  return {
    conversationId: loaded.conversationId,
    executionId,
    textStream: result.textStream,
    done,
  };
}
