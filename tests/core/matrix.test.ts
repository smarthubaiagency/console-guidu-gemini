import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PlatformTxJobDefinition } from "@/core/jobs/definition";
import { handleAppServiceRequest } from "@/core/matrix/appservice";
import {
  coreUserId,
  matrixConfig,
  type MatrixConfig,
} from "@/core/matrix/config";
import {
  matrixCleanupJob,
  matrixLogoutDevicesJob,
  matrixProcessEventsJob,
  matrixSyncAccountJob,
  matrixSyncWorkspaceJob,
} from "@/core/matrix/jobs";
import { matrixWorkspaceLifecycle } from "@/core/matrix/lifecycle";
import { createConversationRoom } from "@/core/matrix/rooms";
import { changeConversation } from "@/core/matrix/conversation";
import { createMatrixSession } from "@/core/matrix/session";
import {
  CONVERSATION_STATE,
  createRoom,
  createSynapseClient,
  deleteRoom,
  MatrixHttpError,
  type SynapseClient,
} from "@/core/matrix/synapse";
import { updateWorkspaceMemberRole } from "@/core/workspaces/members";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * IN3 against a real Synapse (scripts/local/synapse.sh, the same in CI):
 * the session and its JWT, the Application Service both ways (Synapse
 * pushes transactions to a local server running the route's handler),
 * rooms in the order of the proof, the mirrored conversation state, a
 * consumer's room refused (and, IN4a, a room opened when the consumer
 * calls the address of the store), accounts following the attendant mark,
 * changes of the conversation through the console, the workspace
 * lifecycle for the WS1, logout of the devices and the orphan cleanup.
 * The Matrix variables come from the file of the local Synapse, so no
 * other suite sees Matrix turned on.
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

const enc = encodeURIComponent;

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

