import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkChannelConnection,
  createChatwootConnection,
  deleteChannelConnection,
  listChannelConnections,
} from "@/core/channels/connections";
import { receiveChannelWebhook } from "@/core/channels/webhook";
import { decryptSecret } from "@/core/credentials/crypto";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { contextA, contextB, contextMultiOrgInA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A5a: a Chatwoot connection of the workspace (the Agent Bot created with
 * the connection's webhook, tokens encrypted, the check and the removal)
 * and the webhook that writes the normalized events once, with or without
 * a route. The provider is a fake on a public test address.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const BASE_URL = "https://203.0.113.10";
const USER_TOKEN = "chatwoot-user-token-123";
const APP_URL = "https://guidu.test";

type Call = Readonly<{ method: string; path: string; token: string | null }>;

/** A Chatwoot account with one inbox and the bots created through it. */
function fakeChatwoot() {
  const calls: Call[] = [];
  const bots = new Map<number, string>();
  let nextBot = 7;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const token =
      (init?.headers as Record<string, string> | undefined)?.api_access_token ??
      null;
    calls.push({ method, path: url.pathname, token });
    if (token !== USER_TOKEN) return new Response("no", { status: 401 });
    if (!url.pathname.startsWith("/api/v1/accounts/1/")) {
      return new Response("no account", { status: 404 });
    }
    const rest = url.pathname.slice("/api/v1/accounts/1".length);
    if (rest === "/agent_bots" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { outgoing_url: string };
      const id = nextBot++;
      bots.set(id, body.outgoing_url);
      return Response.json({ id, access_token: `bot-token-${id}-abcdef` });
    }
    if (rest === "/inboxes") {
      return Response.json({
        payload: [{ id: 3, name: "WhatsApp", channel_type: "Channel::Api" }],
      });
    }
    const bot = /^\/agent_bots\/(\d+)$/.exec(rest);
    if (bot) {
      const id = Number(bot[1]);
      if (!bots.has(id)) return new Response("", { status: 404 });
      if (method === "DELETE") bots.delete(id);
      return Response.json({ id });
    }
    return new Response("", { status: 404 });
  });
  return { fetch, calls, bots };
}

