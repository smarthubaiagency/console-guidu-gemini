import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildDashboard } from "./dashboard";
import type { AiPolicy } from "./models";

const policy: AiPolicy = {
  providers: ["openai", "anthropic"],
  models: { openai: ["gpt-5-mini"], anthropic: ["claude-haiku-5-5"] },
};

const usage = (
  group: string | null,
  provider: string,
  requests: number,
  errorCode: string | null = null,
) => ({
  group,
  provider,
  errorCode,
  requests,
  inputTokens: errorCode ? 0 : requests * 10,
  outputTokens: errorCode ? 0 : requests * 2,
});

const agent = (
  over: Partial<{
    kind: string;
    status: string;
    keyState: string;
    provider: string | null;
    model: string | null;
    hasKey: boolean;
    agents: number;
  }>,
) => ({
  kind: "guid",
  status: "active",
  keyState: "ok",
  provider: "openai",
  model: "gpt-5-mini",
  hasKey: true,
  agents: 1,
  ...over,
});

describe("buildDashboard (CF6a)", () => {
  it("sums requests, errors and tokens by provider and by group", () => {
    const dashboard = buildDashboard({
      days: 30,
      policy,
      usage: [
        usage("p1", "openai", 10),
        usage("p1", "openai", 6, "rate_limited"),
        usage("p1", "openai", 2, "invalid_key"),
        usage("p2", "anthropic", 4),
        usage(null, "gemini", 1),
      ],
      agents: [],
      groupNames: new Map([["p1", "Parceiro 1"]]),
      backupConfigured: true,
    });
    expect(dashboard.totals).toEqual({
      requests: 15,
      errors: 8,
      inputTokens: 150,
      outputTokens: 30,
    });
    const openai = dashboard.providers.find((p) => p.provider === "openai");
    expect(openai).toMatchObject({
      requests: 10,
      errors: 8,
      enabled: true,
      topError: "rate_limited",
    });
    expect(
      dashboard.providers.find((p) => p.provider === "gemini")?.enabled,
    ).toBe(false);
    expect(dashboard.groups.map((g) => [g.id, g.name])).toEqual([
      ["p1", "Parceiro 1"],
      ["p2", null],
      [null, null],
    ]);
    expect(dashboard.notices).toEqual([
      { kind: "provider_errors", count: 8, provider: "openai" },
    ]);
  });

  it("raises the notices that need someone", () => {
    const dashboard = buildDashboard({
      days: 7,
      policy,
      usage: [usage("p1", "anthropic", 100), usage("p1", "anthropic", 4, "x")],
      agents: [
        agent({ keyState: "backup", agents: 2 }),
        agent({ keyState: "failed" }),
        agent({ provider: "gemini", model: "gemini-2.5-pro" }),
        agent({ model: "gpt-4o", agents: 3 }),
        agent({ provider: null, model: null }),
        agent({
          kind: "assistant",
          hasKey: false,
          provider: null,
          model: null,
        }),
      ],
      groupNames: new Map(),
      backupConfigured: false,
    });
    expect(dashboard.notices.map((n) => [n.kind, n.count])).toEqual([
      ["backup_missing", 1],
      ["agents_backup", 2],
      ["agents_failed", 1],
      ["provider_off", 1],
      ["model_off", 3],
      ["agents_no_model", 1],
      ["assistant_no_key", 1],
    ]);
  });
});
