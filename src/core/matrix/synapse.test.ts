import { generateKeyPairSync } from "node:crypto";

import { vi, describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { handleAppServiceRequest } from "./appservice";
import { matrixConfig } from "./config";
import { reduceEvent } from "./events";
import {
  conversationRoomBody,
  createSynapseClient,
  deleteAllDevices,
  deleteRoom,
  kick,
  MatrixHttpError,
  type MatrixFetch,
  setUserPowers,
  upsertUser,
} from "./synapse";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config = matrixConfig({
  MATRIX_HOMESERVER_URL: "https://hs.test",
  MATRIX_SERVER_NAME: "hs.test",
  MATRIX_AS_TOKEN: "as-token",
  MATRIX_HS_TOKEN: "hs-token",
  MATRIX_JWT_PRIVATE_KEY: privateKey,
})!;

type Call = {
  method: string;
  path: string;
  query: string;
  auth: string | null;
  body: unknown;
};

/** Fake Synapse: answers by `METHOD path`, records every call. */
function fakeSynapse(
  routes: Record<string, (call: Call) => { status?: number; json?: unknown }>,
): { fetch: MatrixFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: MatrixFetch = async (input, init) => {
    const url = new URL(input);
    const call: Call = {
      method: init.method ?? "GET",
      path: decodeURIComponent(url.pathname),
      query: url.search,
      auth: new Headers(init.headers).get("authorization"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    const answer = handler
      ? handler(call)
      : { status: 404, json: { errcode: "M_NOT_FOUND" } };
    return new Response(JSON.stringify(answer.json ?? {}), {
      status: answer.status ?? 200,
    });
  };
  return { fetch, calls };
}

describe("Synapse calls", () => {
  it("use the as_token and never put the query in an error", async () => {
    const fake = fakeSynapse({});
    const client = createSynapseClient(config, fake.fetch);
    const error = await client
      .request("GET", "/_matrix/client/v3/x", {
        asUser: "@_guidu_agent:hs.test",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MatrixHttpError);
    expect((error as MatrixHttpError).message).not.toContain("user_id");
    expect(fake.calls[0]).toMatchObject({
      auth: "Bearer as-token",
      query: "?user_id=%40_guidu_agent%3Ahs.test",
    });
  });

  it("creates an account without password and retries a creation that lost a race", async () => {
    let attempts = 0;
    const fake = fakeSynapse({
      "PUT /_synapse/admin/v2/users/@u_a:hs.test": () =>
        ++attempts === 1
          ? { status: 400, json: { errcode: "M_USER_IN_USE" } }
          : { status: 201 },
    });
    await upsertUser(
      createSynapseClient(config, fake.fetch),
      "@u_a:hs.test",
      "Ana",
    );
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.body).toEqual({
      displayname: "Ana",
      deactivated: false,
      admin: false,
    });
  });

  it("changes the power levels in one event, and not at all when nothing changes", async () => {
    const state = {
      users: { "@u_a:hs.test": 50 },
      events: { "m.room.encryption": 100 },
    };
    const fake = fakeSynapse({
      "GET /_matrix/client/v3/rooms/!r/state/m.room.power_levels/": () => ({
        json: state,
      }),
      "PUT /_matrix/client/v3/rooms/!r/state/m.room.power_levels/": () => ({
        json: { event_id: "$p" },
      }),
    });
    const client = createSynapseClient(config, fake.fetch);
    await setUserPowers(client, "!r", { "@u_a:hs.test": 50 });
    expect(fake.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await setUserPowers(client, "!r", {
      "@u_a:hs.test": null,
      "@u_b:hs.test": 50,
    });
    const put = fake.calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({
      users: { "@u_b:hs.test": 50 },
      events: { "m.room.encryption": 100 },
    });
  });

  it("treats a kick of someone not in the room and a room already gone as done", async () => {
    const fake = fakeSynapse({
      "POST /_matrix/client/v3/rooms/!r/kick": () => ({
        status: 403,
        json: { errcode: "M_FORBIDDEN" },
      }),
      "DELETE /_synapse/admin/v2/rooms/!gone": () => ({
        status: 404,
        json: { errcode: "M_NOT_FOUND" },
      }),
      "DELETE /_synapse/admin/v2/rooms/!r": (call) => {
        expect(call.body).toEqual({ purge: true, block: false });
        return { json: { delete_id: "d1" } };
      },
    });
    const client = createSynapseClient(config, fake.fetch);
    expect(await kick(client, "!r", "@u_a:hs.test", "x")).toBe(false);
    expect(await deleteRoom(client, "!gone")).toBe(false);
    expect(await deleteRoom(client, "!r")).toBe(true);
  });

  it("deletes every device of a person", async () => {
    const fake = fakeSynapse({
      "GET /_synapse/admin/v2/users/@u_a:hs.test/devices": () => ({
        json: { devices: [{ device_id: "A" }, { device_id: "B" }] },
      }),
      "POST /_synapse/admin/v2/users/@u_a:hs.test/delete_devices": () => ({
        json: {},
      }),
    });
    expect(
      await deleteAllDevices(
        createSynapseClient(config, fake.fetch),
        "@u_a:hs.test",
      ),
    ).toBe(2);
    expect(fake.calls[1]!.body).toEqual({ devices: ["A", "B"] });
  });

  it("builds the room of the proof: v12, no guests, no encryption, state at 50, sending at 10", () => {
    const body = conversationRoomBody({
      powers: { "@u_a:hs.test": 10, "@u_b:hs.test": 0 },
    }) as Record<string, unknown>;
    expect(body).toMatchObject({
      room_version: "12",
      preset: "private_chat",
      invite: [],
    });
    const power = body["power_level_content_override"] as {
      users: Record<string, number>;
      events: Record<string, number>;
      state_default: number;
      events_default: number;
      users_default: number;
      invite: number;
    };
    // Who only reads stays at the default 0 (IN4a).
    expect(power.users).toEqual({ "@u_a:hs.test": 10 });
    expect(power.users_default).toBe(0);
    expect(power.events_default).toBe(10);
    expect(power.invite).toBe(50);
    expect(power.state_default).toBe(100);
    expect(power.events["m.room.encryption"]).toBe(100);
    expect(power.events["m.room.power_levels"]).toBe(100);
    expect(power.events["chat.guidu.conversation"]).toBe(50);
    expect(body["initial_state"]).toEqual(
      expect.arrayContaining([
        {
          type: "m.room.guest_access",
          state_key: "",
          content: { guest_access: "forbidden" },
        },
        {
          type: "chat.guidu.conversation",
          state_key: "",
          content: { version: 1, status: "pending", assignee: null },
        },
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("m.megolm");
  });
});

describe("events of the Application Service", () => {
  it("keeps a message only as a mark, without its text (IN4b)", () => {
    expect(
      reduceEvent({
        event_id: "$m",
        room_id: "!r",
        type: "m.room.message",
        sender: "@c:hs.test",
        origin_server_ts: 42,
        content: { msgtype: "m.text", body: "segredo" },
      }),
    ).toEqual({
      event_id: "$m",
      room_id: "!r",
      type: "m.room.message",
      state_key: null,
      sender: "@c:hs.test",
      origin_server_ts: 42,
      content: { msgtype: "m.text" },
    });
  });

  it("keeps the language guessed from a message, never its text (TR1)", () => {
    const reduced = reduceEvent({
      event_id: "$m",
      room_id: "!r",
      type: "m.room.message",
      sender: "@c:hs.test",
      origin_server_ts: 42,
      content: {
        msgtype: "m.text",
        body: "¡Hola! ¿Tienen paseo en barco para mañana?",
      },
    });
    expect(reduced?.content).toMatchObject({ msgtype: "m.text", locale: "es" });
    expect(Number(reduced?.content.locale_confidence)).toBeGreaterThan(0.6);
    expect(JSON.stringify(reduced)).not.toContain("barco");
    // A file's name is not a message to read the language from.
    expect(
      reduceEvent({
        event_id: "$f",
        room_id: "!r",
        type: "m.room.message",
        sender: "@c:hs.test",
        content: { msgtype: "m.file", body: "¿Tienen paseo mañana?.pdf" },
      })?.content,
    ).toEqual({ msgtype: "m.file" });
  });

  it("keeps only membership (with the display name) and the conversation state, never a message body", () => {
    expect(
      reduceEvent({
        event_id: "$1",
        room_id: "!r",
        type: "m.room.member",
        state_key: "@a:hs.test",
        sender: "@a:hs.test",
        origin_server_ts: 10,
        content: {
          membership: "join",
          displayname: "Ana",
          avatar_url: "mxc://x",
        },
      }),
    ).toEqual({
      event_id: "$1",
      room_id: "!r",
      type: "m.room.member",
      state_key: "@a:hs.test",
      sender: "@a:hs.test",
      origin_server_ts: 10,
      content: { membership: "join", displayname: "Ana" },
    });
    expect(
      reduceEvent({
        event_id: "$2",
        room_id: "!r",
        type: "chat.guidu.conversation",
        state_key: "",
        sender: "@a:hs.test",
        content: {
          version: 1,
          status: "open",
          assignee: "@a:hs.test",
          note: "x",
        },
      })?.content,
    ).toEqual({ status: "open", assignee: "@a:hs.test", by: null });
    expect(
      reduceEvent({
        event_id: "$3",
        room_id: "!r",
        type: "m.room.message",
        sender: "@a:hs.test",
        content: { body: "oi" },
      })?.content,
    ).toEqual({ msgtype: null });
    expect(
      reduceEvent({
        event_id: "$4",
        room_id: "!r",
        type: "chat.guidu.conversation",
        state_key: "x",
        sender: "@a:hs.test",
        content: {},
      }),
    ).toBeNull();
    expect(
      reduceEvent({
        event_id: "$5",
        room_id: "!r",
        type: "m.room.member",
        state_key: "@a:hs.test",
        sender: "@a:hs.test",
        content: { membership: "weird" },
      }),
    ).toBeNull();
  });
});

describe("route of the Application Service", () => {
  const recorded: unknown[][] = [];
  const prisma = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      recorded.push(values);
      return [{ matrix_as_ingest: 1 }];
    },
  } as never;
  const call = (
    method: string,
    path: string[],
    init: RequestInit = {},
    token = "hs-token",
  ) =>
    handleAppServiceRequest(
      new Request("https://console.test/api/matrix/as/x", {
        method,
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      }),
      path,
      { prisma, config },
    );
  const v1 = (...rest: string[]) => ["_matrix", "app", "v1", ...rest];

  it("answers 404 while Matrix is off", async () => {
    const response = await handleAppServiceRequest(
      new Request("https://console.test/x", { method: "POST" }),
      v1("ping"),
      { prisma, config: null },
    );
    expect(response.status).toBe(404);
  });

  it("checks the hs_token, also in the query", async () => {
    expect((await call("POST", v1("ping"), {}, "wrong")).status).toBe(403);
    expect((await call("POST", v1("ping"), {}, "")).status).toBe(403);
    const query = await handleAppServiceRequest(
      new Request("https://console.test/x?access_token=hs-token", {
        method: "POST",
      }),
      v1("ping"),
      { prisma, config },
    );
    expect(query.status).toBe(200);
  });

  it("answers the ping and the queries of users and rooms", async () => {
    expect(
      await (await call("POST", v1("ping"), { body: "{}" })).json(),
    ).toEqual({});
    const user = await call("GET", v1("users", "@_guidu_x:hs.test"));
    expect(user.status).toBe(404);
    expect(await user.json()).toMatchObject({ errcode: "M_NOT_FOUND" });
    expect((await call("GET", v1("rooms", "#_guidu_x:hs.test"))).status).toBe(
      404,
    );
    expect(
      (await call("GET", ["_matrix", "app", "unstable", "x"])).status,
    ).toBe(404);
  });

  it("records the reduced events of a transaction and answers {} at once", async () => {
    recorded.length = 0;
    const response = await call("PUT", v1("transactions", "42"), {
      body: JSON.stringify({
        events: [
          {
            event_id: "$m",
            room_id: "!r",
            type: "m.room.message",
            sender: "@c:hs.test",
            content: { body: "segredo" },
          },
          {
            event_id: "$j",
            room_id: "!r",
            type: "m.room.member",
            state_key: "@c:hs.test",
            sender: "@c:hs.test",
            content: { membership: "join" },
          },
        ],
        ephemeral: [],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    const [txnId, count, events] = recorded[0] as [string, number, string];
    expect(txnId).toBe("42");
    expect(count).toBe(2);
    // The message is a mark (IN4b): recorded, without its text.
    expect(events).not.toContain("segredo");
    expect(JSON.parse(events)).toHaveLength(2);
  });

  it("refuses a body that is not JSON and asks Synapse to retry when the database fails", async () => {
    expect(
      (await call("PUT", v1("transactions", "1"), { body: "{" })).status,
    ).toBe(400);
    const failing = {
      $queryRaw: async () => {
        throw new Error("db down");
      },
    } as never;
    const response = await handleAppServiceRequest(
      new Request("https://console.test/x", {
        method: "PUT",
        headers: { authorization: "Bearer hs-token" },
        body: JSON.stringify({ events: [] }),
      }),
      v1("transactions", "2"),
      { prisma: failing, config },
    );
    expect(response.status).toBe(500);
  });
});
