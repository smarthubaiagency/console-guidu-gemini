import { PrismaClient } from "@prisma/client";
import type { TranscriptionModel } from "ai";
import { MockLanguageModelV4, MockTranscriptionModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createChatwootConnection,
  listChannelConnections,
  updateServiceSettings,
} from "@/core/channels/connections";
import { runChannelDispatch } from "@/core/channels/dispatch";
import { describeInboxOwners } from "@/core/channels/registry";
import { receiveChannelWebhook } from "@/core/channels/webhook";
import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { createAiAgentsChannelConsumer } from "@/modules/ai-agents/server/channel-consumer";
import {
  bindGuidInbox,
  listGuidChannels,
  unbindGuidInbox,
} from "@/modules/ai-agents/server/services/channels";
import { AppError } from "@/shared/errors";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A5b: a GUIDS answering a Chatwoot inbox. The agent takes an inbox (route
 * and bot on the inbox), the contact's messages are grouped into one
 * dispatch run as the person who turned the route on, the turn runs with a
 * mock model and the real tools, and the core sends the answer within the
 * integration's settings and hands the conversation to the team. Chatwoot
 * is a fake on a public test address.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const GUID = "a5b00000-0000-4000-8000-0000000000a1";
const BASE_URL = "https://203.0.113.10";
const USER_TOKEN = "chatwoot-user-token-123";
const APP_URL = "https://guidu.test";
const LABEL = "Chave A5b";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function planStep(messages: string[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ messages }) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function handoffStep() {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: "call-handoff",
        toolName: "handoff",
        input: JSON.stringify({
          reason: "Pediu uma pessoa.",
          summary: "Maria quer um orçamento de 10 unidades.",
        }),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

type Step = ReturnType<typeof planStep> | ReturnType<typeof handoffStep>;

type Call = Readonly<{
  method: string;
  path: string;
  token: string | null;
  body: unknown;
}>;

/** Chatwoot account 1 with inbox 3: bots, inboxes, messages, statuses. */
function fakeChatwoot() {
  const calls: Call[] = [];
  const bots = new Map<number, string>();
  const botTokens = new Set<string>();
  let nextBot = 7;
  let nextMessage = 900;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const token =
      (init?.headers as Record<string, string> | undefined)?.api_access_token ??
      null;
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    calls.push({ method, path: url.pathname, token, body });
    const rest = url.pathname.replace("/api/v1/accounts/1", "");
    if (
      /^\/conversations\/\d+\/(messages|toggle_status|toggle_typing_status)$/.test(
        rest,
      )
    ) {
      if (!token || !botTokens.has(token)) {
        return new Response("", { status: 401 });
      }
      return Response.json({ id: nextMessage++ });
    }
    // Files of the contact (A5c): signed links, then the storage.
    if (url.pathname === "/rails/active_storage/blobs/photo.png") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://198.51.100.7/bucket/photo.png" },
      });
    }
    if (url.hostname === "198.51.100.7") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      });
    }
    if (url.pathname === "/rails/active_storage/blobs/voice.ogg") {
      return new Response("OggS", { headers: { "content-type": "audio/ogg" } });
    }
    if (token !== USER_TOKEN) return new Response("", { status: 401 });
    if (rest === "/agent_bots" && method === "POST") {
      const id = nextBot++;
      bots.set(id, (body as { outgoing_url: string }).outgoing_url);
      botTokens.add(`bot-token-${id}-abcdef`);
      return Response.json({ id, access_token: `bot-token-${id}-abcdef` });
    }
    if (rest === "/inboxes") {
      return Response.json({
        payload: [{ id: 3, name: "WhatsApp", channel_type: "Channel::Api" }],
      });
    }
    if (/^\/inboxes\/\d+\/set_agent_bot$/.test(rest)) {
      return new Response(null, { status: 204 });
    }
    const bot = /^\/agent_bots\/(\d+)$/.exec(rest);
    if (bot && bots.has(Number(bot[1]))) {
      return Response.json({ id: Number(bot[1]) });
    }
    return new Response("", { status: 404 });
  });
  return { fetch, calls, bots };
}

