import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "@prisma/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  completeMetaEmbeddedSignup,
  createMetaConnection,
  setMetaRoute,
} from "@/core/channels/meta-connections";
import {
  answerMetaChallenge,
  receiveMetaWebhook,
} from "@/core/channels/meta-webhook";
import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import { sendAsAgent } from "@/core/matrix/agent";
import { handleAppServiceRequest } from "@/core/matrix/appservice";
import { matrixConfig, type MatrixConfig } from "@/core/matrix/config";
import { matrixProcessEventsJob } from "@/core/matrix/jobs";
import {
  deliverMetaInbound,
  META_SEND_KIND,
  sendMetaOutbound,
} from "@/core/matrix/meta";
import {
  createSynapseClient,
  deleteRoom,
  type SynapseClient,
} from "@/core/matrix/synapse";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { runGuidsTurn } from "@/modules/inbox/server/guids-turn";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * IN7a against a real Synapse (scripts/local/synapse.sh) and a double of
 * the Graph API of Meta: a number is linked by hand and by the Embedded
 * Signup, named to a GUIDS, and its webhook (signed with the app secret)
 * brings the messages of a contact. The core says them in the room of the
 * person (one room per person and store), as the contact's user; the
 * GUIDS of the number answers there, with the Inbox module off, and its
 * answer goes out by Meta. Free text outside the 24-hour window is
 * refused, and a failed status of Meta marks the delivery.
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

const GUID = "1e700000-0000-4000-8000-0000000000a7";
const LABEL = "Chave IN7a";
const APP_SECRET = "in7a-app-secret";
const NUMBER = "1077000000001";
const NUMBER_EMBEDDED = "1077000000002";
const WABA = "2077000000001";
const MARIA = "5511987654321";
const TOKEN = "EAAG-in7a-system-user-token-0001";

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

type Sent = { path: string; body: Record<string, unknown> };

