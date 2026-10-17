import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

import { PrismaClient } from "@prisma/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import { handleAppServiceRequest } from "@/core/matrix/appservice";
import { matrixConfig, type MatrixConfig } from "@/core/matrix/config";
import { changeConversation } from "@/core/matrix/conversation";
import { matrixProcessEventsJob, matrixSyncAgentJob } from "@/core/matrix/jobs";
import { createConversationRoom } from "@/core/matrix/rooms";
import {
  createSynapseClient,
  deleteRoom,
  setConversationState,
  type SynapseClient,
} from "@/core/matrix/synapse";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { runTurn } from "@/modules/ai-agents/server/hub-turn";
import { inboxAgentActive } from "@/modules/inbox/server/guids-settings";
import { runGuidsTurn } from "@/modules/inbox/server/guids-turn";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * IN6 against a real Synapse (scripts/local/synapse.sh): the Inbox GUIDS
 * gets its user in the rooms, the consumer writes in a pending room and
 * the core enqueues the turn, the GUIDS answers in the room as its user
 * (mock model, real tools), hands off (open, without an assignee, summary
 * only in the database), goes back to the bot from the panel, and a
 * resolved conversation reopens as pending when the consumer writes. The
 * public `runTurn` is also run alone. The Matrix variables come from the
 * file of the local Synapse.
 */

const envFile = process.env.MATRIX_TEST_ENV_FILE;
const asPort = Number(process.env.MATRIX_TEST_AS_PORT ?? "0");
if (envFile) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^(MATRIX_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) process.env[match[1]] = match[2];
  }
}

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
  MATRIX_TEST_ENV_FILE: envFile,
  MATRIX_TEST_AS_PORT: asPort > 0 ? String(asPort) : undefined,
};

const GUID = "1e600000-0000-4000-8000-0000000000a1";
const LABEL = "Chave IN6";
const enc = encodeURIComponent;

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

const guidConfig = (credentialId: string) => ({
  overview: {
    agent_name: "Lia",
    language: "pt-BR",
    system_prompt: "Você é {{agent_name}}.",
  },
  integration: { tools: ["think", "handoff"] },
  model: { credential_id: credentialId, model_name: "gpt-test" },
});

