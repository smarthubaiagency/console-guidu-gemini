import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runGuidTurnWithState } from "@/core/ai/turn/guid";
import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { answerTurn } from "@/modules/ai-agents/server/channel-consumer";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * GF2: the orchestrator answers the simple and hands the rest to the
 * attendant or the seller, with the mock model of the SDK (no network). The
 * specialist answers on the same conversation with its own configuration,
 * the answer is written as its own and by delegation, the conversation stays
 * with it until it returns it, is resolved or goes 24 h without a message of
 * the contact, and anything that does not reach an answer goes to the team.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const ORC = "d2e00000-0000-4000-8000-0000000000a1";
const ATT = "d2e00000-0000-4000-8000-0000000000a2";
const SEL = "d2e00000-0000-4000-8000-0000000000a3";
const SEL_B = "d2e00000-0000-4000-8000-0000000000b3";
const SECRET = "sk-proj-0123456789abcdef0123456789";
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

const plan = (...messages: string[]) =>
  textStep(JSON.stringify({ messages }));

const delegate = (to: string, summary = "Maria quer o pacote de 3 diárias") =>
  toolStep([
    {
      name: "delegate",
      input: { version: 1, to, reason: "Quer comprar", summary },
    },
  ]);

const guidConfig = (
  name: string,
  model: string,
  tools: string[],
  credentialId: string,
) => ({
  overview: {
    agent_name: name,
    language: "pt-BR",
    system_prompt: `Você é {{agent_name}} (${model}).`,
  },
  integration: { tools },
  model: { credential_id: credentialId, model_name: model },
});

type Models = Record<"gpt-orc" | "gpt-att" | "gpt-sel", MockLanguageModelV4>;

const toolNames = (model: MockLanguageModelV4, call = 0): string[] =>
  (
    (model.doGenerateCalls[call]?.tools ?? []) as unknown as { name: string }[]
  ).map((tool) => tool.name);