describeDatabase(
  "IN3: Matrix core against a local Synapse",
  requiredVars,
  () => {
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
    const received: string[] = [];

    const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
      workerDb.$transaction(fn, { timeout: 120_000, maxWait: 30_000 });
    const run = <P>(job: PlatformTxJobDefinition<P>, payload: P) =>
      asWorker((tx) => job.run(tx, payload));

    /** Runs the processing until the condition holds (events arrive async). */
    async function processUntil<T>(
      check: () => Promise<T | null | undefined | false>,
      label: string,
    ) {
      return eventually(async () => {
        await run(matrixProcessEventsJob, {});
        return check();
      }, label);
    }

    async function login(
      token: string,
    ): Promise<{ user_id: string; access_token: string }> {
      const response = await fetch(
        `${config.homeserverUrl}/_matrix/client/v3/login`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "org.matrix.login.jwt", token }),
        },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as {
        user_id: string;
        access_token: string;
      };
    }

    async function asUser(
      token: string,
      method: string,
      path: string,
      body?: unknown,
    ) {
      const response = await fetch(`${config.homeserverUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? null : JSON.stringify(body),
      });
      return {
        status: response.status,
        json: (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >,
      };
    }

    async function joinedMembers(roomId: string): Promise<string[]> {
      const { members } = await client.request<{ members: string[] }>(
        "GET",
        `/_synapse/admin/v1/rooms/${enc(roomId)}/members`,
      );
      return members;
    }

    /** A consumer account (the guidu.chat role) and its access token. */
    async function consumer(): Promise<{ mxid: string; token: string }> {
      const mxid = `@cliente_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}:${config.serverName}`;
      await client.request("PUT", `/_synapse/admin/v2/users/${enc(mxid)}`, {
        body: { displayname: "Cliente" },
      });
      const { access_token } = await client.request<{ access_token: string }>(
        "POST",
        `/_synapse/admin/v1/users/${enc(mxid)}/login`,
        { body: {} },
      );
      return { mxid, token: access_token };
    }

    /** Marks (or unmarks) a person as attendant of workspace A (IN4a). */
    async function mark(userId: string, on = true) {
      if (on) {
        await admin.$executeRawUnsafe(
          `insert into public.inbox_attendants (workspace_id, organization_id, user_id)
           values ('${ids.workspaceA}', '${ids.organizationA}', '${userId}') on conflict do nothing`,
        );
      } else {
        await admin.$executeRawUnsafe(
          `delete from public.inbox_attendants where workspace_id = '${ids.workspaceA}' and user_id = '${userId}'`,
        );
      }
    }

    async function cleanup() {
      await admin.$executeRawUnsafe(`delete from public.inbox_attendants`);
      await admin.$executeRawUnsafe(
        `delete from public.matrix_workspace_addresses`,
      );
      await admin.$executeRawUnsafe(`delete from public.matrix_rooms`);
      await admin.$executeRawUnsafe(`delete from public.matrix_accounts`);
      await admin.$executeRawUnsafe(`delete from public.matrix_events`);
      await admin.$executeRawUnsafe(
        `delete from public.matrix_as_transactions`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.job_runs where kind like 'matrix.%'`,
      );
      await admin.$executeRawUnsafe(
        `update public.workspaces set status = 'active', purge_after = null, deletion_requested_at = null
       where id = '${ids.workspaceA}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.workspace_members set role = 'viewer'
       where workspace_id = '${ids.workspaceA}' and user_id = '${ids.userMultiOrg}'`,
      );
    }

    beforeAll(async () => {
      const loaded = matrixConfig();
      if (!loaded)
        throw new Error(
          "Matrix variables in MATRIX_TEST_ENV_FILE are incomplete",
        );
      config = loaded;
      client = createSynapseClient(config);
      await cleanup();
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
            received.push(`${method} ${segments.join("/")}`);
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
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      await cleanup();
      await Promise.all([
        prisma.$disconnect(),
        admin.$disconnect(),
        workerDb.$disconnect(),
      ]);
    });

    it("answers the ping of Synapse with the hs_token, and refuses a wrong token", async () => {
      const ping = await client.request<{ duration_ms?: number }>(
        "POST",
        `/_matrix/client/v1/appservice/${enc(config.asId)}/ping`,
        { body: {} },
      );
      expect(typeof ping.duration_ms).toBe("number");
      expect(received).toContain("POST _matrix/app/v1/ping");

      const wrong = await handleAppServiceRequest(
        new Request("http://as.test/x", {
          method: "PUT",
          headers: { authorization: "Bearer wrong" },
          body: "{}",
        }),
        ["_matrix", "app", "v1", "transactions", "1"],
        { prisma },
      );
      expect(wrong.status).toBe(403);
    });

    it("gives a 60-second JWT only to someone with inbox.view, on an opaque account", async () => {
      const session = await createMatrixSession(prisma, ids.userA);
      expect(session.userId).toMatch(
        new RegExp(
          `^@u_[a-z2-7]{24}:${config.serverName.replace(/\./g, "\\.")}$`,
        ),
      );
      expect(session.userId).not.toContain(
        ids.userA.replace(/-/g, "").slice(0, 12),
      );
      const exp = JSON.parse(
        Buffer.from(
          session.loginToken.split(".")[1] ?? "",
          "base64url",
        ).toString(),
      ) as { exp: number; iat: number; sub: string };
      expect(exp.exp - exp.iat).toBe(60);
      const logged = await login(session.loginToken);
      expect(logged.user_id).toBe(session.userId);

      // Viewer of workspace A: no inbox.view anywhere.
      await expect(
        createMatrixSession(prisma, ids.userMultiOrg),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(
        createMatrixSession(prisma, ids.userMultiOrg),
      ).rejects.toBeInstanceOf(AppError);
      // The session asked the worker to sync the account.
      const runs = await admin.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*) as n from public.job_runs where kind = 'matrix.sync-account'
         and status = 'pending' and payload->>'userId' = '${ids.userA}'`,
      );
      expect(Number(runs[0]?.n)).toBe(1);
    });

    it("creates the room in order, with the power levels of the proof, and mirrors the state", async () => {
      // The owner answers only when marked as attendant (IN4a).
      await mark(ids.userA);
      const owner = await createMatrixSession(prisma, ids.userA);
      const ownerLogin = await login(owner.loginToken);
      const guest = await consumer();
      const room = await asWorker((tx) =>
        createConversationRoom(tx, client, {
          workspaceId: ids.workspaceA,
          consumerMxid: guest.mxid,
        }),
      );
      expect(room.attendants).toBe(1);

      const state = await client.request<
        { type: string; state_key: string; content: Record<string, unknown> }[]
      >("GET", `/_matrix/client/v3/rooms/${enc(room.roomId)}/state`);
      const byType = (type: string) =>
        state.find((event) => event.type === type)?.content ?? null;
      expect(byType("m.room.create")).toMatchObject({ room_version: "12" });
      expect(byType("m.room.guest_access")).toEqual({
        guest_access: "forbidden",
      });
      expect(byType("m.room.encryption")).toBeNull();
      expect(byType(CONVERSATION_STATE)).toEqual({
        version: 1,
        status: "pending",
        assignee: null,
      });
      const power = byType("m.room.power_levels") as {
        users: Record<string, number>;
        events: Record<string, number>;
      };
      expect(power.users[coreUserId(config)]).toBeUndefined();
      expect(power.users[owner.userId]).toBe(10);
      expect(power.users[guest.mxid]).toBe(10);
      expect(power.events["m.room.encryption"]).toBe(100);
      expect(power.events["m.room.power_levels"]).toBe(100);
      expect(power.events[CONVERSATION_STATE]).toBe(50);
      expect(await joinedMembers(room.roomId)).toEqual(
        expect.arrayContaining([coreUserId(config), owner.userId]),
      );

      // The consumer joins and cannot turn encryption on.
      expect(
        (
          await asUser(
            guest.token,
            "POST",
            `/_matrix/client/v3/rooms/${enc(room.roomId)}/join`,
            {},
          )
        ).status,
      ).toBe(200);
      const encryption = await asUser(
        guest.token,
        "PUT",
        `/_matrix/client/v3/rooms/${enc(room.roomId)}/state/m.room.encryption/`,
        { algorithm: "m.megolm.v1.aes-sha2" },
      );
      expect(encryption.status).toBe(403);

      // The attendant answers but cannot write the state from the browser
      // (IN4a): the console checks the permission and writes it as the core.
      const message = await asUser(
        ownerLogin.access_token,
        "PUT",
        `/_matrix/client/v3/rooms/${enc(room.roomId)}/send/m.room.message/t${Date.now()}`,
        { msgtype: "m.text", body: "Olá" },
      );
      expect(message.status).toBe(200);
      const direct = await asUser(
        ownerLogin.access_token,
        "PUT",
        `/_matrix/client/v3/rooms/${enc(room.roomId)}/state/${CONVERSATION_STATE}/`,
        { version: 1, status: "open", assignee: owner.userId },
      );
      expect(direct.status).toBe(403);
      await processUntil(
        () =>
          admin.matrixRoomMember.findFirst({
            where: { roomId: room.roomId, userMxid: owner.userId },
          }),
        "attendant membership recorded",
      );
      const taken = await withContext(prisma, contextA, (tx) =>
        changeConversation(tx, client, {
          roomId: room.roomId,
          action: { kind: "take" },
          actor: { mxid: owner.userId, level: "reply", manages: true },
        }),
      );
      expect(taken).toEqual({ status: "open", assignee: owner.userId });

      const mirrored = await processUntil(async () => {
        const row = await admin.matrixRoom.findUnique({
          where: { roomId: room.roomId },
        });
        return row?.status === "open" ? row : null;
      }, "conversation state mirrored");
      expect(mirrored.assignee).toBe(owner.userId);
      expect(mirrored.state).toBe("active");
      const guestMember = await processUntil(
        () =>
          admin.matrixRoomMember.findFirst({
            where: {
              roomId: room.roomId,
              userMxid: guest.mxid,
              membership: "join",
            },
          }),
        "consumer membership followed",
      );
      expect(guestMember.workspaceId).toBe(ids.workspaceA);

      // A transaction sent again stores nothing twice.
      const before = await admin.matrixEvent.count();
      const event = await admin.matrixEvent.findFirstOrThrow({
        where: { roomId: room.roomId },
      });
      const replay = await handleAppServiceRequest(
        new Request("http://as.test/x", {
          method: "PUT",
          headers: { authorization: `Bearer ${config.hsToken}` },
          body: JSON.stringify({
            events: [
              {
                event_id: event.eventId,
                room_id: event.roomId,
                type: event.type,
                state_key: event.stateKey,
                sender: event.sender,
                content: event.content,
              },
              {
                event_id: "$msg",
                room_id: event.roomId,
                type: "m.room.message",
                sender: guest.mxid,
                content: { body: "oi" },
              },
            ],
          }),
        }),
        ["_matrix", "app", "v1", "transactions", `replay-${Date.now()}`],
        { prisma },
      );
      expect(replay.status).toBe(200);
      // The replayed event is not stored twice; the message is a new mark.
      expect(await admin.matrixEvent.count()).toBe(before + 1);
      // A message is only a mark (IN4b): who and when, never the text.
      const marks = await admin.matrixEvent.findMany({
        where: { type: "m.room.message" },
        select: { content: true },
      });
      expect(JSON.stringify(marks)).not.toContain("oi");
      expect(JSON.stringify(marks)).not.toContain("Olá");
      await processUntil(async () => {
        const row = await admin.matrixRoom.findUnique({
          where: { roomId: room.roomId },
        });
        return row?.lastTeamMessageAt ? row : null;
      }, "team message marked");
    });

    it("refuses a room created by a consumer that invites a namespace user", async () => {
      const guest = await consumer();
      const agent = `@_guidu_agent_in3test:${config.serverName}`;
      await client
        .request("POST", "/_matrix/client/v3/register", {
          body: {
            type: "m.login.application_service",
            username: "_guidu_agent_in3test",
            inhibit_login: true,
          },
        })
        .catch((error: unknown) => {
          if (!(error instanceof MatrixHttpError && error.status === 400))
            throw error;
        });
      const created = await asUser(
        guest.token,
        "POST",
        "/_matrix/client/v3/createRoom",
        {
          preset: "private_chat",
          invite: [agent],
        },
      );
      expect(created.status).toBe(200);
      const roomId = created.json.room_id as string;
      await processUntil(async () => {
        const row = await admin.matrixEvent.findFirst({
          where: { roomId, stateKey: agent, status: "processed" },
        });
        return row;
      }, "invite refused");
      // The core is not in that room: read it as the consumer.
      const member = await asUser(
        guest.token,
        "GET",
        `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.member/${enc(agent)}`,
      );
      expect(member.json.membership).toBe("leave");
      expect(await admin.matrixRoom.count({ where: { roomId } })).toBe(0);
    });

    it("asks for the account sync when a member's role changes", async () => {
      await admin.$executeRawUnsafe(
        `delete from public.job_runs where kind = 'matrix.sync-account'`,
      );
      for (const newRole of ["editor", "viewer"] as const) {
        await withContext(prisma, contextA, (tx) =>
          updateWorkspaceMemberRole(tx, {
            workspaceId: ids.workspaceA,
            organizationId: ids.organizationA,
            actorId: ids.userA,
            targetUserId: ids.userMultiOrg,
            newRole,
          }),
        );
      }
      // One pending run per person, however many changes.
      const runs = await admin.jobRun.findMany({
        where: { kind: "matrix.sync-account", status: "pending" },
        select: { payload: true, scope: true, requestedBy: true },
      });
      expect(runs).toEqual([
        {
          payload: { userId: ids.userMultiOrg },
          scope: "platform",
          requestedBy: ids.userA,
        },
      ]);
    });

    it("follows the level: an unmarked editor has no account, a marked one answers, the owner reads", async () => {
      await mark(ids.userA, false);
      const room = await asWorker((tx) =>
        createConversationRoom(tx, client, { workspaceId: ids.workspaceA }),
      );
      const ownerAccount = await asWorker(async (tx) => {
        await matrixSyncAccountJob.run(tx, { userId: ids.userA });
        return tx.matrixAccount.findUniqueOrThrow({
          where: { profileId: ids.userA },
        });
      });
      const powers = async () =>
        (
          await client.request<{ users: Record<string, number> }>(
            "GET",
            `/_matrix/client/v3/rooms/${enc(room.roomId)}/state/m.room.power_levels/`,
          )
        ).users;
      // The owner, not marked, reads (power 0) and joins.
      expect(await joinedMembers(room.roomId)).toContain(ownerAccount.mxid);
      expect((await powers())[ownerAccount.mxid]).toBeUndefined();

      // An unmarked editor does not open the Inbox.
      await admin.$executeRawUnsafe(
        `update public.workspace_members set role = 'editor'
       where workspace_id = '${ids.workspaceA}' and user_id = '${ids.userMultiOrg}'`,
      );
      expect(
        await run(matrixSyncAccountJob, { userId: ids.userMultiOrg }),
      ).toMatchObject({ status: "none" });

      // Marked: account, room and power 10.
      await mark(ids.userMultiOrg);
      const promoted = await run(matrixSyncAccountJob, {
        userId: ids.userMultiOrg,
      });
      expect(promoted).toMatchObject({ status: "active" });
      const account = await admin.matrixAccount.findUniqueOrThrow({
        where: { profileId: ids.userMultiOrg },
      });
      expect(await joinedMembers(room.roomId)).toContain(account.mxid);
      expect((await powers())[account.mxid]).toBe(10);

      // Marking the owner raises the power without leaving the room.
      await mark(ids.userA);
      await run(matrixSyncAccountJob, { userId: ids.userA });
      expect((await powers())[ownerAccount.mxid]).toBe(10);
      await mark(ids.userA, false);
      await run(matrixSyncAccountJob, { userId: ids.userA });
      expect((await powers())[ownerAccount.mxid]).toBeUndefined();
      expect(await joinedMembers(room.roomId)).toContain(ownerAccount.mxid);

      // Unmarked: the account is deactivated.
      await mark(ids.userMultiOrg, false);
      const demoted = await run(matrixSyncAccountJob, {
        userId: ids.userMultiOrg,
      });
      expect(demoted).toMatchObject({ status: "deactivated" });
      // Synapse parts a deactivated account from its rooms in the background.
      await eventually(
        async () => !(await joinedMembers(room.roomId)).includes(account.mxid),
        "deactivated account out of the room",
      );
      const synapseUser = await client.request<{ deactivated: boolean }>(
        "GET",
        `/_synapse/admin/v2/users/${enc(account.mxid)}`,
      );
      expect(synapseUser.deactivated).toBe(true);
      expect(
        (
          await admin.matrixAccount.findUniqueOrThrow({
            where: { profileId: ids.userMultiOrg },
          })
        ).status,
      ).toBe("deactivated");

      // Running it again changes nothing.
      expect(
        await run(matrixSyncAccountJob, { userId: ids.userMultiOrg }),
      ).toMatchObject({
        status: "deactivated",
      });
    });

    it("opens a room for a consumer who calls the address of the store, and reuses it", async () => {
      await mark(ids.userA);
      await run(matrixSyncAccountJob, { userId: ids.userA });
      const synced = await run(matrixSyncWorkspaceJob, {
        workspaceId: ids.workspaceA,
      });
      expect(synced).toMatchObject({ address: true });
      const address = await admin.matrixWorkspaceAddress.findUniqueOrThrow({
        where: { workspaceId: ids.workspaceA },
      });
      expect(address.mxid).toMatch(/^@_guidu_w_[a-z2-7]{16}:/);
      expect(address.state).toBe("active");
      const profile = await client.request<{ displayname?: string }>(
        "GET",
        `/_matrix/client/v3/profile/${enc(address.mxid)}`,
      );
      expect(profile.displayname).toBeTruthy();

      const guest = await consumer();
      const call = async () => {
        const created = await asUser(
          guest.token,
          "POST",
          "/_matrix/client/v3/createRoom",
          {
            preset: "trusted_private_chat",
            is_direct: true,
            invite: [address.mxid],
          },
        );
        expect(created.status).toBe(200);
        return created.json.room_id as string;
      };
      const own = await call();
      const opened = await processUntil(
        () =>
          admin.matrixRoom.findFirst({
            where: {
              workspaceId: ids.workspaceA,
              consumerMxid: guest.mxid,
              state: "active",
            },
          }),
        "room opened for the consumer",
      );
      expect(opened.roomId).not.toBe(own);
      expect(opened.consumerName).toBe("Cliente");
      const invites = await asUser(
        guest.token,
        "GET",
        "/_matrix/client/v3/sync?timeout=0",
      );
      const invited = (
        invites.json.rooms as { invite?: Record<string, unknown> }
      )?.invite;
      expect(Object.keys(invited ?? {})).toContain(opened.roomId);

      // Calling again reuses the open conversation.
      await call();
      await processUntil(
        async () =>
          (await admin.matrixEvent.count({
            where: { stateKey: address.mxid, status: "processed" },
          })) >= 2,
        "second call processed",
      );
      expect(
        await admin.matrixRoom.count({
          where: { workspaceId: ids.workspaceA, consumerMxid: guest.mxid },
        }),
      ).toBe(1);
    });

    it("changes the conversation through the console: who answers takes and resolves, a manager assigns", async () => {
      await mark(ids.userA);
      const owner = await createMatrixSession(prisma, ids.userA);
      await run(matrixSyncAccountJob, { userId: ids.userA });
      const room = await asWorker((tx) =>
        createConversationRoom(tx, client, { workspaceId: ids.workspaceA }),
      );
      const reader = {
        mxid: owner.userId,
        level: "read" as const,
        manages: true,
      };
      const answering = {
        mxid: owner.userId,
        level: "reply" as const,
        manages: false,
      };
      const change = (
        action: Parameters<typeof changeConversation>[2]["action"],
        actor: Parameters<typeof changeConversation>[2]["actor"],
      ) =>
        withContext(prisma, contextA, (tx) =>
          changeConversation(tx, client, {
            roomId: room.roomId,
            action,
            actor,
          }),
        );
      // Who only reads takes nothing; a manager assigns.
      await expect(change({ kind: "take" }, reader)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(change({ kind: "resolve" }, answering)).resolves.toEqual({
        status: "resolved",
        assignee: null,
      });
      await expect(change({ kind: "reopen" }, answering)).resolves.toEqual({
        status: "open",
        assignee: owner.userId,
      });
      await expect(
        change({ kind: "assign", assignee: null }, answering),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        change({ kind: "assign", assignee: "@someone:else" }, reader),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        change({ kind: "assign", assignee: null }, reader),
      ).resolves.toEqual({ status: "pending", assignee: null });
      const mirrored = await processUntil(async () => {
        const row = await admin.matrixRoom.findUnique({
          where: { roomId: room.roomId },
        });
        return row?.status === "pending" && row.statusEventId ? row : null;
      }, "state mirrored");
      expect(mirrored.assignee).toBeNull();
    });

    it("blocks the rooms during the soft deletion, restores them on cancel and purges them", async () => {
      await mark(ids.userA);
      const owner = await createMatrixSession(prisma, ids.userA);
      await run(matrixSyncAccountJob, { userId: ids.userA });
      const room = await asWorker((tx) =>
        createConversationRoom(tx, client, { workspaceId: ids.workspaceA }),
      );

      await admin.$executeRawUnsafe(
        `update public.workspaces set status = 'deletion_scheduled', deletion_requested_at = now(),
         purge_after = now() + interval '30 days' where id = '${ids.workspaceA}'`,
      );
      // The WS1 hook asks for the sync (the worker runs it, as app_worker).
      await asWorker((tx) =>
        matrixWorkspaceLifecycle.onDeletionScheduled!(tx, ids.workspaceA),
      );
      expect(
        await admin.jobRun.count({
          where: {
            kind: "matrix.sync-workspace",
            status: "pending",
            payload: { equals: { workspaceId: ids.workspaceA } },
          },
        }),
      ).toBe(1);
      const blocked = await run(matrixSyncWorkspaceJob, {
        workspaceId: ids.workspaceA,
      });
      expect(blocked).toMatchObject({ action: "block" });
      expect(await joinedMembers(room.roomId)).not.toContain(owner.userId);
      expect(
        (
          await admin.matrixRoom.findUniqueOrThrow({
            where: { roomId: room.roomId },
          })
        ).state,
      ).toBe("blocked");
      // During the soft deletion nobody gets a session.
      await expect(
        createMatrixSession(prisma, ids.userA),
      ).rejects.toMatchObject({ code: "forbidden" });

      await admin.$executeRawUnsafe(
        `update public.workspaces set status = 'active', deletion_requested_at = null, purge_after = null
       where id = '${ids.workspaceA}'`,
      );
      const restored = await run(matrixSyncWorkspaceJob, {
        workspaceId: ids.workspaceA,
      });
      expect(restored).toMatchObject({ action: "restore" });
      expect(await joinedMembers(room.roomId)).toContain(owner.userId);

      const io = { transaction: asWorker };
      const purged = await matrixWorkspaceLifecycle.purgeExternal!(
        ids.workspaceA,
        io,
      );
      expect(purged).toMatchObject({ skipped: false });
      expect((purged as { deleted: number }).deleted).toBeGreaterThanOrEqual(1);
      await eventually(async () => {
        const status = await client.request<{ results: { status: string }[] }>(
          "GET",
          `/_synapse/admin/v2/rooms/${enc(room.roomId)}/delete_status`,
        );
        return status.results.some((r) => r.status === "complete");
      }, "room purged on Synapse");
      // Idempotent: closed rows are skipped and an unknown room counts as gone.
      expect(
        await matrixWorkspaceLifecycle.purgeExternal!(ids.workspaceA, io),
      ).toEqual({
        deleted: 0,
        skipped: false,
      });
      await expect(deleteRoom(client, room.roomId)).resolves.toBeTypeOf(
        "boolean",
      );
    });

    it("ends the Matrix sessions of someone who signed out", async () => {
      const session = await createMatrixSession(prisma, ids.userA);
      const logged = await login(session.loginToken);
      expect(
        (
          await asUser(
            logged.access_token,
            "GET",
            "/_matrix/client/v3/account/whoami",
          )
        ).status,
      ).toBe(200);
      const result = await run(matrixLogoutDevicesJob, { userId: ids.userA });
      expect(Number(result?.devices)).toBeGreaterThanOrEqual(1);
      expect(
        (
          await asUser(
            logged.access_token,
            "GET",
            "/_matrix/client/v3/account/whoami",
          )
        ).status,
      ).toBe(401);
    });

    it("deletes a room of the core that no row knows, after an hour", async () => {
      const orphan = await createRoom(client, {});
      // Younger than an hour: kept.
      const early = await asWorker((tx) =>
        matrixCleanupJob.run(tx, { hour: "now" }),
      );
      expect(early).toMatchObject({ orphansDeleted: 0 });
      const late = await asWorker(async (tx) => {
        const { cleanupRooms } = await import("@/core/matrix/rooms");
        return cleanupRooms(tx, client, new Date(Date.now() + 2 * 60 * 60_000));
      });
      expect(late.orphansDeleted).toBeGreaterThanOrEqual(1);
      await eventually(async () => {
        const status = await client.request<{ results: { status: string }[] }>(
          "GET",
          `/_synapse/admin/v2/rooms/${enc(orphan)}/delete_status`,
        );
        return status.results.some((r) => r.status === "complete");
      }, "orphan purged");
    });
  },
);
