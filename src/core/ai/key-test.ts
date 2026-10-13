import "server-only";

import type { PrismaClient } from "@prisma/client";
import { generateText } from "ai";

import { recordAudit } from "@/core/audit/record";
import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import { parseAgentConfig } from "./config/schema";
import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
} from "./providers";
import { turnErrorCode } from "./turn/plan";

/**
 * Test of the key of a GUIDS (A2c, §9.2.5): one short call to the model with
 * the agent's key and model, outside any transaction. Success records the
 * test and ends the backup at once (`key_state = ok`); an agent paused by
 * the failure stays paused until the person turns it back on. Owner and
 * admin (`ai_agents.manage`).
 */

export type KeyTestResult = Readonly<{
  ok: boolean;
  /** Code of `turnErrorCode` when the test failed. */
  errorCode: string | null;
  /** Whether this test ended a backup or a failed key. */
  keyRestored: boolean;
}>;

const MODULE_KEY = "ai-agents";

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Agente não encontrado.",
  });
}

export async function testGuidKey(
  prisma: PrismaClient,
  ctx: RequestContext,
  agentId: string,
  deps: Readonly<{ createModel?: ModelFactory }> = {},
): Promise<KeyTestResult> {
  const key = await withContext(prisma, ctx, async (tx) => {
    await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
      select: { config: true, configVersion: true },
    });
    if (!agent) throw notFound();
    const parsed = parseAgentConfig("guid", agent.configVersion, agent.config);
    const credentialId = parsed.success
      ? parsed.data.model.credential_id
      : undefined;
    const model = parsed.success ? parsed.data.model.model_name : undefined;
    if (!credentialId || !model) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Escolha a chave e o modelo do agente antes de testar.",
      });
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
      throw new AppError({
        code: "invalid_input",
        safeMessage: "A chave escolhida não está ativa no cofre.",
      });
    }
    return {
      provider: credential.provider as AIProvider,
      secret: decryptSecret(credential.encryptedPayload),
      model,
    } satisfies ChatModelKey;
  });

  let errorCode: string | null = null;
  try {
    await generateText({
      model: (deps.createModel ?? createChatModel)(key),
      prompt: "ping",
      maxOutputTokens: 16,
      maxRetries: 0,
      timeout: { totalMs: 20_000 },
    });
  } catch (error) {
    errorCode = turnErrorCode(error);
    appLog.warn("ai.key_test.failed", { agentId, errorCode });
  }

  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
      select: { keyState: true },
    });
    if (!agent) throw notFound();
    const keyRestored = errorCode === null && agent.keyState !== "ok";
    await tx.aiAgent.update({
      where: { id: agentId },
      data: {
        lastTestedAt: new Date(),
        updatedBy: ctx.userId,
        ...(keyRestored ? { keyState: "ok", backupStartedAt: null } : {}),
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "ai.agent.key_test",
      resourceType: "ai_agent",
      resourceId: agentId,
      result: errorCode === null ? "success" : "error",
      metadata: {
        agentId,
        provider: key.provider,
        model: key.model,
        reason: errorCode ?? "",
        ...(keyRestored ? { from: agent.keyState, to: "ok" } : {}),
      },
    });
    return { ok: errorCode === null, errorCode, keyRestored };
  });
}