describeDatabase("IN7a: WhatsApp of Meta in the rooms", requiredVars, () => {
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
  let asServer: Server;
  let graph: Server;
  let graphUrl = "";
  const sent: Sent[] = [];
  let outCount = 0;

  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction(fn, { timeout: 120_000, maxWait: 30_000 });
  const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
    jobRunId,
    transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
      withContext(prisma, ctx, op),
  });

  async function cleanup() {
    const rooms = await admin.matrixRoom.findMany({
      where: { roomId: { not: null } },
      select: { roomId: true },
    });
    for (const room of rooms) await deleteRoom(client, room.roomId!);
    for (const table of [
      "matrix_outbound",
      "inbox_guids_rooms",
      "inbox_conversations",
      "matrix_contacts",
      "matrix_agent_users",
      "matrix_rooms",
      "matrix_accounts",
      "matrix_events",
      "matrix_as_transactions",
    ]) {
      await admin.$executeRawUnsafe(`delete from public.${table}`);
    }
    await admin.$executeRawUnsafe(
      `delete from public.channel_connections where kind = 'meta_whatsapp'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind like 'matrix.%' or kind like 'channels.meta-%'
         or kind in ('inbox.guids-turn', 'inbox.link-contact')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_conversations where workspace_id = '${ids.workspaceA}'`,
    );
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    vi.stubEnv("GUIDU_CHANNELS_ALLOW_PRIVATE", "true");
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    vi.stubEnv("META_APP_ID", "3077000000001");
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "in7a-verify");
    const loaded = matrixConfig();
    if (!loaded) throw new Error("Matrix variables are incomplete");
    config = loaded;
    client = createSynapseClient(config);

    // The double of the Graph API of Meta.
    graph = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://graph.test");
        const body = req.method === "POST" ? await readBody(req) : "";
        const json = (status: number, value: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(value));
        };
        const path = url.pathname.replace(/^\/+/, "");
        if (
          req.headers.authorization !== `Bearer ${TOKEN}` &&
          path !== "oauth/access_token" &&
          !path.startsWith("download/")
        ) {
          return json(401, { error: { code: 190 } });
        }
        if (path === "oauth/access_token") {
          return url.searchParams.get("code") === "embedded-code-0001"
            ? json(200, { access_token: TOKEN })
            : json(400, { error: { code: 100 } });
        }
        if (
          req.method === "GET" &&
          /^[0-9]+$/.test(path) &&
          url.searchParams.get("fields")
        ) {
          return json(200, {
            display_phone_number: "+55 11 90000-0001",
            verified_name: "Loja A",
          });
        }
        if (path.endsWith("/subscribed_apps"))
          return json(200, { success: true });
        if (path.endsWith("/register")) return json(200, { success: true });
        if (path.endsWith("/messages")) {
          sent.push({
            path,
            body: JSON.parse(body) as Record<string, unknown>,
          });
          outCount += 1;
          return json(200, { messages: [{ id: `wamid.OUT${outCount}` }] });
        }
        if (path === "9077000000001") {
          return json(200, { url: `${graphUrl}/download/9077000000001` });
        }
        if (path === "download/9077000000001") {
          res.writeHead(200, { "content-type": "image/png" });
          return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        }
        return json(404, { error: { code: 100 } });
      })();
    });
    await new Promise<void>((resolve) => graph.listen(0, "127.0.0.1", resolve));
    graphUrl = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
    vi.stubEnv("META_GRAPH_URL", graphUrl);

    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${GUID}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
    );
    // Only the AI agents module: the Inbox is off (plano-in7.md, answer 15).
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id = '${ids.workspaceA}' and module_key = 'inbox'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ids.organizationA}', '${ids.workspaceA}', 'ai-agents', 'enabled', '${ids.userA}')
       on conflict (workspace_id, module_key) do update set status = 'enabled', updated_by = '${ids.userA}'`,
    );
    const sealed = encryptSecret("sk-proj-0123456789abcdef0123456789");
    const credentialId = (
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
        config: {
          overview: {
            agent_name: "Bia",
            language: "pt-BR",
            system_prompt: "Você é {{agent_name}}.",
          },
          integration: { tools: ["think", "handoff"] },
          model: { credential_id: credentialId, model_name: "gpt-test" },
        },
        configVersion: 1,
        createdBy: ids.userA,
      },
    });
    await admin.$executeRawUnsafe(
      `update public.ai_agents set tested_config_hash = md5(config::text), tested_at = now() where id = '${GUID}'`,
    );

    asServer = createServer((req, res) => {
      void (async () => {
        const body = await readBody(req);
        const url = `http://127.0.0.1:${asPort}${req.url ?? "/"}`;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(key, value);
        }
        const method = req.method ?? "GET";
        const request = new Request(url, {
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? null : body,
        });
        const segments = new URL(url).pathname
          .replace(/^\/api\/matrix\/as\/?/, "")
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent);
        const response = await handleAppServiceRequest(request, segments, {
          prisma,
        });
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(Buffer.from(await response.arrayBuffer()));
      })();
    });
    await new Promise<void>((resolve) =>
      asServer.listen(asPort, "127.0.0.1", resolve),
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => asServer?.close(() => resolve()));
    await new Promise<void>((resolve) => graph?.close(() => resolve()));
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
    await Promise.all([
      prisma.$disconnect(),
      admin.$disconnect(),
      workerDb.$disconnect(),
    ]);
  });

  /** A webhook call of Meta, signed with the app secret. */
  function webhook(value: Record<string, unknown>, secret = APP_SECRET) {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: WABA, changes: [{ field: "messages", value }] }],
    });
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    return new Request("http://app.test/api/channels/meta", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      body: raw,
    });
  }

  function message(id: string, extra: Record<string, unknown>) {
    return {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "5511900000001",
        phone_number_id: NUMBER,
      },
      contacts: [{ profile: { name: "Maria Silva" }, wa_id: MARIA }],
      messages: [
        {
          from: MARIA,
          id,
          timestamp: String(Math.floor(Date.now() / 1000)),
          ...extra,
        },
      ],
    };
  }

  async function processUntil(eventId: string | null) {
    await eventually(async () => {
      await asWorker((tx) => matrixProcessEventsJob.run(tx, {}));
      if (!eventId) return true;
      const seen = await admin.matrixEvent.findUnique({
        where: { eventId },
        select: { status: true },
      });
      return seen?.status === "processed";
    }, `event ${eventId}`);
  }

  async function roomMessages(roomId: string) {
    const page = await client.request<{
      chunk: {
        event_id: string;
        sender: string;
        content: { body?: string; msgtype?: string };
      }[];
    }>(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
      {
        query: {
          dir: "b",
          limit: "50",
          filter: JSON.stringify({ types: ["m.room.message"] }),
        },
      },
    );
    return page.chunk.reverse();
  }

  it("links a number, takes a contact to the room, answers by the GUIDS and sends it out", async () => {
    // The challenge of the webhook's registration.
    expect(
      answerMetaChallenge(
        new URL(
          "http://app.test/api/channels/meta?hub.mode=subscribe&hub.verify_token=in7a-verify&hub.challenge=42",
        ),
      ),
    ).toEqual({ status: 200, body: "42" });
    expect(
      answerMetaChallenge(
        new URL(
          "http://app.test/api/channels/meta?hub.mode=subscribe&hub.verify_token=other&hub.challenge=42",
        ),
      ).status,
    ).toBe(403);

    // Linked by hand and by the Embedded Signup.
    const manual = await createMetaConnection(prisma, contextA, {
      name: "WhatsApp da loja",
      phoneNumberId: NUMBER,
      wabaId: WABA,
      accessToken: TOKEN,
    });
    expect(manual.meta).toMatchObject({
      phoneNumberId: NUMBER,
      displayPhoneNumber: "+55 11 90000-0001",
      verifiedName: "Loja A",
      linkedVia: "manual",
    });
    expect(manual.healthStatus).toBe("ok");
    const embedded = await completeMetaEmbeddedSignup(prisma, contextA, {
      name: "Segundo número",
      code: "embedded-code-0001",
      phoneNumberId: NUMBER_EMBEDDED,
      wabaId: WABA,
      pin: "123456",
    });
    expect(embedded.meta?.linkedVia).toBe("embedded");
    await expect(
      createMetaConnection(prisma, contextA, {
        name: "De novo",
        phoneNumberId: NUMBER,
        wabaId: WABA,
        accessToken: TOKEN,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const stored = await admin.channelConnection.findUniqueOrThrow({
      where: { id: manual.id },
    });
    expect(stored.encryptedSecrets).not.toContain(TOKEN);

    // Without a route the message is kept but goes nowhere.
    const early = await receiveMetaWebhook(
      prisma,
      webhook(message("wamid.IN0", { type: "text", text: { body: "Alô?" } })),
    );
    expect(early).toEqual({ status: 200, stored: 1, duplicates: 0 });
    expect(
      (
        await admin.channelInboundEvent.findFirstOrThrow({
          where: { externalId: "wamid.IN0" },
        })
      ).status,
    ).toBe("no_route");

    // The GUIDS answers the number (the owner names it).
    await withContext(prisma, contextA, (tx) =>
      setMetaRoute(tx, contextA, { connectionId: manual.id, agentId: GUID }),
    );

    // A bad signature writes nothing; a retry of Meta writes nothing twice.
    expect(
      (
        await receiveMetaWebhook(
          prisma,
          webhook(
            message("wamid.IN1", { type: "text", text: { body: "Oi" } }),
            "wrong",
          ),
        )
      ).status,
    ).toBe(401);
    const first = await receiveMetaWebhook(
      prisma,
      webhook(
        message("wamid.IN1", {
          type: "text",
          text: { body: "Oi, vocês abrem sábado?" },
        }),
      ),
    );
    expect(first).toEqual({ status: 200, stored: 1, duplicates: 0 });
    const again = await receiveMetaWebhook(
      prisma,
      webhook(
        message("wamid.IN1", {
          type: "text",
          text: { body: "Oi, vocês abrem sábado?" },
        }),
      ),
    );
    expect(again).toEqual({ status: 200, stored: 0, duplicates: 1 });
    expect(
      await admin.jobRun.count({
        where: { kind: "channels.meta-inbound", status: "pending" },
      }),
    ).toBe(1);

    // The worker takes it to the room of the person, as the contact.
    const delivered = await asWorker((tx) => deliverMetaInbound(tx, client));
    expect(delivered).toMatchObject({ delivered: 1 });
    const contact = await admin.matrixContact.findFirstOrThrow({
      where: { workspaceId: ids.workspaceA, phone: MARIA },
    });
    expect(contact.mxid).toMatch(/^@_guidu_c_[a-z2-7]{16}:/);
    expect(contact.displayName).toBe("Maria Silva");
    const room = await admin.matrixRoom.findFirstOrThrow({
      where: { consumerMxid: contact.mxid },
    });
    expect(room).toMatchObject({
      origin: "meta",
      consumerName: "Maria Silva",
      status: "pending",
    });
    expect(room.channelConversationId).not.toBeNull();
    const roomId = room.roomId!;
    const said = await roomMessages(roomId);
    expect(said.at(-1)).toMatchObject({
      sender: contact.mxid,
      content: { body: "Oi, vocês abrem sábado?" },
    });
    // The text left the database once it was in the room.
    const event = await admin.channelInboundEvent.findFirstOrThrow({
      where: { externalId: "wamid.IN1" },
    });
    expect(event.status).toBe("dispatched");
    expect((event.payload as { message: { text: string } }).message.text).toBe(
      "",
    );
    // The agent of the number is in the room; nobody was told yet.
    const agent = await admin.matrixAgentUser.findUniqueOrThrow({
      where: { agentId: GUID },
    });
    expect(
      await admin.matrixRoomMember.findFirst({
        where: { roomId, userMxid: agent.mxid, membership: "join" },
      }),
    ).not.toBeNull();
    expect(
      await admin.$queryRawUnsafe<unknown[]>(
        `select 1 from public.events where type = 'inbox.conversation.new' and subject_id = $1`,
        roomId,
      ),
    ).toHaveLength(0);

    // The GUIDS of the number answers, with the Inbox module off.
    const contactEvent = said.at(-1)!.event_id;
    await processUntil(contactEvent);
    const run = await admin.jobRun.findFirstOrThrow({
      where: {
        kind: "inbox.guids-turn",
        status: "pending",
        payload: { path: ["roomId"], equals: roomId },
      },
    });
    expect(run.requestedBy).toBe(ids.userA);
    await admin.jobRun.update({
      where: { id: run.id },
      data: { status: "succeeded" },
    });
    const model = new MockLanguageModelV4({
      doGenerate: [planStep(["Olá, Maria! Abrimos sim, das 9h às 13h."])],
    });
    const answered = await runGuidsTurn(
      session(run.id, contextA),
      contextA,
      { roomId },
      { client, turnDeps: { createModel: () => model }, sleep: async () => 0 },
    );
    expect(answered).toMatchObject({ status: "answered", sent: 1 });
    const answer = (await roomMessages(roomId)).at(-1)!;
    expect(answer.sender).toBe(agent.mxid);

    // What the GUIDS said goes out by Meta, once.
    await processUntil(answer.event_id);
    const send = await admin.jobRun.findFirstOrThrow({
      where: {
        kind: META_SEND_KIND,
        payload: { path: ["eventId"], equals: answer.event_id },
      },
    });
    const result = await asWorker((tx) =>
      sendMetaOutbound(
        tx,
        client,
        send.payload as { roomId: string; eventId: string },
      ),
    );
    expect(result).toEqual({ status: "sent" });
    expect(sent.at(-1)).toMatchObject({
      path: `${NUMBER}/messages`,
      body: {
        to: MARIA,
        type: "text",
        text: { body: "Olá, Maria! Abrimos sim, das 9h às 13h." },
      },
    });
    const again2 = await asWorker((tx) =>
      sendMetaOutbound(
        tx,
        client,
        send.payload as { roomId: string; eventId: string },
      ),
    );
    expect(again2).toEqual({ status: "skipped" });
    const outbound = await admin.matrixOutbound.findUniqueOrThrow({
      where: { eventId: answer.event_id },
    });
    expect(outbound).toMatchObject({
      status: "sent",
      externalId: `wamid.OUT${outCount}`,
    });

    // Meta says the message failed: the delivery is marked.
    await receiveMetaWebhook(
      prisma,
      webhook({
        messaging_product: "whatsapp",
        metadata: { phone_number_id: NUMBER },
        statuses: [
          {
            id: `wamid.OUT${outCount}`,
            status: "failed",
            recipient_id: MARIA,
            errors: [{ code: 131026 }],
          },
        ],
      }),
    );
    expect(
      await admin.matrixOutbound.findUniqueOrThrow({
        where: { eventId: answer.event_id },
      }),
    ).toMatchObject({ status: "failed", error: "meta_131026" });

    // An image of the same person comes to the same room.
    await receiveMetaWebhook(
      prisma,
      webhook(
        message("wamid.IN2", {
          type: "image",
          image: {
            id: "9077000000001",
            mime_type: "image/png",
            caption: "Assim?",
          },
        }),
      ),
    );
    await asWorker((tx) => deliverMetaInbound(tx, client));
    expect(
      await admin.matrixRoom.count({ where: { consumerMxid: contact.mxid } }),
    ).toBe(1);
    const image = (await roomMessages(roomId)).at(-1)!;
    expect(image).toMatchObject({
      sender: contact.mxid,
      content: { msgtype: "m.image", body: "Assim?" },
    });

    // Outside the 24-hour window free text is refused.
    const late = await sendAsAgent(
      client,
      roomId,
      agent.mxid,
      `in7a-late-${Date.now()}`,
      "Ainda precisa de ajuda?",
    );
    await processUntil(late);
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const refused = await asWorker((tx) =>
      sendMetaOutbound(tx, client, { roomId, eventId: late! }, {}, tomorrow),
    );
    expect(refused).toEqual({ status: "failed", error: "window_closed" });
  });
});
