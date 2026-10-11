import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { allowedTools, originAllowed } from "./server";
import { MCP_WORKSPACE_TOOLS } from "./tools";

const request = (headers: Record<string, string>) =>
  new Request("http://app.test/mcp/workspace", { method: "POST", headers });

describe("workspace MCP (F4b)", () => {
  it("accepts clients without Origin and browsers of the same host only", () => {
    expect(originAllowed(request({ host: "app.test" }))).toBe(true);
    expect(
      originAllowed(request({ host: "app.test", origin: "https://app.test" })),
    ).toBe(true);
    expect(
      originAllowed(request({ host: "app.test", origin: "https://evil.test" })),
    ).toBe(false);
    expect(
      originAllowed(request({ host: "app.test", origin: "nonsense" })),
    ).toBe(false);
  });

  it("filters tools by the key's scopes and the role's permissions", () => {
    const all = () => true;
    expect(allowedTools(["workspace:read"], all).map((t) => t.name)).toEqual([
      "get_workspace",
      "get_workspace_overview",
    ]);
    const noMembers = (p: string) => p !== "workspace.members.read";
    expect(
      allowedTools(["members:read", "workspace:read"], noMembers).map(
        (t) => t.name,
      ),
    ).not.toContain("list_workspace_members");
    expect(allowedTools([], all)).toEqual([]);
  });

  it("declares every tool as read-only, except the proposal, with strict inputs and no workspace argument", () => {
    for (const tool of MCP_WORKSPACE_TOOLS) {
      // Writes only by proposal (F4d): propose_operation records, never runs.
      expect(tool.risk).toBe(
        tool.name === "propose_operation" ? "propose" : "read",
      );
      expect(Object.keys(tool.input.shape)).not.toContain("workspaceId");
      expect(tool.input.safeParse({ workspaceId: "x" }).success).toBe(false);
    }
    expect(new Set(MCP_WORKSPACE_TOOLS.map((t) => t.name)).size).toBe(
      MCP_WORKSPACE_TOOLS.length,
    );
  });
});