async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 45_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out: ${label}${last ? ` (${String(last)})` : ""}`);
}

describeDatabase("IN6: the GUIDS in the room", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  let config: MatrixConfig;
  let client: SynapseClient;
  let server: Server;
  let credentialId = "";

  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction(fn, { timeout: 120_000, maxWait: 30_000 });

  /** The worker's session, from the web's client (app_runtime). */
  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  async function cleanup() {
    // Rooms of this suite go on Synapse too (no orphans for the IN3 sweep).
    const rooms = await admin.matrixRoom.findMany({
      where: { roomId: { not: null } },
      select: { roomId: true },
    });
    for (const room of rooms) await deleteRoom(client, room.roomId!);
    await admin.$executeRawUnsafe(`delete from public.inbox_guids_rooms`);
    await admin.$executeRawUnsafe(`delete from public.matrix_agent_users`);
    await admin.$executeRawUnsafe(`delete from public.matrix_rooms`);
    await admin.$executeRawUnsafe(`delete from public.matrix_accounts`);
    await admin.$executeRawUnsafe(`delete from public.matrix_events`);
    await admin.$executeRawUnsafe(`delete from public.matrix_as_transactions`);
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind like 'matrix.%' or kind = 'inbox.guids-turn'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where workspace_id = '${ids.workspaceA}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    const loaded = matrixConfig();
    if (!loaded) throw new Error("Matrix variables are incomplete");
    config = loaded;
    client = createSynapseClient(config);
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
    );
    for (const key of ["ai-agents", "inbox"]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${ids.organizationA}', '${ids.workspaceA}', '${key}', 'enabled', '${ids.userA}')
         on conflict (workspace_id, module_key) do update set status = 'enabled', updated_by = '${ids.userA}'`,
      );
    }
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
        status: "active",
        config: guidConfig(credentialId),
        configVersion: 1,
        createdBy: ids.userA,
      },
    });
    await admin.$executeRawUnsafe(
      `update public.ai_agents set tested_config_hash = md5(config::text), tested_at = now() where id = '${GUID}'`,
    );
    // The Inbox GUIDS, chosen by the owner (who the turn runs as).
    await admin.$executeRawUnsafe(
      `update public.workspace_modules
       set config = '{"guids_agent_id": "${GUID}", "service": {"grouping_seconds": 0, "max_messages": 2, "interval_ms": 0}}'::jsonb
       where workspace_id = '${ids.workspaceA}' and module_key = 'inbox'`,
    );

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void (async () => {
          const url = `http://127.0.0.1:${asPort}${req.url ?? "/"}`;
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers.set(key, value);
          }
          const method = req.method ?? "GET";
          const request = new Request(url, {
            method,
            headers,
            body:
              method === "GET" || method === "HEAD"
                ? null
                : Buffer.concat(chunks),
          });
          const segments = new URL(url).pathname
            .replace(/^\/api\/matrix\/as\/?/, "")
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent);
          const response = await handleAppServiceRequest(request, segments, {
            prisma,
          });
          res.writeHead(response.status, {
            "content-type": "application/json",
          });
          res.end(Buffer.from(await response.arrayBuffer()));
        })();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(asPort, "127.0.0.1", resolve),
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.inbox_attendants where workspace_id = '${ids.workspaceA}' and user_id = '${ids.userA}'`,
    );
    await admin.$executeRawUnsafe(
      `update public.workspace_modules set config = '{}'::jsonb where workspace_id = '${ids.workspaceA}' and module_key = 'inbox'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key in ('ai-agents', 'inbox')`,
    );
    await Promise.all([
      prisma.$disconnect(),
      admin.$disconnect(),
      workerDb.$disconnect(),
    ]);
  });

  /** A consumer account (the guidu.chat role) and its access token. */
  async function consumer(): Promise<{ mxid: string; token: string }> {
    const mxid = `@cliente_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}:${config.serverName}`;
    await client.request("PUT", `/_synapse/admin/v2/users/${enc(mxid)}`, {
      body: { displayname: "Maria" },
    });
    const { access_token } = await client.request<{ access_token: string }>(
      "POST",
      `/_synapse/admin/v1/users/${enc(mxid)}/login`,
      { body: {} },
    );
    return { mxid, token: access_token };
  }

  let txn = 0;
  async function say(token: string, roomId: string, body: string) {
    txn += 1;
    const response = await fetch(
      `${config.homeserverUrl}/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/in6-${Date.now()}-${txn}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ msgtype: "m.text", body }),
      },
    );
    expect(response.status).toBe(200);
    lastSent = ((await response.json()) as { event_id: string }).event_id;
  }
  let lastSent = "";

  /** Processes until the last message is in and a turn is pending. */
  async function pendingTurn(roomId: string) {
    return eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      const seen = await admin.matrixEvent.findUnique({
        where: { eventId: lastSent },
        select: { status: true },
      });
      if (seen?.status !== "processed") return null;
      return admin.jobRun.findFirst({
        where: {
          kind: "inbox.guids-turn",
          status: "pending",
          payload: { path: ["roomId"], equals: roomId },
        },
      });
    }, "turn enqueued");
  }

  async function runPending(roomId: string, steps: Step[]) {
    const run = await pendingTurn(roomId);
    expect(run.requestedBy).toBe(ids.userA);
    expect(run.scope).toBe("workspace");
    // The run leaves the queue as the worker would mark it.
    await admin.jobRun.update({
      where: { id: run.id },
      data: { status: "succeeded" },
    });
    const model = new MockLanguageModelV4({ doGenerate: steps });
    return runGuidsTurn(
      session(run.id, contextA),
      contextA,
      { roomId },
      { client, turnDeps: { createModel: () => model }, sleep: async () => 0 },
    );
  }

  async function messagesOf(roomId: string) {
    const page = await client.request<{
      chunk: { sender: string; content: { body?: string } }[];
    }>("GET", `/_matrix/client/v3/rooms/${enc(roomId)}/messages`, {
      query: {
        dir: "b",
        limit: "50",
        filter: JSON.stringify({ types: ["m.room.message"] }),
      },
    });
    return page.chunk
      .reverse()
      .map((e) => ({ sender: e.sender, body: e.content.body ?? "" }));
  }

  async function mirror(roomId: string) {
    return admin.matrixRoom.findUniqueOrThrow({
      where: { roomId },
      select: { status: true, assignee: true },
    });
  }

  it("the GUIDS answers in the room, hands off, comes back and reopens", async () => {
    // Its user is registered with the agent's name and joins new rooms.
    await asWorker((tx) =>
      matrixSyncAgentJob.run(tx, { workspaceId: ids.workspaceA }),
    );
    const agent = await admin.matrixAgentUser.findUniqueOrThrow({
      where: { agentId: GUID },
    });
    expect(agent.mxid).toMatch(/^@_guidu_a_[a-z2-7]{16}:/);
    expect(agent.displayName).toBe("Lia");
    expect(await asWorker((tx) => inboxAgentActive(tx, ids.workspaceA))).toBe(
      true,
    );

    // IN4b notices: who answers hears of the conversation only at the
    // handoff while the GUIDS is active.
    await admin.$executeRawUnsafe(
      `insert into public.inbox_attendants (workspace_id, organization_id, user_id)
       values ('${ids.workspaceA}', '${ids.organizationA}', '${ids.userA}') on conflict do nothing`,
    );
    const noticed = async (roomId: string) =>
      (
        await admin.$queryRawUnsafe<{ type: string; recipient: string }[]>(
          `select type, recipient_user_id::text as recipient from public.events
           where type like 'inbox.conversation.%' and subject_id = $1
           order by created_at`,
          roomId,
        )
      ).map((row) => `${row.type}:${row.recipient}`);

    const maria = await consumer();
    const room = await asWorker((tx) =>
      createConversationRoom(tx, client, {
        workspaceId: ids.workspaceA,
        consumerMxid: maria.mxid,
        consumerName: "Maria",
      }),
    );
    const { members } = await client.request<{ members: string[] }>(
      "GET",
      `/_synapse/admin/v1/rooms/${enc(room.roomId)}/members`,
    );
    expect(members).toContain(agent.mxid);
    expect(await noticed(room.roomId)).toEqual([]);
    const powers = await client.request<{ users: Record<string, number> }>(
      "GET",
      `/_matrix/client/v3/rooms/${enc(room.roomId)}/state/m.room.power_levels/`,
    );
    expect(powers.users[agent.mxid]).toBe(10);
    await fetch(
      `${config.homeserverUrl}/_matrix/client/v3/join/${enc(room.roomId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${maria.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    // 1. The consumer writes; the GUIDS answers as Lia.
    await say(maria.token, room.roomId, "Oi");
    await say(maria.token, room.roomId, "Vocês abrem sábado?");
    const first = await runPending(room.roomId, [
      planStep(["Olá, Maria!", "Abrimos sim.", "Das 9h às 13h."]),
    ]);
    expect(first).toMatchObject({ status: "answered", messages: 2, sent: 2 });
    const said = await messagesOf(room.roomId);
    expect(
      said.filter((m) => m.sender === agent.mxid).map((m) => m.body),
    ).toEqual(["Olá, Maria!", "Abrimos sim.\n\nDas 9h às 13h."]);
    const conversation = await admin.aiConversation.findFirstOrThrow({
      where: { agentId: GUID, matrixRoomId: room.roomId },
    });
    expect(conversation).toMatchObject({ channel: "matrix", status: "active" });

    // 2. A handoff: open without an assignee, the summary only for the team.
    await say(maria.token, room.roomId, "Quero falar com uma pessoa");
    const second = await runPending(room.roomId, [
      handoffStep(),
      planStep(["Vou chamar alguém da equipe."]),
    ]);
    expect(second).toMatchObject({ status: "answered", handoff: 1 });
    await eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      const now = await mirror(room.roomId);
      return now.status === "open" && now.assignee === null;
    }, "handoff mirrored");
    expect(await noticed(room.roomId)).toEqual([
      `inbox.conversation.new:${ids.userA}`,
    ]);
    const kept = await admin.inboxGuidsRoom.findUniqueOrThrow({
      where: { roomId: room.roomId },
    });
    expect(kept.handoffSummary).toBe("Maria quer um orçamento de 10 unidades.");
    expect(kept.handoffReason).toBe("Pediu uma pessoa.");
    expect(
      (await messagesOf(room.roomId)).some((m) =>
        m.body.includes("orçamento de 10 unidades"),
      ),
    ).toBe(false);

    // While the team has it, the consumer's messages start no turn.
    await say(maria.token, room.roomId, "Alô?");
    await eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      const seen = await admin.matrixEvent.findUnique({
        where: { eventId: lastSent },
        select: { status: true },
      });
      return seen?.status === "processed";
    }, "processed");
    expect(
      await admin.jobRun.count({
        where: { kind: "inbox.guids-turn", status: "pending" },
      }),
    ).toBe(0);

    // 3. Back to the bot from the panel: pending, no assignee.
    const returned = await withContext(prisma, contextA, (tx) =>
      changeConversation(tx, client, {
        roomId: room.roomId,
        action: { kind: "return" },
        actor: {
          mxid: `@u_aaaaaaaaaaaaaaaaaaaaaaaa:${config.serverName}`,
          level: "reply",
          manages: true,
        },
      }),
    );
    expect(returned).toEqual({ status: "pending", assignee: null });
    await eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      return (await mirror(room.roomId)).status === "pending";
    }, "return mirrored");
    await say(maria.token, room.roomId, "Ainda estão aí?");
    const third = await runPending(room.roomId, [planStep(["Estamos sim!"])]);
    // The message said while the team had it is context, not a new one.
    expect(third).toMatchObject({ status: "answered", messages: 1 });
    expect(
      await admin.aiConversation.findFirstOrThrow({
        where: { id: conversation.id },
        select: { status: true },
      }),
    ).toEqual({ status: "active" });

    // 4. Resolved, the consumer writes again: pending, with the GUIDS.
    await setConversationState(client, room.roomId, {
      status: "resolved",
      assignee: null,
    });
    await eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      return (await mirror(room.roomId)).status === "resolved";
    }, "resolved mirrored");
    await say(maria.token, room.roomId, "Esqueci de perguntar uma coisa");
    const fourth = await runPending(room.roomId, [
      planStep(["Pode perguntar!"]),
    ]);
    expect(fourth).toMatchObject({ status: "answered", messages: 1 });
    expect((await mirror(room.roomId)).status).toBe("pending");
  });

  it("runTurn answers one turn without sending anything", async () => {
    const maria = await consumer();
    const room = await asWorker((tx) =>
      createConversationRoom(tx, client, {
        workspaceId: ids.workspaceA,
        consumerMxid: maria.mxid,
      }),
    );
    const model = new MockLanguageModelV4({
      doGenerate: [planStep(["Olá!", "Como posso ajudar?"])],
    });
    const run = await admin.jobRun.create({
      data: {
        kind: "inbox.guids-turn",
        scope: "workspace",
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        requestedBy: ids.userA,
        payload: { roomId: room.roomId },
        idempotencyKey: `in6-runturn-${Date.now()}`,
        status: "succeeded",
      },
    });
    const plan = await runTurn(
      session(run.id, contextA),
      contextA,
      {
        agentId: GUID,
        conversation: { hub: "inbox", roomId: room.roomId },
        messages: ["Oi"],
        context: [{ side: "team", text: "Bom dia" }],
        limits: { maxMessages: 3, maxChars: 300 },
      },
      { createModel: () => model },
    );
    expect(plan).toEqual({
      messages: ["Olá!", "Como posso ajudar?"],
      handoff: null,
    });
    expect(
      (await messagesOf(room.roomId)).filter((m) =>
        m.sender.startsWith("@_guidu_a_"),
      ),
    ).toEqual([]);
    const conversation = await admin.aiConversation.findFirstOrThrow({
      where: { matrixRoomId: room.roomId },
      select: { id: true },
    });
    const history = await admin.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    expect(history[0]?.role).toBe("assistant");
    expect(history[1]).toEqual({ role: "user", content: "Oi" });
  });
});