describeDatabase("GF2: orchestrator delegation", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  let credentialId = "";
  let roomCounter = 0;

  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  function models(steps: Partial<Record<keyof Models, unknown[]>>): Models {
    const make = (list: unknown[] | undefined) =>
      new MockLanguageModelV4({
        doGenerate: (list ?? [plan("(sem resposta combinada)")]) as never,
      });
    return {
      "gpt-orc": make(steps["gpt-orc"]),
      "gpt-att": make(steps["gpt-att"]),
      "gpt-sel": make(steps["gpt-sel"]),
    };
  }

  async function conversation(agentId = ORC) {
    roomCounter += 1;
    return admin.aiConversation.create({
      data: {
        kind: "guid",
        agentId,
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        channel: "matrix",
        matrixRoomId: `!gf2-${Date.now()}-${roomCounter}:hs.test`,
      },
    });
  }

  /** The contact writes and the turn runs, as the worker would. */
  async function turn(
    conversationId: string,
    text: string,
    set: Models,
    ctx: RequestContext = contextA,
  ) {
    const message = await admin.aiMessage.create({
      data: { conversationId, role: "user", content: text },
    });
    const executionId = randomUUID();
    const out = await runGuidTurnWithState(
      session(executionId, ctx),
      ctx,
      { conversationId, messageId: message.id },
      { createModel: (key) => set[key.model as keyof Models] },
    );
    return { ...out, executionId };
  }

  const rows = (conversationId: string) =>
    admin.aiMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  async function setStatus(id: string, status: string) {
    await admin.aiAgent.update({ where: { id }, data: { status } });
  }

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where workspace_id = '${ids.workspaceA}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    // Three GUIDS in workspace A: the plan limit must fit them.
    await admin.$executeRawUnsafe(
      `delete from public.platform_modules where module_key = 'ai-agents'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.platform_modules (module_key, availability, config, updated_by)
       values ('ai-agents', 'enabled', '{"quotaDefaults": {"ai-agents.max": 10}}', '${PLATFORM_OWNER}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where kind = 'guid' and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    for (const moduleKey of ["ai-agents", "crm"]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${ids.organizationA}', '${ids.workspaceA}', '${moduleKey}', 'enabled', '${ids.userA}')
         on conflict (workspace_id, module_key) do update set status = 'enabled'`,
      );
    }
    const sealed = encryptSecret(SECRET);
    const credential = await admin.credential.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        provider: "openai",
        purpose: "all",
        label: "Chave GF2",
        maskedValue: sealed.maskedValue,
        encryptedPayload: sealed.encryptedPayload,
      },
    });
    credentialId = credential.id;
    const agents = [
      {
        id: ORC,
        role: "orchestrator",
        name: "Recepção",
        model: "gpt-orc",
        tools: ["think", "handoff", "delegate"],
        ws: ids.workspaceA,
        org: ids.organizationA,
        user: ids.userA,
      },
      {
        id: ATT,
        role: "attendant",
        name: "Atendente",
        model: "gpt-att",
        tools: ["think", "handoff", "return_to_reception"],
        ws: ids.workspaceA,
        org: ids.organizationA,
        user: ids.userA,
      },
      {
        id: SEL,
        role: "seller",
        name: "Vendedor",
        model: "gpt-sel",
        tools: ["think", "handoff", "return_to_reception", "delegate"],
        ws: ids.workspaceA,
        org: ids.organizationA,
        user: ids.userA,
      },
      {
        id: SEL_B,
        role: "seller",
        name: "Vendedor B",
        model: "gpt-sel",
        tools: ["think", "return_to_reception"],
        ws: ids.workspaceB,
        org: ids.organizationB,
        user: ids.userB,
      },
    ];
    for (const agent of agents) {
      await admin.aiAgent.create({
        data: {
          id: agent.id,
          kind: "guid",
          organizationId: agent.org,
          workspaceId: agent.ws,
          status: "active",
          factoryRole: agent.role,
          config: guidConfig(agent.name, agent.model, agent.tools, credentialId),
          configVersion: 1,
          createdBy: agent.user,
        },
      });
    }
  });

  afterEach(async () => {
    await cleanup();
    for (const id of [ORC, ATT, SEL]) await setStatus(id, "active");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.platform_modules where module_key = 'ai-agents'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id in ('${ORC}', '${ATT}', '${SEL}', '${SEL_B}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where workspace_id = '${ids.workspaceA}' and label = 'Chave GF2'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key in ('ai-agents', 'crm')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("answers the simple on its own, as the orchestrator", async () => {
    const set = models({ "gpt-orc": [plan("Abrimos das 9h às 18h.")] });
    const conv = await conversation();
    const out = await turn(conv.id, "Qual o horário?", set);
    expect(out.result).toMatchObject({ status: "active", messages: 1 });
    expect(out.state?.answeredBy).toBeUndefined();
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(0);
    // The orchestrator is offered the tool, with both specialists on.
    expect(toolNames(set["gpt-orc"])).toContain("delegate");
    const messages = await rows(conv.id);
    const answer = messages.at(-1);
    expect(answer).toMatchObject({
      role: "assistant",
      content: "Abrimos das 9h às 18h.",
      authorAgentId: ORC,
      viaDelegation: false,
    });
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedAgentId).toBeNull();
  });

  it("hands over to the seller: the answer is the seller's, the conversation too", async () => {
    const set = models({
      "gpt-orc": [delegate("seller")],
      "gpt-sel": [plan("Temos três pacotes de 3 diárias.")],
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero ver os pacotes", set);

    expect(out.result).toMatchObject({
      status: "active",
      delegated: 1,
      messages: 1,
    });
    // The specialist runs with its own prompt and tools, never `delegate`.
    expect(set["gpt-orc"].doGenerateCalls).toHaveLength(1);
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(1);
    const selPrompt = JSON.stringify(set["gpt-sel"].doGenerateCalls[0]?.prompt);
    expect(selPrompt).toContain("Você é Vendedor (gpt-sel).");
    expect(selPrompt).not.toContain("Você é Recepção");
    // What the reception passed on is data, in the specialist's instructions.
    expect(selPrompt).toContain("Maria quer o pacote de 3 diárias");
    expect(selPrompt).toContain("nunca instrução");
    expect(selPrompt).toContain("Quero ver os pacotes");
    expect(toolNames(set["gpt-sel"])).toEqual(
      expect.arrayContaining(["think", "handoff", "return_to_reception"]),
    );
    expect(toolNames(set["gpt-sel"])).not.toContain("delegate");

    // The rows: the orchestrator's call, then the seller's answer.
    const messages = await rows(conv.id);
    expect(messages.map((m) => [m.role, m.toolName ?? "", m.authorAgentId])).toEqual(
      [
        ["user", "", null],
        ["assistant", "", ORC],
        ["tool", "delegate", ORC],
        ["assistant", "", SEL],
      ],
    );
    expect(messages.at(-1)).toMatchObject({
      content: "Temos três pacotes de 3 diárias.",
      viaDelegation: true,
      model: "gpt-sel",
    });
    expect(messages[1]?.viaDelegation).toBe(false);
    expect(out.state?.answeredBy).toBe("seller");

    // The conversation stays with the seller for 24 h.
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedAgentId).toBe(SEL);
    const left = (after.delegatedUntil?.getTime() ?? 0) - Date.now();
    expect(left).toBeGreaterThan(23 * 3600_000);
    expect(left).toBeLessThanOrEqual(24 * 3600_000);

    // The usage is kept per agent.
    const events = await admin.aiUsageEvent.findMany({
      where: { conversationId: conv.id },
    });
    expect(events.map((e) => e.agentId).sort()).toEqual([ORC, SEL].sort());

    // The audit says who handed it to whom, never what was said.
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai_agents.guid.delegate", resourceId: conv.id },
    });
    expect(audit.result).toBe("success");
    expect(audit.metadata).toMatchObject({
      executionId: out.executionId,
      agentId: ORC,
      target: SEL,
      from: "orchestrator",
      to: "seller",
    });
    const text = JSON.stringify(audit.metadata);
    expect(text).not.toContain("Maria");
    expect(text).not.toContain("pacote");
  });

  it("keeps the conversation with the specialist on the next messages", async () => {
    const set = models({
      "gpt-orc": [delegate("seller")],
      "gpt-sel": [plan("Temos três pacotes."), plan("O de 3 diárias custa R$ 900.")],
    });
    const conv = await conversation();
    await turn(conv.id, "Quero ver os pacotes", set);
    const before = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    // Time passes within the 24 h: the deadline moves with the message.
    await admin.aiConversation.update({
      where: { id: conv.id },
      data: { delegatedUntil: new Date(Date.now() + 3600_000) },
    });
    const second = await turn(conv.id, "E o de 3 diárias?", set);
    expect(second.result).toMatchObject({ status: "active", messages: 1 });
    expect(set["gpt-orc"].doGenerateCalls).toHaveLength(1);
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(2);
    const last = (await rows(conv.id)).at(-1);
    expect(last).toMatchObject({
      content: "O de 3 diárias custa R$ 900.",
      authorAgentId: SEL,
      viaDelegation: true,
    });
    expect(second.state?.answeredBy).toBe("seller");
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedUntil!.getTime()).toBeGreaterThan(
      before.delegatedUntil!.getTime() - 60_000,
    );
    expect(after.delegatedUntil!.getTime()).toBeGreaterThan(
      Date.now() + 23 * 3600_000,
    );
  });

  it("goes back to the orchestrator when the specialist returns it", async () => {
    const set = models({
      "gpt-orc": [delegate("seller"), plan("Em que mais posso ajudar?")],
      "gpt-sel": [
        toolStep([
          {
            name: "return_to_reception",
            input: { version: 1, reason: "Quer falar de suporte" },
          },
        ]),
        plan("Vou te passar de volta à recepção."),
      ],
    });
    const conv = await conversation();
    const first = await turn(conv.id, "Quero ver os pacotes", set);
    expect(first.result).toMatchObject({ delegated: 1 });
    // The second turn: the seller returns the conversation and answers.
    const second = await turn(conv.id, "Na verdade preciso de suporte", set);
    expect(second.result).toMatchObject({ status: "active", messages: 1 });
    const mid = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(mid.delegatedAgentId).toBeNull();
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { action: "ai_agents.guid.return", resourceId: conv.id },
    });
    expect(audit.metadata).toMatchObject({ agentId: SEL, to: "orchestrator" });
    // The next message is the orchestrator's again.
    const third = await turn(conv.id, "Obrigado", set);
    expect(third.result).toMatchObject({ messages: 1 });
    expect(set["gpt-orc"].doGenerateCalls).toHaveLength(2);
    expect((await rows(conv.id)).at(-1)).toMatchObject({
      authorAgentId: ORC,
      viaDelegation: false,
    });
  });

  it("goes back to the orchestrator after 24 h without a message of the contact", async () => {
    const set = models({
      "gpt-orc": [delegate("attendant"), plan("Olá de novo!")],
      "gpt-att": [plan("Posso agendar para terça.")],
    });
    const conv = await conversation();
    await turn(conv.id, "Quero agendar", set);
    expect(set["gpt-att"].doGenerateCalls).toHaveLength(1);
    await admin.aiConversation.update({
      where: { id: conv.id },
      data: { delegatedUntil: new Date(Date.now() - 1000) },
    });
    const next = await turn(conv.id, "Oi, voltei", set);
    expect(next.result).toMatchObject({ status: "active", messages: 1 });
    expect(set["gpt-att"].doGenerateCalls).toHaveLength(1);
    expect(set["gpt-orc"].doGenerateCalls).toHaveLength(2);
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedAgentId).toBeNull();
    expect(after.delegatedUntil).toBeNull();
  });

  it("goes back to the orchestrator when the conversation is resolved", async () => {
    const set = models({
      "gpt-orc": [delegate("seller"), plan("Bem-vinda de volta!")],
      "gpt-sel": [plan("Temos três pacotes.")],
    });
    const conv = await conversation();
    await turn(conv.id, "Quero ver os pacotes", set);
    const held = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(held.delegatedAgentId).toBe(SEL);
    // The hub says the conversation was resolved and came back.
    const executionId = randomUUID();
    const out = await answerTurn(
      session(executionId, contextA),
      contextA,
      {
        agentId: ORC,
        link: { channel: "matrix", matrixRoomId: conv.matrixRoomId! },
        text: "Oi, de novo",
        media: [],
        context: [],
        contactEvents: [],
        limits: { maxMessages: 3, maxChars: 300 },
        voiceReply: false,
        reopened: true,
      },
      { createModel: (key) => set[key.model as keyof Models] },
    );
    expect(out.messages).toEqual(["Bem-vinda de volta!"]);
    expect(out.answeredBy).toBeNull();
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(1);
  });

  it("returns who answered to the hubs, with the specialist's text only", async () => {
    const set = models({
      "gpt-orc": [delegate("seller", "Resumo do cliente")],
      "gpt-sel": [plan("Olá!", "Veja os pacotes.")],
    });
    const conv = await conversation();
    const out = await answerTurn(
      session(randomUUID(), contextA),
      contextA,
      {
        agentId: ORC,
        link: { channel: "matrix", matrixRoomId: conv.matrixRoomId! },
        text: "Quero ver os pacotes",
        media: [],
        context: [],
        contactEvents: [],
        limits: { maxMessages: 3, maxChars: 300 },
        voiceReply: false,
      },
      { createModel: (key) => set[key.model as keyof Models] },
    );
    expect(out.messages).toEqual(["Olá!", "Veja os pacotes."]);
    expect(out.answeredBy).toBe("seller");
    expect(out.handoff).toBeNull();
  });

  it("does not offer a specialist that is off, and none when all are off", async () => {
    await setStatus(SEL, "paused");
    const set = models({
      "gpt-orc": [plan("Posso ajudar com o simples.")],
    });
    const conv = await conversation();
    await turn(conv.id, "Quero comprar", set);
    expect(toolNames(set["gpt-orc"])).toContain("delegate");
    // The tool lists only who is on.
    const description = JSON.stringify(set["gpt-orc"].doGenerateCalls[0]?.tools);
    expect(description).toContain("Available now: attendant.");

    await setStatus(ATT, "paused");
    const none = models({ "gpt-orc": [plan("Passo para a equipe.")] });
    const other = await conversation();
    const out = await turn(other.id, "Quero comprar", none);
    // With nobody on, the orchestrator goes on as before.
    expect(toolNames(none["gpt-orc"])).not.toContain("delegate");
    expect(out.result).toMatchObject({ status: "active", messages: 1 });
    expect(none["gpt-att"].doGenerateCalls).toHaveLength(0);
    expect(none["gpt-sel"].doGenerateCalls).toHaveLength(0);
  });

  it("never offers a specialist of another workspace", async () => {
    await setStatus(SEL, "paused");
    await setStatus(ATT, "paused");
    // The seller of workspace B is on, and still not offered in A.
    await admin.aiAgent.update({
      where: { id: SEL_B },
      data: { status: "active" },
    });
    const set = models({ "gpt-orc": [plan("Oi")] });
    const conv = await conversation();
    await turn(conv.id, "Quero comprar", set);
    expect(toolNames(set["gpt-orc"])).not.toContain("delegate");
    // The database refuses to name it as the holder of A's conversation.
    await expect(
      admin.$executeRawUnsafe(
        `update public.ai_conversations set delegated_agent_id = '${SEL_B}', delegated_until = now() + interval '1 hour' where id = '${conv.id}'`,
      ),
    ).rejects.toThrow();
    // And a person of B does not see A's conversation.
    const seen = await withContext(prisma, contextB, (tx) =>
      tx.aiConversation.findMany({ where: { id: conv.id } }),
    );
    expect(seen).toEqual([]);
  });

  it("gives the attendant and the seller no way to delegate", async () => {
    // Chosen directly for the room: the seller has `delegate` in its list
    // and still is not offered it, nor the way back.
    const set = models({
      "gpt-sel": [
        toolStep([
          {
            name: "delegate",
            input: { version: 1, to: "attendant", reason: "x", summary: "y" },
          },
        ]),
        plan("Sigo eu mesmo."),
      ],
    });
    const conv = await conversation(SEL);
    const out = await turn(conv.id, "Quero comprar", set);
    expect(out.result).toMatchObject({ status: "active", messages: 1 });
    expect(toolNames(set["gpt-sel"])).not.toContain("delegate");
    expect(toolNames(set["gpt-sel"])).not.toContain("return_to_reception");
    expect(set["gpt-att"].doGenerateCalls).toHaveLength(0);
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedAgentId).toBeNull();
  });

  it("refuses a second hand-over in the same turn", async () => {
    const set = models({
      "gpt-orc": [
        toolStep([
          {
            name: "delegate",
            input: { version: 1, to: "seller", reason: "a", summary: "b" },
          },
          {
            name: "delegate",
            input: { version: 1, to: "attendant", reason: "c", summary: "d" },
          },
        ]),
      ],
      "gpt-sel": [plan("Sou o vendedor.")],
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero comprar e agendar", set);
    expect(out.result).toMatchObject({ status: "active", delegated: 1 });
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(1);
    expect(set["gpt-att"].doGenerateCalls).toHaveLength(0);
    const tools = (await rows(conv.id)).filter((m) => m.role === "tool");
    expect(tools).toHaveLength(2);
    expect(JSON.parse(tools[0]!.content)).toMatchObject({ ok: true });
    expect(JSON.parse(tools[1]!.content)).toMatchObject({ ok: false });
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.delegatedAgentId).toBe(SEL);
  });

  it("hands over to the team after two invalid delegations", async () => {
    const bad = (version: number) =>
      toolStep([
        {
          name: "delegate",
          input: { version, to: "seller", reason: "x", summary: "y" },
        },
      ]);
    const set = models({
      "gpt-orc": [bad(2), bad(3), plan("Vou chamar alguém da equipe.")],
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero comprar", set);
    expect(out.state?.status).toBe("handoff");
    expect(out.state?.handoff?.reason).toBeTruthy();
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(0);
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after).toMatchObject({ status: "handoff", delegatedAgentId: null });
  });

  it("tries the specialist's invalid output once more, then hands over to the team", async () => {
    const set = models({
      "gpt-orc": [delegate("seller", "Maria quer comprar")],
      "gpt-sel": [textStep("isto não é JSON"), textStep("{ainda não}")],
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero comprar", set);
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(2);
    expect(out.result).toMatchObject({
      status: "handoff",
      reason: "invalid_output",
      messages: 0,
    });
    expect(out.state?.status).toBe("handoff");
    expect(out.state?.handoff?.reason).toContain("vendedor");
    expect(out.state?.handoff?.summary).toContain("Maria quer comprar");
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after).toMatchObject({ status: "handoff", delegatedAgentId: null });
    const errorRow = (await rows(conv.id)).at(-1);
    expect(errorRow).toMatchObject({
      errorCode: "invalid_output",
      authorAgentId: SEL,
      viaDelegation: true,
    });
    const audit = await admin.auditEvent.findMany({
      where: { action: "ai_agents.guid.delegate", resourceId: conv.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.result)).toEqual(["success", "error"]);
    expect(audit[1]?.metadata).toMatchObject({ reason: "invalid_output" });
  });

  it("accepts the specialist's answer on the second try", async () => {
    const set = models({
      "gpt-orc": [delegate("seller")],
      "gpt-sel": [textStep("não é JSON"), plan("Aqui estão os pacotes.")],
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero comprar", set);
    expect(set["gpt-sel"].doGenerateCalls).toHaveLength(2);
    expect(out.result).toMatchObject({ status: "active", messages: 1 });
    expect((await rows(conv.id)).at(-1)).toMatchObject({
      content: "Aqui estão os pacotes.",
      authorAgentId: SEL,
    });
  });

  it("hands over to the team when the specialist runs out of time", async () => {
    const set = models({ "gpt-orc": [delegate("attendant")] });
    set["gpt-att"] = new MockLanguageModelV4({
      doGenerate: async () => {
        throw Object.assign(new Error("The operation timed out"), {
          name: "TimeoutError",
        });
      },
    });
    const conv = await conversation();
    const out = await turn(conv.id, "Quero agendar", set);
    expect(out.result).toMatchObject({ status: "handoff", reason: "timeout" });
    expect(out.state?.handoff?.reason).toContain("atendente");
    const after = await admin.aiConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after).toMatchObject({ status: "handoff", delegatedAgentId: null });
  });

  it("runs the delegation in a test of the orchestrator, with the tools simulated", async () => {
    const set = models({
      "gpt-orc": [delegate("seller")],
      "gpt-sel": [plan("Resposta de teste do vendedor.")],
    });
    const conv = await admin.aiConversation.create({
      data: {
        kind: "guid",
        agentId: ORC,
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        userId: ids.userA,
        channel: "test",
      },
    });
    const out = await turn(conv.id, "Quero comprar", set);
    // The test of the orchestrator does not record a test of the seller.
    expect(out.result).toMatchObject({ delegated: 1, tested: 1 });
    const seller = await admin.aiAgent.findUniqueOrThrow({ where: { id: SEL } });
    expect(seller.testedAt).toBeNull();
    const tools = (await rows(conv.id)).filter((m) => m.toolName === "delegate");
    expect(JSON.parse(tools[0]!.content)).toMatchObject({
      result: { delegated: true, simulated: true },
    });
  });

  it("keeps the new columns inside the workspace", async () => {
    const conv = await conversation();
    // The author of a message must be a GUIDS of the conversation's workspace.
    await expect(
      admin.$executeRawUnsafe(
        `insert into public.ai_messages (conversation_id, role, content, author_agent_id)
         values ('${conv.id}', 'assistant', 'x', '${SEL_B}')`,
      ),
    ).rejects.toThrow();
    await admin.$executeRawUnsafe(
      `insert into public.ai_messages (conversation_id, role, content, author_agent_id, via_delegation)
       values ('${conv.id}', 'assistant', 'ok', '${SEL}', true)`,
    );
    expect(await rows(conv.id)).toHaveLength(1);
  });
});
