import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/core/module-runtime/state", () => ({
  assertModuleOperational: vi.fn(async () => undefined),
}));
vi.mock("@/modules/ai-agents/server", () => ({ runTurn: vi.fn() }));

import type { JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { matrixConfig } from "@/core/matrix/config";
import {
  createSynapseClient,
  type MatrixFetch,
  type SynapseClient,
} from "@/core/matrix/synapse";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import type { HubTurnInput, HubTurnPlan } from "@/modules/ai-agents/server";

import { pickTurnInput, runGuidsTurn } from "./guids-turn";

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

const ROOM = "!sala:hs.test";
const CONSUMER = "@cliente:hs.test";
const TEAM = "@u_aaaaaaaaaaaaaaaaaaaaaaaa:hs.test";
const AGENT = "@_guidu_a_aaaaaaaaaaaaaaaa:hs.test";
const AGENT_ID = "6f1c2b9e-0000-4000-8000-000000000001";

const ctx: RequestContext = {
  userId: "6f1c2b9e-0000-4000-8000-0000000000aa",
  organizationId: "6f1c2b9e-0000-4000-8000-0000000000bb",
  workspaceId: "6f1c2b9e-0000-4000-8000-0000000000cc",
  partnerId: "",
} as RequestContext;

type Event = { event_id: string; sender: string; ts: number; body: string };

const said = (event_id: string, sender: string, ts: number, body: string) => ({
  event_id,
  sender,
  ts,
  body,
});

/**
 * Fake Synapse of one room: the conversation state, the latest messages
 * (newest first, as `dir=b`) and what the agent sends.
 */
function fakeSynapse(input: { status: string[]; events: Event[] }) {
  const sent: {
    txn: string;
    body: string;
    user: string | null;
    content: Record<string, unknown>;
  }[] = [];
  const states: unknown[] = [];
  const typing: boolean[] = [];
  let reads = 0;
  const fetch: MatrixFetch = async (raw, init) => {
    const url = new URL(raw);
    const path = decodeURIComponent(url.pathname);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const reply = (json: unknown, status = 200) =>
      new Response(JSON.stringify(json), { status });
    if (path.endsWith("/state/chat.guidu.conversation/")) {
      if (init.method === "PUT") {
        states.push(body);
        return reply({ event_id: "$state" });
      }
      const status =
        input.status[Math.min(reads, input.status.length - 1)] ?? "pending";
      reads += 1;
      return reply({ status, assignee: null });
    }
    if (path.endsWith("/messages")) {
      return reply({
        chunk: [...input.events].reverse().map((e) => ({
          type: "m.room.message",
          event_id: e.event_id,
          sender: e.sender,
          origin_server_ts: e.ts,
          content: { msgtype: "m.text", body: e.body },
        })),
      });
    }
    const send = /\/send\/m\.room\.message\/(.+)$/.exec(path);
    if (send) {
      sent.push({
        txn: send[1]!,
        body: (body as { body: string }).body,
        user: url.searchParams.get("user_id"),
        content: body as Record<string, unknown>,
      });
      return reply({ event_id: `$sent${sent.length}` });
    }
    if (path.includes("/typing/")) {
      typing.push((body as { typing: boolean }).typing);
      return reply({});
    }
    return reply({ errcode: "M_NOT_FOUND" }, 404);
  };
  return {
    client: createSynapseClient(config, fetch) as SynapseClient,
    sent,
    states,
    typing,
  };
}

/** The job's session over an in-memory stand-in for the tables it reads. */
function fakeSession(cursor: { ts: number; id: string } | null = null) {
  const rows = {
    cursor: cursor
      ? { lastAnsweredTs: BigInt(cursor.ts), lastAnsweredEventId: cursor.id }
      : null,
    handoff: null as unknown,
  };
  const tx = {
    matrixRoom: {
      findFirst: async () => ({ consumerMxid: CONSUMER }),
    },
    workspaceModule: {
      findFirst: async () => ({
        config: {
          guids_agent_id: AGENT_ID,
          service: { max_messages: 2, interval_ms: 700 },
        },
      }),
    },
    matrixAgentUser: {
      findUnique: async () => ({
        mxid: AGENT,
        state: "active",
        workspaceId: ctx.workspaceId,
      }),
    },
    matrixRoomMember: {
      findUnique: async () => ({ membership: "join" }),
    },
    inboxGuidsRoom: {
      findUnique: async () => rows.cursor,
      update: async (args: { data: unknown }) => {
        rows.handoff = args.data;
      },
    },
    // The claim of the turn (insert … on conflict, raw SQL).
    $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      rows.cursor = {
        lastAnsweredEventId: values[4] as string,
        lastAnsweredTs: values[5] as bigint,
      };
      return 1;
    },
  } as unknown as ContextTransaction;
  const session: JobSession = {
    jobRunId: "run-1",
    transaction: (op) => op(tx),
  };
  return { session, rows };
}

