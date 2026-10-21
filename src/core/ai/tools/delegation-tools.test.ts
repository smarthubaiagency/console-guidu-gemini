import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAgentConfig } from "../config/schema";
import type { TurnDelegation, TurnState } from "../turn/types";

import {
  buildTools,
  offeredTools,
  recordRefusedCall,
  type ToolEnv,
} from "./catalog";

/**
 * GF2: the engine tools follow the factory role whatever the list of tools
 * says, and every call of `delegate` is validated on the server.
 */

const config = (tools: string[]) => {
  const parsed = parseAgentConfig("guid", 1, {
    overview: { agent_name: "Recepção", language: "pt-BR" },
    integration: { tools },
  });
  if (!parsed.success) throw parsed.error;
  return parsed.data;
};

const ALL = ["think", "handoff", "delegate", "return_to_reception"];
const BOTH = {
  attendant: { id: "att", name: "Atendente" },
  seller: { id: "sel", name: "Vendedor" },
};

describe("which tools a GUIDS is offered (GF2)", () => {
  it("offers delegate only to the orchestrator, with a specialist on", () => {
    const withSpecialists: TurnDelegation = {
      specialists: BOTH,
      returnTo: null,
    };
    expect(
      offeredTools("guid", config(ALL), {
        factoryRole: "orchestrator",
        delegation: withSpecialists,
      }),
    ).toContain("delegate");
    // No specialist on: the orchestrator goes on as before.
    expect(
      offeredTools("guid", config(ALL), {
        factoryRole: "orchestrator",
        delegation: { specialists: {}, returnTo: null },
      }),
    ).not.toContain("delegate");
    // Any other GUIDS never has it, even with the tool in its list.
    for (const factoryRole of ["attendant", "seller", "ops", null]) {
      expect(
        offeredTools("guid", config(ALL), {
          factoryRole,
          delegation: withSpecialists,
        }),
      ).not.toContain("delegate");
    }
    expect(offeredTools("guid", config(ALL))).not.toContain("delegate");
  });

  it("offers return_to_reception only to a specialist that was handed the conversation", () => {
    const handed: TurnDelegation = { specialists: {}, returnTo: "orc" };
    for (const factoryRole of ["attendant", "seller"]) {
      expect(
        offeredTools("guid", config(ALL), { factoryRole, delegation: handed }),
      ).toContain("return_to_reception");
      // Chosen directly for the room: nowhere to go back to.
      expect(
        offeredTools("guid", config(ALL), {
          factoryRole,
          delegation: { specialists: {}, returnTo: null },
        }),
      ).not.toContain("return_to_reception");
    }
    for (const factoryRole of ["orchestrator", "ops", null]) {
      expect(
        offeredTools("guid", config(ALL), { factoryRole, delegation: handed }),
      ).not.toContain("return_to_reception");
    }
  });

  it("records a call to a tool that is not offered as a denial", () => {
    const state: TurnState = {
      contactId: null,
      status: "active",
      memory: {},
      records: [],
    };
    recordRefusedCall(
      {
        kind: "guid",
        config: config(ALL),
        state,
        factoryRole: "seller",
        delegation: { specialists: BOTH, returnTo: null },
      },
      "delegate",
      "call-1",
      { version: 1 },
    );
    expect(state.records[0]).toMatchObject({
      tool: "delegate",
      decision: "deny",
    });
  });
});

type Output = { ok: boolean; error?: string; result?: unknown };

function setup(
  options: Partial<{
    specialists: TurnDelegation["specialists"];
    simulate: boolean;
  }> = {},
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const state: TurnState = {
    contactId: null,
    status: "active",
    memory: {},
    records: [],
  };
  const env: ToolEnv = {
    kind: "guid",
    executionId: "11111111-1111-4111-8111-111111111111",
    agentId: "orc",
    conversationId: "22222222-2222-4222-8222-222222222222",
    config: config(ALL),
    locale: "pt-BR",
    db: {
      transaction: (op) =>
        op({ aiConversation: { updateMany } } as never) as never,
    },
    workspace: {
      userId: "u",
      workspaceId: "w",
      organizationId: "o",
    } as never,
    prisma: null,
    now: () => new Date("2026-10-21T12:00:00Z"),
    state,
    simulate: options.simulate ?? false,
    factoryRole: "orchestrator",
    delegation: {
      specialists: options.specialists ?? BOTH,
      returnTo: null,
    },
  };
  const tools = buildTools(env);
  const call = async (input: Record<string, unknown>) => {
    const tool = tools.delegate as unknown as {
      execute: (
        input: unknown,
        options: { toolCallId: string; messages: never[] },
      ) => Promise<Output>;
    };
    return tool.execute(input, { toolCallId: "c1", messages: [] });
  };
  return { env, state, call, updateMany };
}

const valid = {
  version: 1,
  to: "seller",
  reason: "Quer comprar",
  summary: "Maria quer o pacote de 3 diárias",
};

describe("the delegate tool (GF2)", () => {
  it("hands over to a specialist that is on, once per turn", async () => {
    const { state, call } = setup();
    const first = await call(valid);
    expect(first).toMatchObject({
      ok: true,
      result: { delegated: true, to: "seller" },
    });
    expect(state.delegation).toEqual({
      to: "seller",
      agentId: "sel",
      reason: valid.reason,
      summary: valid.summary,
    });
    // A second hand-over in the same message of the contact is refused.
    const second = await call({ ...valid, to: "attendant" });
    expect(second.ok).toBe(false);
    expect(state.delegation?.to).toBe("seller");
    expect(state.records.at(-1)).toMatchObject({ rule: "already_delegated" });
  });

  it("never lets an argument choose the agent: only the offered roles", async () => {
    const { state, call } = setup({ specialists: { seller: BOTH.seller } });
    const refused = await call({ ...valid, to: "attendant" });
    expect(refused.ok).toBe(false);
    expect(state.delegation).toBeUndefined();
    expect(state.records.at(-1)).toMatchObject({ rule: "specialist_off" });
    const other = await call({ ...valid, to: "orchestrator" });
    expect(other.ok).toBe(false);
    expect(state.records.at(-1)).toMatchObject({ rule: "invalid_contract" });
    expect(state.delegation).toBeUndefined();
  });

  it("validates the contract at every call and hands over to the team on the second invalid one", async () => {
    const { state, call, updateMany } = setup();
    const first = await call({ ...valid, version: 2 });
    expect(first.ok).toBe(false);
    expect(state.status).toBe("active");
    expect(state.records.at(-1)).toMatchObject({ rule: "invalid_contract" });
    const second = await call({ ...valid, summary: "" });
    expect(second).toMatchObject({ ok: true, result: { handed_over: true } });
    expect(state.status).toBe("handoff");
    expect(state.handoff?.reason).toMatch(/duas vezes/);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "22222222-2222-4222-8222-222222222222", status: "active" },
      data: { status: "handoff" },
    });
    expect(state.delegation).toBeUndefined();
  });

  it("does not delegate after the conversation went to the team", async () => {
    const { state, call } = setup();
    state.status = "handoff";
    const refused = await call(valid);
    expect(refused.ok).toBe(false);
    expect(state.delegation).toBeUndefined();
  });

  it("in a test hands over too, saying it is simulated", async () => {
    const { call } = setup({ simulate: true });
    expect(await call(valid)).toMatchObject({
      ok: true,
      result: { delegated: true, simulated: true },
    });
  });
});
