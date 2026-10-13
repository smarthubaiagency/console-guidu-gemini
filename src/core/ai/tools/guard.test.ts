import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ModuleUnavailableError } from "@/core/modules/availability";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { AppError } from "@/shared/errors";

import {
  ToolRestrictedError,
  decideTool,
  guardToolCall,
  maskPersonalData,
  sha256,
} from "./guard";

const messages = {
  denied: "negada",
  restricted: (reason: string) => `restrita: ${reason}`,
  failed: (errorId: string) => `falhou (${errorId})`,
};

const guard = (
  run: () => Promise<unknown>,
  overrides: Partial<{
    tool: string;
    allowlist: string[];
    onError: (errorId: string, error: unknown) => void;
  }> = {},
) =>
  guardToolCall({
    tool: overrides.tool ?? "create_contact",
    toolCallId: "call-1",
    input: { email: "maria@example.com", phone: "+55 11 98765-4321" },
    kind: "guid",
    allowlist: overrides.allowlist ?? ["create_contact", "add_tag"],
    run,
    messages,
    ...(overrides.onError ? { onError: overrides.onError } : {}),
  });

describe("tool decisions", () => {
  it("allows only catalog tools of the kind in the allowlist", () => {
    expect(decideTool("think", "guid", ["think"]).decision).toBe("allow");
    expect(decideTool("drop_table", "guid", ["drop_table"])).toMatchObject({
      decision: "deny",
      rule: "unknown_tool",
    });
    expect(decideTool("toString", "guid", [])).toMatchObject({
      decision: "deny",
      rule: "unknown_tool",
    });
    expect(
      decideTool("workspace_read", "guid", ["workspace_read"]),
    ).toMatchObject({ decision: "deny", rule: "kind_not_allowed" });
    expect(decideTool("handoff", "guid", ["think"])).toMatchObject({
      decision: "deny",
      rule: "not_in_allowlist",
    });
    expect(decideTool("add_tag", "guid", ["add_tag"])).toMatchObject({
      decision: "restrict",
      rule: "feature_disabled",
    });
  });
});

describe("hashes and masking", () => {
  it("hashes the canonical JSON", () => {
    expect(sha256({ b: 1, a: 2 })).toBe(sha256({ a: 2, b: 1 }));
    expect(sha256(undefined)).toBe(sha256(null));
    expect(sha256({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("masks personal data and keeps identifiers", () => {
    expect(
      maskPersonalData({
        email: "maria@example.com",
        phone: "+55 11 98765-4321",
        name: "Maria Souza",
        key: "lead_status",
        id: "a0000000-0000-4000-8000-000000000010",
        count: 3,
        list: ["Rua das Flores, 10"],
      }),
    ).toEqual({
      email: "m***@example.com",
      phone: "+** ** *****-**21",
      name: "M*** (11)",
      key: "lead_status",
      id: "a0000000-0000-4000-8000-000000000010",
      count: 3,
      list: ["R*** (18)"],
    });
  });
});

describe("guarded calls", () => {
  it("runs an allowed tool and records hashes and the masked input", async () => {
    const run = vi.fn().mockResolvedValue({ contactId: "c1" });
    const { output, record } = await guard(run);
    expect(run).toHaveBeenCalledOnce();
    expect(output).toEqual({ ok: true, result: { contactId: "c1" } });
    expect(record).toMatchObject({
      tool: "create_contact",
      toolCallId: "call-1",
      decision: "allow",
      outputHash: sha256(output),
      errorId: null,
    });
    expect(record.payload).not.toContain("maria@");
    expect(record.payload).not.toContain("98765");
  });

  it("does not run a denied or restricted tool", async () => {
    const run = vi.fn();
    const denied = await guard(run, { tool: "handoff" });
    expect(denied.output).toEqual({ ok: false, error: "negada" });
    expect(denied.record).toMatchObject({
      decision: "deny",
      rule: "not_in_allowlist",
    });
    const restricted = await guard(run, { tool: "add_tag" });
    expect(restricted.output.ok).toBe(false);
    expect(restricted.record.decision).toBe("restrict");
    expect(run).not.toHaveBeenCalled();
  });

  it("turns restrictions and permissions into safe messages", async () => {
    const own = await guard(async () => {
      throw new ToolRestrictedError("no_contact", "Sem contato.");
    });
    expect(own.output).toEqual({ ok: false, error: "restrita: Sem contato." });
    expect(own.record).toMatchObject({
      decision: "restrict",
      rule: "no_contact",
    });

    for (const error of [
      new PermissionDeniedError(),
      new ModuleUnavailableError("crm"),
      new AppError({ code: "forbidden", safeMessage: "Proibido." }),
    ]) {
      const { output, record } = await guard(async () => {
        throw error;
      });
      expect(output.ok).toBe(false);
      expect(record).toMatchObject({
        decision: "restrict",
        rule: "permission",
      });
    }
  });

  it("shows the domain's message of an AppError", async () => {
    const { output, record } = await guard(async () => {
      throw new AppError({ code: "conflict", safeMessage: "Já existe." });
    });
    expect(output).toEqual({ ok: false, error: "Já existe." });
    expect(record).toMatchObject({ decision: "allow", reason: "conflict" });
  });

  it("hides an internal failure behind an error id", async () => {
    const onError = vi.fn();
    const { output, record } = await guard(
      async () => {
        throw new Error("connection to 10.0.0.5 failed: password=secret");
      },
      { onError },
    );
    expect(output.ok).toBe(false);
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(record.decision).toBe("error");
    expect(record.errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(output).toMatchObject({ errorId: record.errorId });
    expect(onError).toHaveBeenCalledWith(record.errorId, expect.any(Error));
  });
});