function turnAnswering(plan: HubTurnPlan) {
  const calls: HubTurnInput[] = [];
  const turn = vi.fn(
    async (_s: JobSession, _c: RequestContext, input: HubTurnInput) => {
      calls.push(input);
      return plan;
    },
  );
  return { turn, calls };
}

describe("pickTurnInput", () => {
  const client = fakeSynapse({ status: [], events: [] }).client;

  it("answers the consumer's messages after the last answer and the team", () => {
    const messages = [
      said("$1", CONSUMER, 1, "Oi"),
      said("$2", AGENT, 2, "Olá! Como posso ajudar?"),
      said("$3", CONSUMER, 3, "Quero falar com alguém"),
      said("$4", TEAM, 4, "Sou a Bia, já te ajudo"),
      said("$5", CONSUMER, 5, "Obrigado"),
      said("$6", CONSUMER, 6, "Qual o horário?"),
    ].map((e) => ({
      eventId: e.event_id,
      sender: e.sender,
      ts: e.ts,
      body: e.body,
    }));
    const picked = pickTurnInput(client, messages, {
      consumerMxid: CONSUMER,
      lastAnsweredTs: 1,
      lastAnsweredEventId: "$1",
    });
    expect(picked.fresh.map((m) => m.body)).toEqual([
      "Obrigado",
      "Qual o horário?",
    ]);
    // The agent's own message is already in its history.
    expect(picked.context).toEqual([
      { side: "contact", text: "Quero falar com alguém" },
      { side: "team", text: "Sou a Bia, já te ajudo" },
    ]);
  });

  it("keeps what the consumer said to the team as context", () => {
    const picked = pickTurnInput(
      client,
      [
        { eventId: "$s1", sender: AGENT, ts: 1, body: "", status: "open" },
        { eventId: "$1", sender: CONSUMER, ts: 2, body: "Alô?" },
        { eventId: "$s2", sender: TEAM, ts: 3, body: "", status: "pending" },
        { eventId: "$2", sender: CONSUMER, ts: 4, body: "Ainda estão aí?" },
      ],
      {
        consumerMxid: CONSUMER,
        lastAnsweredTs: null,
        lastAnsweredEventId: null,
      },
    );
    expect(picked.fresh.map((m) => m.body)).toEqual(["Ainda estão aí?"]);
    expect(picked.context).toEqual([{ side: "contact", text: "Alô?" }]);
  });

  it("has nothing new when the last message is the team's", () => {
    const picked = pickTurnInput(
      client,
      [
        { eventId: "$1", sender: CONSUMER, ts: 1, body: "Oi" },
        { eventId: "$2", sender: TEAM, ts: 2, body: "Olá" },
      ],
      {
        consumerMxid: CONSUMER,
        lastAnsweredTs: null,
        lastAnsweredEventId: null,
      },
    );
    expect(picked.fresh).toEqual([]);
  });

  it("tells that the conversation was resolved since the last answer (GF2)", () => {
    const input = {
      consumerMxid: CONSUMER,
      lastAnsweredTs: 5,
      lastAnsweredEventId: "$a",
    };
    const resolvedAfter = pickTurnInput(
      client,
      [
        { eventId: "$a", sender: AGENT, ts: 5, body: "Olá" },
        { eventId: "$s", sender: TEAM, ts: 6, body: "", status: "resolved" },
        { eventId: "$1", sender: CONSUMER, ts: 7, body: "Oi de novo" },
      ],
      input,
    );
    expect(resolvedAfter.resolved).toBe(true);
    expect(resolvedAfter.fresh.map((m) => m.body)).toEqual(["Oi de novo"]);
    // A resolution before the last answer is old news.
    const resolvedBefore = pickTurnInput(
      client,
      [
        { eventId: "$s", sender: TEAM, ts: 3, body: "", status: "resolved" },
        { eventId: "$a", sender: AGENT, ts: 5, body: "Olá" },
        { eventId: "$1", sender: CONSUMER, ts: 7, body: "Oi" },
      ],
      input,
    );
    expect(resolvedBefore.resolved).toBe(false);
  });
});

