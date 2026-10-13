import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testGuidKey } from "@/core/ai/key-test";
import { runKeyWatch } from "@/core/ai/key-watch";
import type { ChatModelKey } from "@/core/ai/providers";
import { runGuidTurn } from "@/core/ai/turn/guid";
import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type { NotificationTransport } from "@/core/notifications/types";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { sendGuidTestMessage } from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A2c: backup of the customer's key (especificação §9.2), with mock models
 * of the SDK and no network. The turn switches to the platform key only in
 * a conversation already open, the worker sends the notices and pauses the
 * agent after 24 hours, and a successful key test ends the backup.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const GUID = "a2c00000-0000-4000-8000-0000000000a1";
const SECRET = "sk-proj-customer0123456789abcdef";
const BACKUP_SECRET = "sk-proj-platform0123456789abcdef";
const OWNER_EMAIL = "dono-a2c@cliente.test";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textStep(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

const answer = (...messages: string[]) =>
  textStep(JSON.stringify({ messages }));

function failing(statusCode: number) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: `provider said ${statusCode} for ${SECRET}`,
        url: "https://api.example.test/v1/chat",
        requestBodyValues: {},
        statusCode,
        isRetryable: false,
      });
    },
  });
}

/** The customer's key fails with `status`; the platform key answers. */
function models(status: number, backup: MockLanguageModelV4) {
  const customer = failing(status);
  const keys: ChatModelKey[] = [];
  return {
    customer,
    keys,
    createModel: (key: ChatModelKey) => {
      keys.push(key);
      return key.secret === SECRET ? customer : backup;
    },
  };
}

