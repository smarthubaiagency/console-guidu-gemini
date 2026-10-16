import { PrismaClient } from "@prisma/client";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAgentConfig } from "@/core/ai/config/schema";
import { promptLocale } from "@/core/ai/prompt/texts";
import { buildTools, type ToolEnv } from "@/core/ai/tools/catalog";
import { deliverLeadNotice, signNotice } from "@/core/ai/notices/lead";
import { dispatchEvent } from "@/core/events/dispatch";
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
import {
  getGuidTestConversation,
  sendGuidTestMessage,
} from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";
import { createJobWorker } from "@/worker/runtime";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A2b: the turns of the engine with a mock model of the SDK, no network.
 * GUIDS through the worker (detached job, short transactions), the tool
 * guard and its audit, and the Assistant streaming in /admin and /app.
 * A4b: the GUIDS's test conversation runs the tools simulated and records
 * the configuration that passed; the real effects of the tools are run
 * directly, as the channels of the A5 will.
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
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
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
    await workerDb.$disconnect();
  });

  const send = (text: string, conversationId?: string) =>
    withContext(prisma, contextA, (tx) =>
      sendGuidTestMessage(tx, contextA, {
        agentId: GUID,
        text,
        ...(conversationId ? { conversationId } : {}),
      }),
    );

  it("answers a GUIDS test in the worker, with tools simulated under the guard", async () => {
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
      tested: 1,
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

    // A test: only the conversation's own memory is written; the CRM and
    // the score are described, with `simulated: true`.
    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation.variables).toEqual({ etapa: "orcamento" });
    expect(conversation.contactId).toBeNull();
    expect(
      await admin.crmContact.count({ where: { workspaceId: ids.workspaceA } }),
    ).toBe(0);
    expect(
      await admin.aiLeadActivity.count({
        where: { workspaceId: ids.workspaceA },
      }),
    ).toBe(0);
    const outputs = Object.fromEntries(
      messages
        .filter((m) => m.role === "tool")
        .map((m) => [m.toolName, JSON.parse(m.content) as unknown]),
    );
    expect(outputs.create_contact).toMatchObject({
      result: { simulated: true },
    });
    expect(outputs.score_lead).toMatchObject({
      result: { points: 30, temperature: "warm", simulated: true },
    });
    expect(outputs.add_note).toMatchObject({
      result: { added: true, simulated: true },
    });

    // The screen reads it back with the tools before each answer.
    const chat = await withContext(prisma, contextA, (tx) =>
      getGuidTestConversation(tx, contextA, GUID, conversationId),
    );
    expect(chat?.waiting).toBe(false);
    expect(
      chat?.messages.map((m) => [m.role, m.content, m.tools.length]),
    ).toEqual([
      ["user", "Quero uma proposta", 0],
      ["assistant", "Oi, Maria!", 6],
      ["assistant", "Já anotei o seu pedido.", 0],
    ]);
    expect(chat?.messages[1]?.tools[0]).toMatchObject({
      name: "create_contact",
      output: { result: { simulated: true } },
    });

    // The configuration that answered is the one that passed the test.
    const [tested] = await admin.$queryRawUnsafe<{ same: boolean }[]>(
      `select tested_config_hash = md5(config::text) as same
       from public.ai_agents where id = '${GUID}'`,
    );
    expect(tested?.same).toBe(true);

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

  it("simulates a handoff in a test, and the test goes on", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep([
          {
            name: "handoff",
            input: {
              reason: "Pediu para falar com uma pessoa.",
              summary: "Contato quer falar com uma pessoa.",
            },
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
    ).resolves.toMatchObject({ status: "active" });
    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: sent.conversationId },
    });
    expect(conversation.status).toBe("active");
    const output = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: sent.conversationId, toolName: "handoff" },
    });
    expect(JSON.parse(output.content)).toMatchObject({
      result: { handed_over: true, simulated: true },
    });
    await expect(send("Oi?", sent.conversationId)).resolves.toMatchObject({
      conversationId: sent.conversationId,
    });
  });

  it("runs the real effects of the tools outside a test", async () => {
    const sent = await send("Quero uma proposta");
    const parsed = parseAgentConfig("guid", 1, guidConfig(credentialId));
    if (!parsed.success) throw new Error("invalid config");
    const env: ToolEnv = {
      kind: "guid",
      executionId: sent.jobRunId,
      agentId: GUID,
      conversationId: sent.conversationId,
      config: parsed.data,
      locale: promptLocale("pt-BR"),
      db: session(sent.jobRunId, contextA),
      workspace: contextA,
      prisma: null,
      now: () => new Date(),
      state: { contactId: null, status: "active", memory: {}, records: [] },
      simulate: false,
    };
    const tools = buildTools(env);
    const call = (name: string, input: unknown) =>
      (
        tools[name]!.execute as unknown as (
          input: unknown,
          options: { toolCallId: string; messages: [] },
        ) => Promise<unknown>
      )(input, { toolCallId: `call-${name}`, messages: [] });

    await call("create_contact", {
      name: "Maria Souza",
      email: "maria@exemplo.com",
    });
    await call("score_lead", { rule_ids: ["pede_proposta"] });
    await call("add_note", { note: "Quer um orçamento de implante." });
    await call("handoff", {
      reason: "Pediu uma pessoa.",
      summary: "Quer um orçamento.",
    });
    expect(env.state.records.map((r) => r.decision)).toEqual([
      "allow",
      "allow",
      "allow",
      "allow",
    ]);

    const conversation = await admin.aiConversation.findUniqueOrThrow({
      where: { id: sent.conversationId },
    });
    expect(conversation.status).toBe("handoff");
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
    expect(
      await admin.aiLeadActivity.findFirstOrThrow({
        where: { contactId: contact.id },
      }),
    ).toMatchObject({ points: 30, temperature: "warm", agentId: GUID });
    // Below the hot threshold: nobody is told.
    expect(await admin.aiLeadNotice.count({ where: { agentId: GUID } })).toBe(
      0,
    );
    // A conversation handed over takes no new message.
    await expect(send("Oi?", sent.conversationId)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "conflict",
    );
  });

  it("tells the merchant of a hot lead once, by the partner's webhook (A6a)", async () => {
    const base = guidConfig(credentialId);
    const stored = {
      ...base,
      rules: {
        ...base.rules,
        notify_on_score: 30,
        owner_phone: "+5511988887777",
      },
    };
    // The delivery reads the agent as stored.
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { config: stored },
    });
    const parsed = parseAgentConfig("guid", 1, stored);
    if (!parsed.success) throw new Error("invalid config");
    const sent = await send("Quero uma proposta");
    const env: ToolEnv = {
      kind: "guid",
      executionId: sent.jobRunId,
      agentId: GUID,
      conversationId: sent.conversationId,
      config: parsed.data,
      locale: promptLocale("pt-BR"),
      db: session(sent.jobRunId, contextA),
      workspace: contextA,
      prisma: null,
      now: () => new Date(),
      state: { contactId: null, status: "active", memory: {}, records: [] },
      simulate: false,
    };
    const tools = buildTools(env);
    const call = (name: string, input: unknown) =>
      (
        tools[name]!.execute as unknown as (
          input: unknown,
          options: { toolCallId: string; messages: [] },
        ) => Promise<unknown>
      )(input, { toolCallId: `call-${name}`, messages: [] });
    await call("create_contact", {
      name: "Maria Souza",
      phone: "+5511977776666",
    });
    await call("score_lead", { rule_ids: ["pede_proposta"] });
    await call("score_lead", { rule_ids: ["pede_proposta"] });

    const notices = await admin.aiLeadNotice.findMany({
      where: { agentId: GUID },
    });
    expect(notices).toHaveLength(1);
    const notice = notices[0]!;
    expect(notice).toMatchObject({
      points: 30,
      temperature: "warm",
      channel: "whatsapp",
      status: "pending",
      conversationId: sent.conversationId,
    });
    // The hub (H1) got the event in the scoring's transaction, with the
    // message written, and its dispatch was queued.
    const [hubEvent] = await admin.$queryRawUnsafe<
      { id: string; type: string; data: Record<string, unknown> }[]
    >(
      `select id, type, data from public.events where idempotency_key = 'lead-notice:${notice.id}'`,
    );
    expect(hubEvent?.type).toBe("ai.agent.lead_hot");
    expect(hubEvent?.data).toMatchObject({
      noticeId: notice.id,
      whatsapp: { to: "+5511988887777", skip: null },
    });
    await admin.jobRun.findFirstOrThrow({
      where: {
        kind: "events.dispatch",
        idempotencyKey: `event:${hubEvent!.id}`,
      },
    });

    const secret = "segredo-do-webhook-a6a";
    const sealed = encryptSecret(secret);
    await admin.partnerNoticeWebhook.create({
      data: {
        partnerId: HOUSE,
        url: "https://198.51.100.20/guidu",
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
        updatedBy: ids.userA,
      },
    });
    try {
      const posts: { url: string; init: RequestInit }[] = [];
      let answer = new Response("erro", { status: 500 });
      const fetch = (async (url: string | URL, init: RequestInit = {}) => {
        posts.push({ url: String(url), init });
        return answer;
      }) as typeof globalThis.fetch;
      // The dispatch of the hub, as the worker (app_worker).
      const dispatch = () =>
        workerDb.$transaction((tx) =>
          dispatchEvent(tx as unknown as ContextTransaction, hubEvent!.id, {
            fetch,
            now: () => new Date("2026-10-14T12:00:00Z"),
          }),
        );

      // A failure stays visible and a follow-up run is queued.
      await expect(dispatch()).resolves.toMatchObject({ whatsapp: "failed" });
      expect(
        await admin.aiLeadNotice.findUniqueOrThrow({
          where: { id: notice.id },
        }),
      ).toMatchObject({ status: "failed", reason: "http_500", attempts: 1 });
      await admin.jobRun.findFirstOrThrow({
        where: {
          kind: "events.dispatch",
          idempotencyKey: `event:${hubEvent!.id}:retry:1`,
        },
      });

      answer = new Response("ok", { status: 200 });
      await expect(dispatch()).resolves.toMatchObject({ whatsapp: "sent" });
      expect(posts).toHaveLength(2);
      const headers = new Headers(posts[1]!.init.headers);
      const body = String(posts[1]!.init.body);
      expect(posts[1]!.url).toBe("https://198.51.100.20/guidu");
      expect(headers.get("x-guidu-event")).toBe("lead.hot");
      expect(headers.get("x-guidu-event-id")).toBe(hubEvent!.id);
      expect(headers.get("x-guidu-signature")).toBe(
        signNotice(secret, headers.get("x-guidu-timestamp") ?? "", body),
      );
      expect(JSON.parse(body)).toMatchObject({
        event: "lead.hot",
        event_id: hubEvent!.id,
        notice_id: notice.id,
        to: "+5511988887777",
        text: "Lead quente no Anna: Maria Souza (+5511977776666), score 30 (morno). Motivos: Pede proposta.",
        lead: { name: "Maria Souza", score: 30, reasons: ["Pede proposta"] },
        agent: { id: GUID, name: "Anna" },
      });
      expect(
        await admin.aiLeadNotice.findUniqueOrThrow({
          where: { id: notice.id },
        }),
      ).toMatchObject({ status: "sent", reason: null, attempts: 2 });
      const delivery = await admin.notificationDelivery.findUniqueOrThrow({
        where: { idempotencyKey: `lead-notice:${notice.id}:whatsapp` },
      });
      expect(delivery).toMatchObject({
        channel: "whatsapp",
        status: "sent",
        eventId: hubEvent!.id,
        provider: "partner_webhook",
        partnerId: HOUSE,
        recipientEmail: null,
      });
      // Sent once: running it again sends nothing.
      await expect(dispatch()).resolves.toMatchObject({ whatsapp: "done" });
      expect(posts).toHaveLength(2);
    } finally {
      await admin.partnerNoticeWebhook.deleteMany({
        where: { partnerId: HOUSE },
      });
      await admin.aiAgent.update({
        where: { id: GUID },
        data: { config: base },
      });
    }
  });

  it("refers a contact and tells the merchant, never the referral (A6b)", async () => {
    const base = guidConfig(credentialId);
    const stored = {
      ...base,
      rules: {
        ...base.rules,
        owner_phone: "+5511988887777",
        partner_referral_notify: true,
        partner_message_template:
          "Indicamos {{referral.name}} ({{referral.specialties}}): {{referral.phone}}.",
      },
      integration: { tools: ["think", "create_contact", "refer_contact"] },
    };
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { config: stored },
    });
    await admin.aiAgentReferral.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        name: "Dr. Paulo",
        referralTag: "dermato",
        specialties: ["dermatologia"],
        phone: "+5511955554444",
        createdBy: ids.userA,
      },
    });
    const secret = "segredo-do-webhook-a6b";
    const sealed = encryptSecret(secret);
    await admin.partnerNoticeWebhook.create({
      data: {
        partnerId: HOUSE,
        url: "https://198.51.100.21/guidu",
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
        updatedBy: ids.userA,
      },
    });
    try {
      // The test conversation: the GUIDS sees the referrals and the tool
      // answers simulated, with the message for the contact.
      const model = new MockLanguageModelV4({
        doGenerate: [
          toolStep([
            {
              name: "refer_contact",
              input: {
                referral_tag: "dermato",
                reason: "Quer tratar manchas.",
              },
            },
          ]),
          textStep(JSON.stringify({ messages: ["Indicamos o Dr. Paulo."] })),
        ],
      });
      const tested = await send("Vocês tratam manchas na pele?");
      await runGuidTurn(session(tested.jobRunId, contextA), contextA, tested, {
        createModel: () => model,
      });
      const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
      expect(prompt).toContain("- Dr. Paulo (tag: dermato): dermatologia");
      const simulated = await admin.aiMessage.findFirstOrThrow({
        where: {
          conversationId: tested.conversationId,
          toolName: "refer_contact",
        },
      });
      expect(JSON.parse(simulated.content)).toMatchObject({
        result: {
          message_for_contact:
            "Indicamos Dr. Paulo (dermatologia): +5511955554444.",
          simulated: true,
        },
      });
      expect(await admin.aiLeadNotice.count({ where: { agentId: GUID } })).toBe(
        0,
      );

      // Outside a test: a note on the contact and one notice per referral.
      const parsed = parseAgentConfig("guid", 1, stored);
      if (!parsed.success) throw new Error("invalid config");
      const sent = await send("Quero indicação");
      const env: ToolEnv = {
        kind: "guid",
        executionId: sent.jobRunId,
        agentId: GUID,
        conversationId: sent.conversationId,
        config: parsed.data,
        locale: promptLocale("pt-BR"),
        db: session(sent.jobRunId, contextA),
        workspace: contextA,
        prisma: null,
        now: () => new Date(),
        state: { contactId: null, status: "active", memory: {}, records: [] },
        simulate: false,
      };
      const tools = buildTools(env);
      const call = (name: string, input: unknown) =>
        (
          tools[name]!.execute as unknown as (
            input: unknown,
            options: { toolCallId: string; messages: [] },
          ) => Promise<unknown>
        )(input, { toolCallId: `call-${name}`, messages: [] });
      await call("create_contact", {
        name: "Ana Lima",
        phone: "+5511966665555",
      });
      const refer = { referral_tag: "dermato", reason: "Quer tratar manchas." };
      await expect(call("refer_contact", refer)).resolves.toMatchObject({
        ok: true,
        result: { referral: { name: "Dr. Paulo" } },
      });
      await call("refer_contact", refer);
      await expect(
        call("refer_contact", { referral_tag: "nao-existe", reason: "x" }),
      ).resolves.toMatchObject({ ok: false });
      expect(env.state.records.map((r) => r.decision)).toEqual([
        "allow",
        "allow",
        "allow",
        "restrict",
      ]);
      const contact = await admin.crmContact.findUniqueOrThrow({
        where: { id: env.state.contactId ?? "" },
      });
      expect(contact.notes).toMatch(
        /Indicado para Dr\. Paulo: Quer tratar manchas\.$/,
      );
      const notices = await admin.aiLeadNotice.findMany({
        where: { agentId: GUID },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        kind: "referral",
        contactId: contact.id,
        points: null,
        reasonText: "Quer tratar manchas.",
        status: "pending",
      });

      const posts: { url: string; init: RequestInit }[] = [];
      const fetch = (async (url: string | URL, init: RequestInit = {}) => {
        posts.push({ url: String(url), init });
        return new Response("{}", { status: 200 });
      }) as typeof globalThis.fetch;
      await expect(
        deliverLeadNotice(
          session(crypto.randomUUID(), contextA),
          contextA,
          { noticeId: notices[0]!.id },
          { fetch },
        ),
      ).resolves.toEqual({ status: "sent" });
      const body = String(posts[0]!.init.body);
      const headers = new Headers(posts[0]!.init.headers);
      expect(headers.get("x-guidu-event")).toBe("referral.recommended");
      expect(headers.get("x-guidu-signature")).toBe(
        signNotice(secret, headers.get("x-guidu-timestamp") ?? "", body),
      );
      // To the merchant's phone; the referral's phone is data, not a target.
      expect(JSON.parse(body)).toMatchObject({
        event: "referral.recommended",
        to: "+5511988887777",
        text: "O Anna indicou Dr. Paulo (+5511955554444) para Ana Lima (+5511966665555). Motivo: Quer tratar manchas.",
        referral: { name: "Dr. Paulo", phone: "+5511955554444" },
        lead: { name: "Ana Lima" },
      });
    } finally {
      await admin.partnerNoticeWebhook.deleteMany({
        where: { partnerId: HOUSE },
      });
      await admin.aiAgentReferral.deleteMany({
        where: { workspaceId: ids.workspaceA, referralTag: "dermato" },
      });
      await admin.aiAgent.update({
        where: { id: GUID },
        data: { config: base },
      });
    }
  });

  it("tests a paused agent, and blocks a module turned off", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [textStep(JSON.stringify({ messages: ["Oi!"] }))],
    });
    // A paused agent is tested before it is turned on again.
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "paused" },
    });
    const sent = await send("Olá");
    await expect(
      runGuidTurn(session(sent.jobRunId, contextA), contextA, sent, {
        createModel: () => model,
      }),
    ).resolves.toMatchObject({ tested: 1, messages: 1 });
    expect(model.doGenerateCalls).toHaveLength(1);

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

  it("follows the business hours on a channel (A6c)", async () => {
    const base = guidConfig(credentialId);
    await admin.aiAgent.update({
      where: { id: GUID },
      data: {
        config: {
          ...base,
          scope: {
            timezone: "America/Sao_Paulo",
            availability_slots: ["mon", "tue", "wed", "thu", "fri"].map(
              (weekday) => ({ weekday, start: "08:00", end: "18:00" }),
            ),
          },
          rules: {
            ...base.rules,
            after_hours_behavior: "auto_reply_only",
            out_of_scope_action: "escalate_team",
          },
          integration: { tools: ["think"] },
        },
      },
    });
    try {
      // A conversation from Chatwoot, not a test.
      const sent = await send("Oi");
      await admin.$executeRawUnsafe(
        `update public.ai_conversations
            set channel = 'chatwoot', channel_conversation_id = gen_random_uuid(), user_id = null
          where id = '${sent.conversationId}'`,
      );
      const turn = async (text: string, local: string) => {
        const message = await admin.aiMessage.create({
          data: {
            conversationId: sent.conversationId,
            role: "user",
            content: text,
          },
        });
        const jobRunId = crypto.randomUUID();
        return runGuidTurn(
          session(jobRunId, contextA),
          contextA,
          { conversationId: sent.conversationId, messageId: message.id },
          {
            createModel: () => model,
            now: () => new Date(`${local}:00-03:00`),
          },
        );
      };
      const model = new MockLanguageModelV4({
        doGenerate: [textStep(JSON.stringify({ messages: ["Bom dia!"] }))],
      });

      // Sunday night: the fixed answer, without the model, once.
      await expect(turn("Alguém aí?", "2026-10-18T22:00")).resolves.toEqual({
        status: "after_hours_reply",
        messages: 1,
      });
      await expect(turn("Oi??", "2026-10-18T23:00")).resolves.toEqual({
        status: "after_hours_silent",
      });
      expect(model.doGenerateCalls).toHaveLength(0);
      const replies = await admin.aiMessage.findMany({
        where: { conversationId: sent.conversationId, role: "assistant" },
      });
      expect(replies).toHaveLength(1);
      expect(replies[0]!.content).toContain(
        "fora do horário de atendimento (seg-sex: 08:00 às 18:00)",
      );
      expect(replies[0]!.inputTokens).toBeNull();
      expect(
        await admin.aiUsageEvent.count({
          where: { conversationId: sent.conversationId },
        }),
      ).toBe(0);

      // Monday morning: the model answers, knowing it is open, and may
      // hand out-of-scope questions over to the team.
      await expect(turn("Bom dia", "2026-10-19T09:00")).resolves.toMatchObject({
        status: "active",
        messages: 1,
      });
      const call = model.doGenerateCalls[0]!;
      const prompt = JSON.stringify(call.prompt);
      expect(prompt).toContain("O atendimento está aberto agora");
      expect(prompt).toContain("2026-10-19 09:00");
      expect((call.tools ?? []).map((t) => t.name)).toEqual(
        expect.arrayContaining(["think", "handoff"]),
      );
    } finally {
      await admin.aiAgent.update({
        where: { id: GUID },
        data: { config: guidConfig(credentialId) },
      });
    }
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
    // CF6a: the failed call counts in the usage, with no tokens.
    const usage = await admin.aiUsageEvent.findMany({
      where: { conversationId: sent.conversationId },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      errorCode: "provider_auth",
      keySource: "customer",
      inputTokens: 0,
      outputTokens: 0,
      workspaceId: ids.workspaceA,
    });
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