describe("runGuidsTurn (fake Synapse)", () => {
  it("marks the answer of a specialist for the team, under the agent's name (GF2)", async () => {
    const synapse = fakeSynapse({
      status: ["pending"],
      events: [said("$1", CONSUMER, 10, "Quero ver os pacotes")],
    });
    const { session } = fakeSession();
    const { turn, calls } = turnAnswering({
      messages: ["Temos três pacotes."],
      answeredBy: "seller",
      handoff: null,
    });
    await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      { client: synapse.client, turn: turn as never, sleep: async () => {} },
    );
    expect(synapse.sent).toHaveLength(1);
    expect(synapse.sent[0]?.user).toBe(AGENT);
    expect(synapse.sent[0]?.content).toEqual({
      msgtype: "m.text",
      body: "Temos três pacotes.",
      "io.guidu.answered_by": "seller",
    });
    // The turn is told whether the conversation was resolved meanwhile.
    expect(calls[0]).toMatchObject({ reopened: false });
  });

  it("sends no mark when the orchestrator itself answers", async () => {
    const synapse = fakeSynapse({
      status: ["pending"],
      events: [said("$1", CONSUMER, 10, "Qual o horário?")],
    });
    const { session } = fakeSession();
    const { turn } = turnAnswering({
      messages: ["Das 9h às 18h."],
      answeredBy: null,
      handoff: null,
    });
    await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      { client: synapse.client, turn: turn as never, sleep: async () => {} },
    );
    expect(synapse.sent[0]?.content).toEqual({
      msgtype: "m.text",
      body: "Das 9h às 18h.",
    });
  });

  it("answers as the agent's user within the service rules, once", async () => {
    const synapse = fakeSynapse({
      status: ["pending"],
      events: [
        said("$1", CONSUMER, 10, "Oi"),
        said("$2", CONSUMER, 11, "Vocês abrem sábado?"),
      ],
    });
    const { session, rows } = fakeSession();
    const { turn, calls } = turnAnswering({
      messages: ["Olá!", "Abrimos sim.", "Das 9h às 13h."],
      handoff: null,
    });
    const sleep = vi.fn(async () => undefined);
    const result = await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      {
        client: synapse.client,
        turn: turn as never,
        sleep,
      },
    );
    expect(result).toMatchObject({ status: "answered", messages: 2, sent: 2 });
    expect(calls[0]).toMatchObject({
      agentId: AGENT_ID,
      conversation: { hub: "inbox", roomId: ROOM },
      messages: ["Oi", "Vocês abrem sábado?"],
      limits: { maxMessages: 2, maxChars: 300 },
    });
    // At most 2 messages: the extra one joins the last.
    expect(synapse.sent.map((s) => s.body)).toEqual([
      "Olá!",
      "Abrimos sim.\n\nDas 9h às 13h.",
    ]);
    expect(synapse.sent.every((s) => s.user === AGENT)).toBe(true);
    expect(synapse.sent.map((s) => s.txn)).toEqual([
      "guids-run-1-0",
      "guids-run-1-1",
    ]);
    expect(sleep).toHaveBeenCalledWith(700);
    expect(synapse.typing[0]).toBe(true);
    expect(synapse.typing.at(-1)).toBe(false);
    expect(rows.cursor?.lastAnsweredEventId).toBe("$2");

    // The same messages are never answered again.
    const again = await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      {
        client: synapse.client,
        turn: turn as never,
        sleep,
      },
    );
    expect(again).toEqual({ status: "nothing_new" });
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the team has the conversation", async () => {
    const synapse = fakeSynapse({
      status: ["open"],
      events: [said("$1", CONSUMER, 10, "Oi")],
    });
    const { session } = fakeSession();
    const { turn } = turnAnswering({ messages: ["Olá"], handoff: null });
    expect(
      await runGuidsTurn(
        session,
        ctx,
        { roomId: ROOM },
        {
          client: synapse.client,
          turn: turn as never,
        },
      ),
    ).toEqual({ status: "with_team" });
    expect(turn).not.toHaveBeenCalled();
  });

  it("drops the answer when the team took the conversation during the turn", async () => {
    const synapse = fakeSynapse({
      status: ["pending", "open"],
      events: [said("$1", CONSUMER, 10, "Oi")],
    });
    const { session } = fakeSession();
    const { turn } = turnAnswering({ messages: ["Olá"], handoff: null });
    const result = await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      {
        client: synapse.client,
        turn: turn as never,
      },
    );
    expect(result).toMatchObject({ status: "taken_during_turn" });
    expect(synapse.sent).toEqual([]);
  });

  it("hands off: open without an assignee, the summary only in the database", async () => {
    const synapse = fakeSynapse({
      status: ["pending"],
      events: [said("$1", CONSUMER, 10, "Quero falar com uma pessoa")],
    });
    const { session, rows } = fakeSession();
    const { turn } = turnAnswering({
      messages: ["Vou chamar alguém da equipe."],
      handoff: {
        reason: "Pediu uma pessoa.",
        summary: "Cliente quer um humano.",
      },
    });
    const result = await runGuidsTurn(
      session,
      ctx,
      { roomId: ROOM },
      {
        client: synapse.client,
        turn: turn as never,
      },
    );
    expect(result).toMatchObject({ status: "answered", handoff: 1 });
    expect(synapse.states).toEqual([
      { version: 1, status: "open", assignee: null },
    ]);
    expect(rows.handoff).toMatchObject({
      handoffSummary: "Cliente quer um humano.",
      handoffReason: "Pediu uma pessoa.",
    });
    expect(synapse.sent.map((s) => s.body)).toEqual([
      "Vou chamar alguém da equipe.",
    ]);
  });

  it("skips while the agent's user is not registered yet", async () => {
    const synapse = fakeSynapse({ status: ["pending"], events: [] });
    const { session } = fakeSession();
    const tx = {
      matrixRoom: { findFirst: async () => ({ consumerMxid: CONSUMER }) },
      workspaceModule: {
        findFirst: async () => ({ config: { guids_agent_id: AGENT_ID } }),
      },
      matrixAgentUser: { findUnique: async () => null },
      matrixRoomMember: { findUnique: async () => null },
      inboxGuidsRoom: { findUnique: async () => null },
      $queryRaw: vi.fn(async () => []),
    } as unknown as ContextTransaction;
    await expect(
      runGuidsTurn(
        { ...session, transaction: (op) => op(tx) },
        ctx,
        { roomId: ROOM },
        { client: synapse.client },
      ),
    ).rejects.toBeInstanceOf(SkipJobError);
  });
});
