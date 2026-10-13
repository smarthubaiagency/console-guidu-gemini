import { PrismaClient } from "@prisma/client";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGuidTurnJob, runGuidTurn } from "@/core/ai/turn/guid";
import { startAssistantTurn } from "@/core/ai/turn/assistant";
import { encryptSecret } from "@/core/credentials/crypto";
import type { JobDefinition, JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { sha256 } from "@/core/ai/tools/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { sendGuidTestMessage } from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";
import { createJobWorker } from "@/worker/runtime";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A2b: the turns of the engine with a mock model of the SDK, no network.
 * GUIDS through the worker (detached job, short transactions), the tool
 * guard and its audit, and the Assistant streaming in /admin and /app.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const GUID = "a2b00000-0000-4000-8000-0000000000a1";
const PARTNER = "a2b00000-0000-4000-8000-0000000000b1";
const HOUSE = "00000000-0000-4000-8000-000000000000";
const SECRET = "sk-proj-0123456789abcdef0123456789";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Call = { name: string; input: unknown };

function toolStep(calls: Call[]) {
  return {
    content: calls.map((call, i) => ({
      type: "tool-call" as const,
      toolCallId: `call-${call.name}-${i}`,
      toolName: call.name,
      input: JSON.stringify(call.input),
    })),
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function textStep(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function streamStep(
  parts: Array<{ text: string } | Call>,
  finish: "stop" | "tool-calls",
) {
  const chunks: unknown[] = [];
  parts.forEach((part, i) => {
    if ("text" in part) {
      chunks.push(
        { type: "text-start", id: `t${i}` },
        { type: "text-delta", id: `t${i}`, delta: part.text },
        { type: "text-end", id: `t${i}` },
      );
    } else {
      chunks.push({
        type: "tool-call",
        toolCallId: `call-${part.name}-${i}`,
        toolName: part.name,
        input: JSON.stringify(part.input),
      });
    }
  });
  chunks.push({
    type: "finish",
    finishReason: { unified: finish, raw: undefined },
    usage,
  });
  return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
}

const guidConfig = (credentialId: string) => ({
  overview: {
    agent_name: "Anna",
    language: "pt-BR",
    system_prompt:
      "Você é {{agent_name}}. Contato: {{contact.first_name}}. Etapa: {{conversation.var.etapa}}.",
  },
  rules: {
    hot_score_threshold: 50,
    warm_score_threshold: 20,
    lead_scoring_rules: [
      {
        rule_id: "pede_proposta",
        key_group: "intencao",
        label: "Pede proposta",
        signal: "Pede uma proposta",
        points: 30,
      },
    ],
  },
  integration: {
    tools: [
      "think",
      "create_contact",
      "add_note",
      "score_lead",
      "set_conversation_variable",
      "handoff",
      "add_tag",
    ],
  },
  model: { credential_id: credentialId, model_name: "gpt-test" },
});

describeDatabase("A2b: turns of the engine", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  let credentialId = "";
  let houseConfig: unknown = null;
  let houseStatus = "draft";

  /** The worker's session, from the web's client (app_runtime). */
  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  async function setModules(status: "enabled" | "disabled") {
    for (const moduleKey of ["ai-agents", "crm"]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${ids.organizationA}', '${ids.workspaceA}', '${moduleKey}', '${status}', '${ids.userA}')
         on conflict (workspace_id, module_key) do update set status = excluded.status`,
      );
    }
  }

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id = '${ids.workspaceA}' or partner_id = '${PARTNER}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where workspace_id = '${ids.workspaceA}' or partner_id = '${PARTNER}'
         or (kind = 'assistant' and user_id = '${ids.userA}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_lead_activities where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.execution_proposals where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.crm_contacts where workspace_id = '${ids.workspaceA}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
    await setModules("enabled");

    const sealed = encryptSecret(SECRET);
    const credential = await admin.credential.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        provider: "openai",
        purpose: "all",
        label: "Chave A2b",
        maskedValue: sealed.maskedValue,
        encryptedPayload: sealed.encryptedPayload,
      },
    });
    credentialId = credential.id;
    await admin.aiAgent.create({
      data: {
        id: GUID,
        kind: "guid",
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        status: "active",
        config: guidConfig(credentialId),
        configVersion: 1,
        createdBy: ids.userA,
      },
    });

    // Partner P (its Assistant comes from the trigger) with userB as support.
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-a2b', 'Agência A2b')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${ids.userB}', 'support@a2b.test', 'partner_support')`,
    );
    for (const partnerId of [PARTNER, HOUSE]) {
      const key = encryptSecret(
        `sk-or-v1-${partnerId.slice(0, 8)}0123456789abcdef`,
      );
      await admin.partnerCredential.create({
        data: {
          partnerId,
          provider: "openrouter",
          label: "Chave do admin",
          maskedValue: key.maskedValue,
          encryptedPayload: key.encryptedPayload,
          createdBy: ids.userA,
        },
      });
    }
    const house = await admin.aiAgent.findFirstOrThrow({
      where: { kind: "assistant", partnerId: HOUSE },
    });
    houseConfig = house.config;
    houseStatus = house.status;
    const assistantConfig = {
      overview: {
        language: "pt-BR",
        system_prompt:
          "Você é o assistente de {{company.name}}. Pessoa: {{user.name}} ({{user.role}}).",
      },
      integration: { tools: ["think", "workspace_read", "propose_operation"] },
      model: { model_provider: "openrouter", model_name: "openai/gpt-test" },
    };
    await admin.aiAgent.updateMany({
      where: { kind: "assistant", partnerId: { in: [PARTNER, HOUSE] } },
      data: { config: assistantConfig, status: "active" },
    });
  });

  afterEach(async () => {
    await cleanup();
    await setModules("enabled");
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "active" },
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where workspace_id = '${ids.workspaceA}' and label = 'Chave A2b'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partner_credentials where partner_id = '${HOUSE}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
    await admin.aiAgent.updateMany({
      where: { kind: "assistant", partnerId: HOUSE },
      data: { config: houseConfig as object, status: houseStatus },
    });
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key in ('ai-agents', 'crm')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  const send = (text: string, conversationId?: string) =>
    withContext(prisma, contextA, (tx) =>
      sendGuidTestMessage(tx, contextA, {
        agentId: GUID,
        text,
        ...(conversationId ? { conversationId } : {}),
      }),
    );

  it("answers a GUIDS in the worker, with tools under the guard", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep([
          {
            name: "create_contact",
            input: { name: "Maria Souza", email: "maria@exemplo.com" },
          },
          {
            name: "set_conversation_variable",
            input: { key: "etapa", value: "orcamento" },
          },
          // Assistant only: refused before any effect (critério 5).
          {
            name: "workspace_read",
            input: { resource: "list_contacts", input: {} },
          },
          // In the allowlist, waiting for the CRM tags.
          { name: "add_tag", input: { tag: "vip" } },
        ]),
        toolStep([
          {
            name: "score_lead",
            input: { rule_ids: ["pede_proposta", "nao_existe"] },
          },
          {
            name: "add_note",
            input: { note: "Quer um orçamento de implante." },
          },
        ]),
        textStep(
          JSON.stringify({
            messages: ["Oi, Maria!", "Já anotei o seu pedido."],
          }),
        ),
      ],
    });
    const { conversationId, messageId, jobRunId } =
      await send("Quero uma proposta");

    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions: [
        createGuidTurnJob({ createModel: () => model }),
      ] as unknown as readonly JobDefinition<unknown>[],
      schedules: [],
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      log: () => {},
    });
    await worker.start();
    let run = await admin.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
    try {
      const deadline = Date.now() + 25_000;
      while (
        !["skipped", "failed", "succeeded"].includes(run.status) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        run = await admin.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
      }
    } finally {
      await worker.stop();
    }
    expect(run).toMatchObject({
      status: "succeeded",
      kind: "ai-agents.guid-turn",
    });
    expect(run.result).toMatchObject({
      status: "active",
      messages: 2,
      tools: 6,
    });

    // The prompt rendered the turn's context: no contact yet.
    const firstPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(firstPrompt).toContain(
      "Você é Anna. Contato: (não informado). Etapa: (não informado).",
    );
    expect(firstPrompt).toContain("Quero uma proposta");
    expect(firstPrompt).not.toContain(SECRET);

    const messages = await admin.aiMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(messages.map((m) => [m.role, m.toolName ?? ""])).toEqual([
      ["user", ""],
      ["assistant", ""],
      ["tool", "create_contact"],
      ["tool", "set_conversation_variable"],
      ["tool", "workspace_read"],
      ["tool", "add_tag"],
      ["assistant", ""],
      ["tool", "score_lead"],
      ["tool", "add_note"],
      ["assistant", ""],
      ["assistant", ""],
    ]);
    expect(messages[0]?.id).toBe(messageId);
    expect(messages.slice(1).every((m) => m.executionId === jobRunId)).toBe(
      true,
    );
    expect(messages.slice(-2).map((m) => m.content)).toEqual([
      "Oi, Maria!",
      "Já anotei o seu pedido.",
    ]);
    expect(messages.at(-1)).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      inputTokens: 30,
      outputTokens: 15,
    });
    expect(JSON.parse(messages[5]!.content)).toMatchObject({ ok: false });

    // Effects through the CRM and the conversation, in the workspace.
    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation.variables).toEqual({ etapa: "orcamento" });
    const contact = await admin.crmContact.findUniqueOrThrow({
      where: { id: conversation.contactId ?? "" },
    });
    expect(contact).toMatchObject({
      name: "Maria Souza",
      email: "maria@exemplo.com",
      workspaceId: ids.workspaceA,
      createdBy: ids.userA,
    });
    expect(contact.notes).toMatch(/Quer um orçamento de implante\.$/);
    const score = await admin.aiLeadActivity.findFirstOrThrow({
      where: { contactId: contact.id },
    });
    expect(score).toMatchObject({
      points: 30,
      temperature: "warm",
      agentId: GUID,
    });

    const usageRows = await admin.aiUsageEvent.findMany({
      where: { executionId: jobRunId },
    });
    expect(usageRows).toEqual([
      expect.objectContaining({
        keySource: "customer",
        workspaceId: ids.workspaceA,
        partnerId: null,
        inputTokens: 30,
        outputTokens: 15,
        conversationId,
      }),
    ]);

    // One audit per call: decision, rule, hashes and masked input only.
    const audits = await admin.auditEvent.findMany({
      where: { action: "ai.tool.call", resourceId: conversationId },
    });
    const byTool = Object.fromEntries(
      audits.map((a) => [(a.metadata as { tool: string }).tool, a]),
    );
    expect(Object.keys(byTool).sort()).toEqual([
      "add_note",
      "add_tag",
      "create_contact",
      "score_lead",
      "set_conversation_variable",
      "workspace_read",
    ]);
    expect(byTool.workspace_read).toMatchObject({
      result: "denied",
      metadata: expect.objectContaining({
        decision: "deny",
        rule: "kind_not_allowed",
      }),
    });
    expect(byTool.add_tag).toMatchObject({
      result: "denied",
      metadata: expect.objectContaining({
        decision: "restrict",
        rule: "feature_disabled",
      }),
    });
    const created = byTool.create_contact!.metadata as Record<string, string>;
    expect(created).toMatchObject({
      decision: "allow",
      executionId: jobRunId,
      inputHash: sha256({ name: "Maria Souza", email: "maria@exemplo.com" }),
    });
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(
      "maria@exemplo.com",
    );
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(
      "Maria Souza",
    );
    expect(
      await admin.auditEvent.count({
        where: {
          action: "ai.turn",
          resourceId: conversationId,
          result: "success",
        },
      }),
    ).toBe(1);

    // The run is answered once: running it again changes nothing.
    await expect(
      runGuidTurn(
        session(jobRunId, contextA),
        contextA,
        { conversationId, messageId },
        {
          createModel: () => model,
        },
      ),
    ).resolves.toEqual({ status: "already_answered" });
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  it("hands over to a person and then refuses new messages", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep([
          {
            name: "handoff",
            input: { reason: "Pediu para falar com uma pessoa." },
          },
        ]),
        textStep(
          JSON.stringify({ messages: ["Vou chamar alguém da equipe."] }),
        ),
      ],
    });
    const sent = await send("Quero falar com uma pessoa");
    await expect(
      runGuidTurn(session(sent.jobRunId, contextA), contextA, sent, {
        createModel: () => model,
      }),
    ).resolves.toMatchObject({ status: "handoff" });
    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: sent.conversationId },
    });
    expect(conversation.status).toBe("handoff");
    await expect(send("Oi?", sent.conversationId)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "conflict",
    );
  });

  it("blocks a paused agent and a module turned off, and records why", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textStep("{}")] });
    const sent = await send("Olá");
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "paused" },
    });
    await expect(
      runGuidTurn(session(sent.jobRunId, contextA), contextA, sent, {
        createModel: () => model,
      }),
    ).rejects.toBeInstanceOf(SkipJobError);
    expect(model.doGenerateCalls).toHaveLength(0);
    const blocked = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: sent.conversationId, role: "assistant" },
    });
    expect(blocked).toMatchObject({ errorCode: "agent_paused", content: "" });

    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "active" },
    });
    const again = await send("Olá de novo");
    await setModules("disabled");
    await expect(
      runGuidTurn(session(again.jobRunId, contextA), contextA, again, {
        createModel: () => model,
      }),
    ).rejects.toBeInstanceOf(SkipJobError);
    expect(
      await admin.aiMessage.count({
        where: {
          conversationId: again.conversationId,
          errorCode: "module_unavailable",
        },
      }),
    ).toBe(1);
  });

  it("records a provider failure without its details", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: `invalid key ${SECRET}`,
          url: "https://api.example.test",
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        });
      },
    });
    const sent = await send("Olá");
    const error = await runGuidTurn(
      session(sent.jobRunId, contextA),
      contextA,
      sent,
      {
        createModel: () => model,
      },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("provider_error");
    expect((error as AppError).safeMessage).not.toContain(SECRET);
    const failed = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: sent.conversationId, role: "assistant" },
    });
    expect(failed.errorCode).toBe("provider_auth");
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai.turn", resourceId: sent.conversationId },
    });
    expect(audit.result).toBe("error");
    expect(JSON.stringify(audit.metadata)).not.toContain(SECRET);
  });

  it("streams the Assistant in the /admin with the partner's key", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        // No workspace in the /admin: the read is restricted.
        streamStep(
          [
            {
              name: "workspace_read",
              input: { resource: "get_workspace", input: {} },
            },
          ],
          "tool-calls",
        ),
        streamStep([{ text: "Olá! " }, { text: "Como posso ajudar?" }], "stop"),
      ],
    });
    const turn = await startAssistantTurn(
      prisma,
      { scope: "partner", userId: ids.userB, partnerId: PARTNER },
      { text: "Oi" },
      { createModel: () => model },
    );
    let text = "";
    for await (const delta of turn.textStream) text += delta;
    expect(text).toBe("Olá! Como posso ajudar?");
    await expect(turn.done).resolves.toEqual({ status: "answered" });

    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain("Você é o assistente de Agência A2b.");
    expect(prompt).toContain("(partner_support)");

    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: turn.conversationId },
    });
    expect(conversation).toMatchObject({
      kind: "assistant",
      partnerId: PARTNER,
      workspaceId: null,
      userId: ids.userB,
    });
    const rows = await admin.aiMessage.findMany({
      where: { conversationId: turn.conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows.map((r) => r.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(JSON.parse(rows[2]!.content)).toMatchObject({ ok: false });
    expect(rows.at(-1)?.content).toBe("Olá! Como posso ajudar?");
    const spent = await admin.aiUsageEvent.findFirstOrThrow({
      where: { executionId: turn.executionId },
    });
    expect(spent).toMatchObject({
      keySource: "admin",
      partnerId: PARTNER,
      workspaceId: null,
      provider: "openrouter",
      model: "openai/gpt-test",
    });
    const restricted = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai.tool.call", resourceId: turn.conversationId },
    });
    expect(restricted.metadata).toMatchObject({
      decision: "restrict",
      rule: "no_workspace",
    });
  });

  it("reads the workspace and proposes a change in the /app", async () => {
    await admin.crmContact.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        name: "Contato Existente",
        createdBy: ids.userA,
      },
    });
    const model = new MockLanguageModelV4({
      doStream: [
        streamStep(
          [
            {
              name: "workspace_read",
              input: { resource: "list_contacts", input: { limit: 5 } },
            },
            {
              name: "propose_operation",
              input: {
                operation: "crm.contacts.create",
                payload: { name: "Contato Proposto" },
                reason: "Pedido no Assistente.",
              },
            },
          ],
          "tool-calls",
        ),
        streamStep([{ text: "Criei a proposta para você aprovar." }], "stop"),
      ],
    });
    const turn = await startAssistantTurn(
      prisma,
      { scope: "workspace", ctx: contextA },
      { text: "Crie um contato" },
      { createModel: () => model },
    );
    for await (const delta of turn.textStream) void delta;
    await expect(turn.done).resolves.toEqual({ status: "answered" });

    const tools = await admin.aiMessage.findMany({
      where: { conversationId: turn.conversationId, role: "tool" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const read = JSON.parse(tools[0]!.content) as {
      ok: boolean;
      result: { items: { name: string }[] };
    };
    expect(read.ok).toBe(true);
    expect(read.result.items.map((c) => c.name)).toEqual(["Contato Existente"]);

    const proposal = await admin.executionProposal.findFirstOrThrow({
      where: { workspaceId: ids.workspaceA },
    });
    expect(proposal).toMatchObject({
      operation: "crm.contacts.create",
      status: "pending",
      requestedBy: ids.userA,
      apiKeyId: null,
      aiExecutionId: turn.executionId,
    });
    // Nothing ran: the person approves it on the proposals page.
    expect(
      await admin.crmContact.count({
        where: { workspaceId: ids.workspaceA, name: "Contato Proposto" },
      }),
    ).toBe(0);
    const spent = await admin.aiUsageEvent.findFirstOrThrow({
      where: { executionId: turn.executionId },
    });
    expect(spent).toMatchObject({
      keySource: "admin",
      partnerId: HOUSE,
      workspaceId: ids.workspaceA,
    });
  });
});