describeDatabase("A5a: channels of the workspace", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const run = <T>(
    ctx: RequestContext,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withContext(prisma, ctx, op);

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.channel_connections where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await admin.$executeRawUnsafe(
      `update public.workspace_members set role = 'viewer'
       where workspace_id = '${ids.workspaceA}' and user_id = '${ids.userMultiOrg}'`,
    );
  }

  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(async () => {
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  async function connect(fake = fakeChatwoot()) {
    const created = await createChatwootConnection(
      prisma,
      contextA,
      {
        name: "Atendimento",
        baseUrl: `${BASE_URL}/app/accounts/1/dashboard`,
        accountId: "1",
        accessToken: USER_TOKEN,
      },
      { fetch: fake.fetch, appUrl: APP_URL },
    );
    const [, outgoingUrl] = [...fake.bots.entries()][0]!;
    const [, , , connectionId, token] = new URL(outgoingUrl).pathname.split(
      "/",
    );
    return { created, fake, connectionId: connectionId!, token: token! };
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

  function message(id: number, inbox: number) {
    return {
      event: "message_created",
      id,
      content: "Olá",
      message_type: "incoming",
      private: false,
      sender: { id: 9, name: "Maria", type: "contact" },
      conversation: {
        id: 55,
        inbox_id: inbox,
        status: "pending",
        contact_inbox: { contact_id: 9 },
      },
      inbox: { id: inbox },
    };
  }

  it("connects Chatwoot: bot with the webhook, tokens encrypted, inboxes seen", async () => {
    const { created, fake, connectionId } = await connect();
    expect(created).toMatchObject({
      id: connectionId,
      kind: "chatwoot",
      name: "Atendimento",
      baseUrl: BASE_URL,
      accountId: 1,
      healthStatus: "ok",
      healthError: null,
      inboxes: [{ id: 3, name: "WhatsApp" }],
      unroutedEvents: 0,
    });
    expect(JSON.stringify(created)).not.toContain(USER_TOKEN);
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/accounts/1/agent_bots",
      "GET /api/v1/accounts/1/inboxes",
      "GET /api/v1/accounts/1/agent_bots/7",
    ]);

    const row = await admin.channelConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(row.encryptedSecrets).not.toContain(USER_TOKEN);
    expect(JSON.parse(decryptSecret(row.encryptedSecrets))).toEqual({
      userToken: USER_TOKEN,
      botToken: "bot-token-7-abcdef",
    });
    expect(row.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/);

    const audit = await admin.auditEvent.findFirst({
      where: { action: "channels.connection.create", resourceId: connectionId },
    });
    expect(audit?.metadata).toMatchObject({ kind: "chatwoot", agentBotId: 7 });
    expect(JSON.stringify(audit?.metadata)).not.toContain(USER_TOKEN);
  });

  it("refuses bad input and a token the provider rejects, leaving nothing", async () => {
    const fake = fakeChatwoot();
    const attempt = (input: Record<string, string>) =>
      createChatwootConnection(
        prisma,
        contextA,
        {
          name: "Atendimento",
          baseUrl: BASE_URL,
          accountId: "1",
          accessToken: USER_TOKEN,
          ...input,
        },
        { fetch: fake.fetch, appUrl: APP_URL },
      );
    await expect(
      attempt({ baseUrl: "http://chat.test" }),
    ).rejects.toMatchObject({ fieldErrors: { baseUrl: expect.any(String) } });
    await expect(attempt({ accountId: "abc", name: "" })).rejects.toMatchObject(
      {
        fieldErrors: {
          accountId: expect.any(String),
          name: expect.any(String),
        },
      },
    );
    await expect(
      attempt({ accessToken: "wrong-token-123" }),
    ).rejects.toMatchObject({
      providerCode: "unauthorized",
      messageKey: "channels.errors.provider.unauthorized",
    });
    await expect(
      attempt({ baseUrl: "https://10.0.0.5" }),
    ).rejects.toMatchObject({ providerCode: "private_address" });
    expect(fake.bots.size).toBe(0);
    expect(
      await admin.channelConnection.count({
        where: { workspaceId: ids.workspaceA },
      }),
    ).toBe(0);
  });

  it("writes webhook events once, without a route and then routed", async () => {
    const { connectionId, token } = await connect();

    await expect(
      webhook(connectionId, "x".repeat(43), message(1, 3)),
    ).resolves.toEqual({ status: 404 });
    await expect(
      webhook("00000000-0000-4000-8000-000000000000", token, message(1, 3)),
    ).resolves.toEqual({ status: 404 });

    await expect(webhook(connectionId, token, message(1, 3))).resolves.toEqual({
      status: 200,
      stored: 1,
      duplicates: 0,
    });
    await expect(webhook(connectionId, token, message(1, 3))).resolves.toEqual({
      status: 200,
      stored: 0,
      duplicates: 1,
    });
    await expect(
      webhook(connectionId, token, { event: "webwidget_triggered" }),
    ).resolves.toEqual({ status: 200, stored: 0, duplicates: 0 });

    await admin.channelRoute.create({
      data: {
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        connectionId,
        scope: "3",
        consumerModule: "ai-agents",
        consumerRef: "00000000-0000-4000-8000-0000000000a5",
        createdBy: ids.userA,
      },
    });
    await webhook(connectionId, token, message(2, 3));

    const events = await admin.channelInboundEvent.findMany({
      where: { connectionId },
      orderBy: { externalId: "asc" },
    });
    expect(events.map((event) => [event.externalId, event.status])).toEqual([
      ["message:1", "no_route"],
      ["message:2", "routed"],
    ]);
    expect(events[0]?.payload).toMatchObject({
      sender: "contact",
      message: { text: "Olá" },
    });
    const conversations = await admin.channelConversation.findMany({
      where: { connectionId },
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      externalId: "55",
      externalContactId: "9",
      externalStatus: "pending",
    });

    const [listed] = await run(contextA, (tx) =>
      listChannelConnections(tx, contextA),
    );
    expect(listed?.unroutedEvents).toBe(1);
    expect(listed?.lastEventAt).not.toBeNull();

    // Disabled, the webhook answers as for an unknown connection.
    await admin.channelConnection.update({
      where: { id: connectionId },
      data: { status: "disabled" },
    });
    await expect(webhook(connectionId, token, message(3, 3))).resolves.toEqual({
      status: 404,
    });
  });

  it("refuses a body over the limit and one that is not JSON", async () => {
    const { connectionId, token } = await connect();
    const send = (body: string, headers: Record<string, string> = {}) =>
      receiveChannelWebhook(
        prisma,
        new Request(`${APP_URL}/api/channels/${connectionId}/${token}`, {
          method: "POST",
          body,
          headers,
        }),
        connectionId,
        token,
      );
    await expect(send("{", {})).resolves.toEqual({ status: 400 });
    await expect(
      send("{}", { "content-length": String(2_000_000) }),
    ).resolves.toEqual({ status: 413 });
  });

  it("checks: a bot removed in Chatwoot shows as failed", async () => {
    const { fake, connectionId } = await connect();
    fake.bots.clear();
    const checked = await checkChannelConnection(
      prisma,
      contextA,
      connectionId,
      {
        fetch: fake.fetch,
      },
    );
    expect(checked).toMatchObject({
      healthStatus: "failed",
      healthError: "bot_missing",
      // The inboxes of the last good check stay.
      inboxes: [{ id: 3 }],
    });
    const audit = await admin.auditEvent.findFirst({
      where: { action: "channels.connection.check", resourceId: connectionId },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).toMatchObject({ result: "error" });
  });

  it("removes the connection, its bot and its events", async () => {
    const { fake, connectionId, token } = await connect();
    await webhook(connectionId, token, message(1, 3));
    await deleteChannelConnection(prisma, contextA, connectionId, {
      fetch: fake.fetch,
    });
    expect(fake.bots.size).toBe(0);
    expect(
      await admin.channelInboundEvent.count({ where: { connectionId } }),
    ).toBe(0);
    expect(
      await admin.channelConversation.count({ where: { connectionId } }),
    ).toBe(0);
    const audit = await admin.auditEvent.findFirst({
      where: { action: "channels.connection.delete", resourceId: connectionId },
    });
    expect(audit?.metadata).toMatchObject({ botRemoved: true });
    await expect(webhook(connectionId, token, message(2, 3))).resolves.toEqual({
      status: 404,
    });
  });

  it("isolates workspaces and roles", async () => {
    const { connectionId, fake } = await connect();
    await expect(
      run(contextB, (tx) => listChannelConnections(tx, contextB)),
    ).resolves.toEqual([]);
    await expect(
      checkChannelConnection(prisma, contextB, connectionId, {
        fetch: fake.fetch,
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      deleteChannelConnection(prisma, contextB, connectionId, {
        fetch: fake.fetch,
      }),
    ).rejects.toBeInstanceOf(AppError);

    // Viewer: nothing. Editor: reads, does not manage.
    await expect(
      run(contextMultiOrgInA, (tx) =>
        listChannelConnections(tx, contextMultiOrgInA),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await admin.$executeRawUnsafe(
      `update public.workspace_members set role = 'editor'
       where workspace_id = '${ids.workspaceA}' and user_id = '${ids.userMultiOrg}'`,
    );
    await expect(
      run(contextMultiOrgInA, (tx) =>
        listChannelConnections(tx, contextMultiOrgInA),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      deleteChannelConnection(prisma, contextMultiOrgInA, connectionId, {
        fetch: fake.fetch,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(fake.bots.size).toBe(1);
  });
});