describeDatabase("A2c: backup of the customer's key", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  let previousSettings: Awaited<
    ReturnType<typeof admin.platformAiSettings.findUnique>
  > = null;

  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  const sent: string[] = [];
  const transport: NotificationTransport = {
    async send(message) {
      sent.push(`${message.eventType}:${message.to}`);
      return { status: "sent", providerMessageId: message.idempotencyKey };
    },
  };

  const send = (text: string, conversationId?: string) =>
    withContext(prisma, contextA, (tx) =>
      sendGuidTestMessage(tx, contextA, {
        agentId: GUID,
        text,
        ...(conversationId ? { conversationId } : {}),
      }),
    );

  const turn = (
    sentMessage: Awaited<ReturnType<typeof send>>,
    createModel: (key: ChatModelKey) => MockLanguageModelV4,
  ) =>
    runGuidTurn(
      session(sentMessage.jobRunId, contextA),
      contextA,
      {
        conversationId: sentMessage.conversationId,
        messageId: sentMessage.messageId,
      },
      { createModel },
    );

  const agent = () =>
    admin.aiAgent.findUniqueOrThrow({
      where: { id: GUID },
      select: {
        status: true,
        keyState: true,
        backupStartedAt: true,
        testedConfigHash: true,
        lastTestedAt: true,
      },
    });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.notification_deliveries where idempotency_key like 'ai-key:${GUID}:%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where agent_id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where agent_id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind = 'ai-agents.guid-turn' and workspace_id = '${ids.workspaceA}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    for (const moduleKey of ["ai-agents", "crm"]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${ids.organizationA}', '${ids.workspaceA}', '${moduleKey}', 'enabled', '${ids.userA}')
         on conflict (workspace_id, module_key) do update set status = excluded.status`,
      );
    }
    const sealed = encryptSecret(SECRET);
    const credential = await admin.credential.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        provider: "openai",
        purpose: "all",
        label: "Chave A2c",
        maskedValue: sealed.maskedValue,
        encryptedPayload: sealed.encryptedPayload,
      },
    });
    await admin.aiAgent.create({
      data: {
        id: GUID,
        kind: "guid",
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        status: "active",
        config: {
          overview: {
            agent_name: "Bia",
            language: "pt-BR",
            system_prompt: "Você é {{agent_name}}.",
          },
          integration: { tools: ["think"] },
          model: { credential_id: credential.id, model_name: "gpt-test" },
        },
        configVersion: 1,
        createdBy: ids.userA,
      },
    });
    previousSettings = await admin.platformAiSettings.findUnique({
      where: { id: true },
    });
    const backup = encryptSecret(BACKUP_SECRET);
    const settings = {
      backupProvider: "anthropic",
      backupMaskedValue: backup.maskedValue,
      backupEncryptedPayload: backup.encryptedPayload,
      backupModel: "claude-cheap",
      updatedBy: PLATFORM_OWNER,
    };
    await admin.platformAiSettings.upsert({
      where: { id: true },
      create: { id: true, ...settings },
      update: settings,
    });
    // The owner's e-mail, from the invitation accepted.
    await admin.invitation.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        email: OWNER_EMAIL,
        role: "owner",
        tokenHash: randomBytes(32).toString("hex"),
        invitedByUserId: ids.userA,
        status: "accepted",
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(),
        acceptedByUserId: ids.userA,
      },
    });
  });

  beforeEach(async () => {
    sent.length = 0;
    await cleanup();
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "active", keyState: "ok", backupStartedAt: null },
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where workspace_id = '${ids.workspaceA}' and label = 'Chave A2c'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.invitations where email = '${OWNER_EMAIL}'`,
    );
    if (previousSettings) {
      await admin.platformAiSettings.update({
        where: { id: true },
        data: {
          backupProvider: previousSettings.backupProvider,
          backupMaskedValue: previousSettings.backupMaskedValue,
          backupEncryptedPayload: previousSettings.backupEncryptedPayload,
          backupModel: previousSettings.backupModel,
          updatedBy: previousSettings.updatedBy,
        },
      });
    } else {
      await admin.platformAiSettings.deleteMany({});
    }
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key in ('ai-agents', 'crm')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("finishes an open conversation with the platform key when the customer's key fails", async () => {
    const backup = new MockLanguageModelV4({
      doGenerate: [answer("Oi! Sigo por aqui.")],
    });
    const { createModel, customer, keys } = models(401, backup);
    const message = await send("Olá");

    await expect(turn(message, createModel)).resolves.toEqual({
      status: "active",
      // A test answered by the platform's key proves nothing (A4b).
      tested: 0,
      keySource: "backup",
      messages: 1,
      tools: 0,
    });
    expect(customer.doGenerateCalls).toHaveLength(1);
    expect(backup.doGenerateCalls).toHaveLength(1);
    expect(keys.map((k) => [k.provider, k.model])).toEqual([
      ["openai", "gpt-test"],
      ["anthropic", "claude-cheap"],
    ]);

    const state = await agent();
    expect(state).toMatchObject({ status: "active", keyState: "backup" });
    expect(state.backupStartedAt).toBeInstanceOf(Date);
    expect(state.testedConfigHash).toBeNull();

    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: message.conversationId },
    });
    expect(conversation.keyMode).toBe("backup");
    const rows = await admin.aiMessage.findMany({
      where: { conversationId: message.conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows.map((m) => [m.role, m.content, m.errorCode])).toEqual([
      ["user", "Olá", null],
      ["assistant", "Oi! Sigo por aqui.", null],
    ]);
    expect(rows[1]).toMatchObject({
      provider: "anthropic",
      model: "claude-cheap",
    });

    // A courtesy of the platform: never the customer's usage.
    const courtesy = await admin.$queryRawUnsafe<{ courtesy: boolean }[]>(
      `select courtesy from public.ai_usage_events where agent_id = '${GUID}'`,
    );
    expect(courtesy).toEqual([{ courtesy: true }]);
    const usageRows = await admin.aiUsageEvent.findMany({
      where: { agentId: GUID },
    });
    expect(usageRows).toEqual([
      expect.objectContaining({
        keySource: "backup",
        workspaceId: ids.workspaceA,
        provider: "anthropic",
        model: "claude-cheap",
      }),
    ]);

    const failure = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai.agent.key_failure", resourceId: GUID },
      orderBy: { occurredAt: "desc" },
    });
    expect(failure.metadata).toMatchObject({
      reason: "provider_auth",
      to: "backup",
      executionId: message.jobRunId,
    });
    expect(JSON.stringify(failure.metadata)).not.toContain(SECRET);
  });

  it("answers only the conversations opened before the failure", async () => {
    const first = new MockLanguageModelV4({
      doGenerate: [answer("Primeira."), answer("De novo pelo backup.")],
    });
    const { createModel, customer } = models(429, first);
    const open = await send("Olá");
    await expect(turn(open, createModel)).resolves.toMatchObject({
      keySource: "backup",
    });
    expect((await agent()).keyState).toBe("backup");

    // The open conversation goes on with the backup, without the
    // customer's key.
    const again = await send("Ainda aí?", open.conversationId);
    await expect(turn(again, createModel)).resolves.toMatchObject({
      keySource: "backup",
    });
    expect(customer.doGenerateCalls).toHaveLength(1);
    expect(first.doGenerateCalls).toHaveLength(2);

    // A conversation opened after the failure is not answered.
    const fresh = await send("Conversa nova");
    await expect(turn(fresh, createModel)).rejects.toBeInstanceOf(SkipJobError);
    const error = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: fresh.conversationId, role: "assistant" },
    });
    expect(error.errorCode).toBe("key_failed");
    expect(first.doGenerateCalls).toHaveLength(2);
  });

  it("does not start the backup for an error of the request", async () => {
    const backup = new MockLanguageModelV4({ doGenerate: [] });
    const { createModel } = models(400, backup);
    const message = await send("Olá");
    await expect(turn(message, createModel)).rejects.toBeInstanceOf(AppError);
    expect(backup.doGenerateCalls).toHaveLength(0);
    expect(await agent()).toMatchObject({ keyState: "ok" });
    const error = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: message.conversationId, role: "assistant" },
    });
    expect(error.errorCode).toBe("provider_error");
  });

  it("warns the customer and pauses the agent 24 hours after the failure", async () => {
    await admin.aiAgent.update({
      where: { id: GUID },
      data: {
        keyState: "backup",
        backupStartedAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });
    const first = await workerDb.$transaction((tx) =>
      runKeyWatch(tx, new Date(), transport),
    );
    expect(first).toMatchObject({ paused: 0 });
    expect(first.notices).toBe(1);
    expect(sent).toEqual([`ai.agent.key_backup:${OWNER_EMAIL}`]);
    // Once per backup.
    const repeated = await workerDb.$transaction((tx) =>
      runKeyWatch(tx, new Date(), transport),
    );
    expect(repeated.notices).toBe(0);
    expect(await agent()).toMatchObject({
      status: "active",
      keyState: "backup",
    });

    await admin.aiAgent.update({
      where: { id: GUID },
      data: { backupStartedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const later = await workerDb.$transaction((tx) =>
      runKeyWatch(tx, new Date(), transport),
    );
    expect(later).toMatchObject({ paused: 1 });
    expect(await agent()).toMatchObject({
      status: "paused",
      keyState: "failed",
    });
    expect(sent).toContain(`ai.agent.key_paused:${OWNER_EMAIL}`);

    const deliveries = await admin.notificationDelivery.findMany({
      where: { idempotencyKey: { startsWith: `ai-key:${GUID}:` } },
      orderBy: { createdAt: "asc" },
    });
    expect(deliveries.map((d) => [d.eventType, d.status])).toEqual(
      expect.arrayContaining([
        ["ai.agent.key_backup", "sent"],
        ["ai.agent.key_paused", "sent"],
      ]),
    );
    expect(deliveries.every((d) => d.recipientEmail === OWNER_EMAIL)).toBe(
      true,
    );
    expect(deliveries.every((d) => d.relatedId === GUID)).toBe(true);
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai.agent.key_paused", resourceId: GUID },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).toMatchObject({
      actorPrincipalType: "service",
      origin: "worker",
    });

    // The paused agent takes no new message.
    await expect(send("Olá")).rejects.toMatchObject({ code: "conflict" });
  });

  it("ends the backup when the key test succeeds", async () => {
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { keyState: "backup", backupStartedAt: new Date() },
    });
    const failed = await testGuidKey(prisma, contextA, GUID, {
      createModel: () => failing(401),
    });
    expect(failed).toEqual({
      ok: false,
      errorCode: "provider_auth",
      keyRestored: false,
    });
    expect(await agent()).toMatchObject({ keyState: "backup" });

    const ok = new MockLanguageModelV4({ doGenerate: [textStep("pong")] });
    const keys: ChatModelKey[] = [];
    const passed = await testGuidKey(prisma, contextA, GUID, {
      createModel: (key) => {
        keys.push(key);
        return ok;
      },
    });
    expect(passed).toEqual({ ok: true, errorCode: null, keyRestored: true });
    expect(keys[0]).toMatchObject({ secret: SECRET, model: "gpt-test" });
    const state = await agent();
    expect(state).toMatchObject({ keyState: "ok", backupStartedAt: null });
    expect(state.lastTestedAt).toBeInstanceOf(Date);
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: {
        action: "ai.agent.key_test",
        resourceId: GUID,
        result: "success",
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ from: "backup", to: "ok" });
  });
});