const guidConfig = (credentialId: string) => ({
  overview: {
    agent_name: "Anna",
    language: "pt-BR",
    system_prompt: "Você é {{agent_name}}.",
  },
  integration: { tools: ["think", "handoff", "set_conversation_variable"] },
  model: { credential_id: credentialId, model_name: "gpt-test" },
});

describeDatabase("A5b: GUIDS answering in Chatwoot", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  let credentialId = "";

  /** The worker's session, from the web's client (app_runtime). */
  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where workspace_id = '${ids.workspaceA}' and kind = 'channels.dispatch'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.channel_connections where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where workspace_id = '${ids.workspaceA}'`,
    );
  }

  async function testedAgent(status: "active" | "paused" = "active") {
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status, config: guidConfig(credentialId) },
    });
    // The current configuration passed its test (A4b).
    await admin.$executeRawUnsafe(
      `update public.ai_agents set tested_config_hash = md5(config::text), tested_at = now()
       where id = '${GUID}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ids.organizationA}', '${ids.workspaceA}', 'ai-agents', 'enabled', '${ids.userA}')
       on conflict (workspace_id, module_key) do update set status = 'enabled'`,
    );
    const sealed = encryptSecret("sk-proj-0123456789abcdef0123456789");
    credentialId = (
      await admin.credential.create({
        data: {
          organizationId: ids.organizationA,
          workspaceId: ids.workspaceA,
          provider: "openai",
          purpose: "all",
          label: LABEL,
          maskedValue: sealed.maskedValue,
          encryptedPayload: sealed.encryptedPayload,
        },
      })
    ).id;
    await admin.aiAgent.create({
      data: {
        id: GUID,
        kind: "guid",
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        status: "draft",
        config: guidConfig(credentialId),
        configVersion: 1,
        createdBy: ids.userA,
      },
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key = 'ai-agents'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  async function connectAndBind() {
    const fake = fakeChatwoot();
    const connection = await createChatwootConnection(
      prisma,
      contextA,
      {
        name: "Atendimento",
        baseUrl: BASE_URL,
        accountId: "1",
        accessToken: USER_TOKEN,
      },
      { fetch: fake.fetch, appUrl: APP_URL },
    );
    const [, outgoingUrl] = [...fake.bots.entries()][0]!;
    const token = new URL(outgoingUrl).pathname.split("/")[4]!;
    await testedAgent();
    const route = await bindGuidInbox(
      prisma,
      contextA,
      { agentId: GUID, connectionId: connection.id, inboxId: "3" },
      { fetch: fake.fetch },
    );
    return { fake, connectionId: connection.id, token, routeId: route.id };
  }

  function webhook(connectionId: string, token: string, body: unknown) {
    return receiveChannelWebhook(
      prisma,
      new Request(`${APP_URL}/api/channels/${connectionId}/${token}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      connectionId,
      token,
    );
  }

  const contact = {
    id: 9,
    name: "Maria",
    type: "contact",
    phone_number: "+5511999990000",
  };

  function message(id: number, content: string, status = "pending") {
    return {
      event: "message_created",
      id,
      content,
      message_type: "incoming",
      private: false,
      sender: contact,
      conversation: {
        id: 55,
        inbox_id: 3,
        status,
        contact_inbox: { contact_id: 9 },
      },
      inbox: { id: 3 },
    };
  }

  function statusChanged(status: string, at: number) {
    return {
      event: "conversation_status_changed",
      id: 55,
      status,
      inbox_id: 3,
      updated_at: at,
    };
  }

  async function pendingRuns() {
    return admin.jobRun.findMany({
      where: { workspaceId: ids.workspaceA, kind: "channels.dispatch" },
      orderBy: { createdAt: "asc" },
    });
  }

  function consumer(steps: Step[]) {
    const model = new MockLanguageModelV4({ doGenerate: steps });
    const transcriber = new MockTranscriptionModelV4({
      doGenerate: async () => ({
        text: "Quero agendar para sexta",
        segments: [],
        language: "pt",
        durationInSeconds: 2,
        warnings: [],
        response: { timestamp: new Date(), modelId: "mock" },
      }),
    });
    return {
      model,
      consumer: createAiAgentsChannelConsumer({
        createModel: () => model,
        createTranscription: () => transcriber as unknown as TranscriptionModel,
      }),
    };
  }

  async function dispatch(
    run: { id: string; payload: unknown },
    steps: Step[],
    fake: ReturnType<typeof fakeChatwoot>,
    sleep = vi.fn(async () => undefined),
  ) {
    const built = consumer(steps);
    const result = await runChannelDispatch(
      session(run.id, contextA),
      contextA,
      run.payload as { conversationId: string },
      { consumers: [built.consumer], fetch: fake.fetch, sleep },
    );
    return { result, sleep, model: built.model };
  }

  /** Public messages sent to the contact, and the team's private notes. */
  function sentTo(fake: ReturnType<typeof fakeChatwoot>, team = false) {
    return fake.calls
      .filter(
        (c) =>
          c.path.endsWith("/messages") &&
          (c.body as { private: boolean }).private === team,
      )
      .map((c) => (c.body as { content: string }).content);
  }

  it("only a GUIDS turned on and tested takes an inbox, one agent per inbox", async () => {
    const fake = fakeChatwoot();
    const connection = await createChatwootConnection(
      prisma,
      contextA,
      {
        name: "Atendimento",
        baseUrl: BASE_URL,
        accountId: "1",
        accessToken: USER_TOKEN,
      },
      { fetch: fake.fetch, appUrl: APP_URL },
    );
    const input = { agentId: GUID, connectionId: connection.id, inboxId: "3" };
    await testedAgent("paused");
    await expect(
      bindGuidInbox(prisma, contextA, input, { fetch: fake.fetch }),
    ).rejects.toMatchObject({ code: "conflict" });

    await testedAgent();
    const route = await bindGuidInbox(prisma, contextA, input, {
      fetch: fake.fetch,
    });
    expect(
      fake.calls.find((c) => c.path.endsWith("/inboxes/3/set_agent_bot")),
    ).toMatchObject({ method: "POST", body: { agent_bot: 7 } });
    await expect(
      bindGuidInbox(prisma, contextA, input, { fetch: fake.fetch }),
    ).rejects.toMatchObject({ messageKey: "channels.errors.inboxTaken" });

    const listed = await withContext(prisma, contextA, (tx) =>
      listGuidChannels(tx, contextA, GUID),
    );
    expect(listed).toMatchObject({
      canManage: true,
      inboxes: [{ inboxId: "3", state: "mine", routeId: route.id }],
    });

    await unbindGuidInbox(
      prisma,
      contextA,
      { agentId: GUID, routeId: route.id },
      { fetch: fake.fetch },
    );
    expect(fake.calls.at(-1)).toMatchObject({ body: { agent_bot: null } });
    const closed = await admin.channelRoute.findUniqueOrThrow({
      where: { id: route.id },
    });
    expect(closed).toMatchObject({ status: "closed", updatedBy: ids.userA });
    await expect(
      unbindGuidInbox(prisma, contextA, { agentId: GUID, routeId: route.id }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("groups the contact's messages, answers within the settings and hands over", async () => {
    const { fake, connectionId, token } = await connectAndBind();

    await webhook(connectionId, token, message(1, "Olá"));
    const [first] = await pendingRuns();
    await webhook(connectionId, token, message(2, "Quero o preço"));
    const runs = await pendingRuns();
    // One run per conversation, started later by the second message.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "pending",
      requestedBy: ids.userA,
      maxAttempts: 1,
    });
    expect(runs[0]!.runAfter.getTime()).toBeGreaterThanOrEqual(
      first!.runAfter.getTime(),
    );
    // Never more than 30 seconds after the first message.
    expect(
      runs[0]!.runAfter.getTime() - runs[0]!.createdAt.getTime(),
    ).toBeLessThanOrEqual(30_000);

    const { result, sleep } = await dispatch(
      runs[0]!,
      [
        handoffStep(),
        planStep(["Oi, Maria!", "O preço é R$ 10.", "Algo mais?", "Até já."]),
      ],
      fake,
    );
    expect(result).toMatchObject({
      status: "answered",
      events: 2,
      parts: 3,
      sent: 3,
      handoff: 1,
    });
    // 1.5 s between the parts, none before the first.
    expect(sleep.mock.calls).toEqual([[1500], [1500]]);

    const sent = fake.calls.filter((c) => c.path.endsWith("/messages"));
    expect(sentTo(fake)).toEqual([
      "Oi, Maria!",
      "O preço é R$ 10.",
      "Algo mais?\n\nAté já.",
    ]);
    expect(sent.every((c) => c.token === "bot-token-7-abcdef")).toBe(true);
    expect(sent[0]!.path).toBe("/api/v1/accounts/1/conversations/55/messages");
    // "Typing…" while the agent prepares the answer (A5c).
    expect(
      fake.calls.find((c) => c.path.endsWith("/toggle_typing_status")),
    ).toMatchObject({ body: { typing_status: "on" } });
    // The team reads the agent's summary, privately, before the handoff.
    expect(sentTo(fake, true)).toEqual([
      "Resumo de Anna para a equipe\n\nMaria quer um orçamento de 10 unidades.\n\nMotivo da transferência: Pediu uma pessoa.",
    ]);
    expect(fake.calls.at(-2)).toMatchObject({ body: { private: true } });
    expect(fake.calls.at(-1)).toMatchObject({
      path: "/api/v1/accounts/1/conversations/55/toggle_status",
      body: { status: "open" },
    });

    const conversation = await admin.aiConversation.findFirstOrThrow({
      where: { agentId: GUID, channel: "chatwoot" },
    });
    expect(conversation).toMatchObject({ status: "handoff", userId: null });
    const user = await admin.aiMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "user" },
    });
    expect(user.content).toBe("Olá\nQuero o preço");
    const deliveries = await admin.channelDelivery.findMany({
      where: { executionId: runs[0]!.id },
      orderBy: { part: "asc" },
    });
    expect(deliveries.map((d) => [d.part, d.status])).toEqual([
      [0, "sent"],
      [1, "sent"],
      [2, "sent"],
    ]);
    const events = await admin.channelInboundEvent.findMany({
      where: { connectionId },
    });
    expect(events.every((e) => e.status === "dispatched")).toBe(true);

    // The same run again sends nothing twice.
    const again = await dispatch(runs[0]!, [planStep(["x"])], fake);
    expect(again.result).toMatchObject({ status: "nothing_new" });
  });

  it("leaves the conversation to the team until it is pending again", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await webhook(connectionId, token, message(1, "Olá"));
    await dispatch(
      (await pendingRuns())[0]!,
      [handoffStep(), planStep(["Já chamo alguém."])],
      fake,
    );

    // The team opened it; the contact writes again.
    await webhook(connectionId, token, statusChanged("open", 1_760_000_000));
    await webhook(connectionId, token, message(2, "Alô?", "open"));
    const withTeam = (await pendingRuns()).find((r) => r.status === "pending")!;
    const ignored = await dispatch(withTeam, [planStep(["não"])], fake);
    expect(ignored.result).toMatchObject({ status: "with_team" });
    expect(
      await admin.channelInboundEvent.findFirst({
        where: { connectionId, externalId: "message:2" },
      }),
    ).toMatchObject({ status: "ignored" });

    // Back to pending: the agent answers again in the same conversation.
    await admin.jobRun.updateMany({
      where: { id: withTeam.id },
      data: { status: "succeeded" },
    });
    await webhook(connectionId, token, statusChanged("pending", 1_760_000_100));
    await webhook(connectionId, token, message(3, "Ainda aí?"));
    const back = (await pendingRuns()).find((r) => r.status === "pending")!;
    const answered = await dispatch(back, [planStep(["Sim!"])], fake);
    expect(answered.result).toMatchObject({ status: "answered", sent: 1 });
    const conversations = await admin.aiConversation.findMany({
      where: { agentId: GUID, channel: "chatwoot" },
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.status).toBe("active");
  });

  it("uses the inbox's own grouping window and skips a paused agent", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await withContext(prisma, contextA, (tx) =>
      updateServiceSettings(tx, contextA, {
        connectionId,
        scope: "3",
        settings: {
          grouping_seconds: 0,
          max_messages: 1,
          max_chars: 200,
          interval_ms: 0,
        },
      }),
    );
    const before = Date.now();
    await webhook(connectionId, token, message(1, "Olá"));
    const [run] = await pendingRuns();
    expect(run!.runAfter.getTime()).toBeLessThan(before + 2000);

    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "paused" },
    });
    await expect(
      dispatch(run!, [planStep(["x"])], fake),
    ).rejects.toBeInstanceOf(SkipJobError);
    expect(
      await admin.channelInboundEvent.findFirst({
        where: { connectionId, externalId: "message:1" },
      }),
    ).toMatchObject({ status: "failed" });
    expect(fake.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  });

  it("stops the answer at the first part Chatwoot refuses", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await webhook(connectionId, token, message(1, "Olá"));
    const [run] = await pendingRuns();
    let sends = 0;
    const failing = {
      ...fake,
      fetch: vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (String(input).endsWith("/messages") && ++sends === 2) {
          return new Response("", { status: 500 });
        }
        return fake.fetch(input, init);
      }),
    };
    const { result } = await dispatch(
      run!,
      [planStep(["Um", "Dois", "Três"])],
      failing,
    );
    expect(result).toMatchObject({ status: "delivery_failed", sent: 1 });
    const deliveries = await admin.channelDelivery.findMany({
      where: { executionId: run!.id },
      orderBy: { part: "asc" },
    });
    expect(deliveries.map((d) => [d.status, d.error])).toEqual([
      ["sent", null],
      ["failed", "http_error"],
    ]);
  });
  it("puts what the team said, and the contact meanwhile, in the history", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await webhook(connectionId, token, message(1, "Olá"));
    await dispatch(
      (await pendingRuns())[0]!,
      [handoffStep(), planStep(["Já chamo alguém."])],
      fake,
    );
    // The bot's own messages come back from Chatwoot: never context.
    await webhook(connectionId, token, {
      ...message(2, "Já chamo alguém.", "open"),
      message_type: "outgoing",
      sender: { id: 7, name: "GUIDU", type: "agent_bot" },
    });
    await webhook(connectionId, token, statusChanged("open", 1_760_000_000));
    await webhook(connectionId, token, {
      ...message(3, "Oi Maria, aqui é o João.", "open"),
      message_type: "outgoing",
      sender: { id: 2, name: "João", type: "user" },
    });
    await webhook(connectionId, token, {
      ...message(4, "Nota interna", "open"),
      message_type: "outgoing",
      private: true,
      sender: { id: 2, name: "João", type: "user" },
    });
    await webhook(connectionId, token, message(5, "Pode ser na sexta", "open"));
    const withTeam = (await pendingRuns()).find((r) => r.status === "pending")!;
    await dispatch(withTeam, [planStep(["não"])], fake);
    await admin.jobRun.updateMany({
      where: { id: withTeam.id },
      data: { status: "succeeded" },
    });

    await webhook(connectionId, token, statusChanged("pending", 1_760_000_100));
    await webhook(connectionId, token, message(6, "Confirmado?"));
    const back = (await pendingRuns()).find((r) => r.status === "pending")!;
    const { model } = await dispatch(back, [planStep(["Confirmado!"])], fake);

    const conversation = await admin.aiConversation.findFirstOrThrow({
      where: { agentId: GUID, channel: "chatwoot" },
    });
    const history = await admin.aiMessage.findMany({
      where: {
        conversationId: conversation.id,
        role: { in: ["user", "assistant"] },
        content: { not: "" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { role: true, content: true },
    });
    expect(history.map((m) => [m.role, m.content])).toEqual([
      ["user", "Olá"],
      ["assistant", "Já chamo alguém."],
      [
        "assistant",
        "[Mensagem da equipe ao contato]: Oi Maria, aqui é o João.",
      ],
      ["user", "Pode ser na sexta"],
      ["user", "Confirmado?"],
      ["assistant", "Confirmado!"],
    ]);
    // The model read them in that order.
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt.indexOf("aqui é o João")).toBeLessThan(
      prompt.indexOf("Confirmado?"),
    );
    expect(prompt).not.toContain("Nota interna");
  });

  it("reads the contact's audio and image with the customer's key", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await webhook(connectionId, token, {
      ...message(1, ""),
      attachments: [
        {
          file_type: "audio",
          extension: "ogg",
          data_url: `${BASE_URL}/rails/active_storage/blobs/voice.ogg`,
        },
        {
          file_type: "image",
          extension: "png",
          data_url: `${BASE_URL}/rails/active_storage/blobs/photo.png`,
        },
      ],
    });
    const [run] = await pendingRuns();
    const { result, model } = await dispatch(
      run!,
      [planStep(["Sexta às 10h, combinado."])],
      fake,
    );
    expect(result).toMatchObject({ status: "answered", sent: 1 });
    const conversation = await admin.aiConversation.findFirstOrThrow({
      where: { agentId: GUID, channel: "chatwoot" },
    });
    const user = await admin.aiMessage.findFirstOrThrow({
      where: {
        role: "user",
        conversationId: conversation.id,
        content: { not: "" },
      },
    });
    expect(user.content).toBe(
      "[Áudio do contato, transcrito]: Quero agendar para sexta\n[O contato enviou uma imagem, anexada a esta mensagem.]",
    );
    const last = model.doGenerateCalls[0]!.prompt.at(-1)!;
    expect(last.role).toBe("user");
    expect(
      (last.content as { type: string; mediaType?: string }[]).map((part) => [
        part.type,
        part.mediaType ?? null,
      ]),
    ).toEqual([
      ["text", null],
      ["file", "image/png"],
    ]);

    // A key that cannot hear makes the agent ask for text instead.
    await admin.jobRun.updateMany({
      where: { id: run!.id },
      data: { status: "succeeded" },
    });
    await admin.credential.update({
      where: { id: credentialId },
      data: { provider: "anthropic" },
    });
    try {
      await webhook(connectionId, token, {
        ...message(2, ""),
        attachments: [
          {
            file_type: "audio",
            extension: "ogg",
            data_url: `${BASE_URL}/rails/active_storage/blobs/voice.ogg`,
          },
        ],
      });
      const next = (await pendingRuns()).find((r) => r.status === "pending")!;
      const asked = await dispatch(next, [planStep(["Pode escrever?"])], fake);
      expect(JSON.stringify(asked.model.doGenerateCalls[0]!.prompt)).toContain(
        "este agente não ouve áudios",
      );
      const listed = await withContext(prisma, contextA, (tx) =>
        listGuidChannels(tx, contextA, GUID),
      );
      expect(listed?.missingMedia).toEqual(["audio"]);
    } finally {
      await admin.credential.update({
        where: { id: credentialId },
        data: { provider: "openai" },
      });
    }
  });

  it("shows the connection's service and who answers each inbox", async () => {
    const { fake, connectionId, token } = await connectAndBind();
    await webhook(connectionId, token, message(1, "Olá"));
    await dispatch((await pendingRuns())[0]!, [planStep(["Oi!"])], fake);
    await admin.aiAgent.update({
      where: { id: GUID },
      data: { status: "paused" },
    });
    const [connections, owners] = await withContext(prisma, contextA, (tx) =>
      Promise.all([
        listChannelConnections(tx, contextA),
        describeInboxOwners(tx, contextA),
      ]),
    );
    expect(
      connections.find((c) => c.id === connectionId)?.activity,
    ).toMatchObject({ sent: 1, failedDeliveries: 0, failedEvents: 0 });
    expect(owners[`${connectionId}:3`]).toEqual({
      module: "ai-agents",
      name: "Anna",
      active: false,
    });
  });
});
