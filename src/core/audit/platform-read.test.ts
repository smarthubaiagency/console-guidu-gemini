import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  auditSearchParams,
  EMPTY_AUDIT_FILTERS,
  encodeAuditCursor,
  parseAuditCursor,
  parseAuditFilters,
  periodBounds,
} from "./platform-filters";
import {
  listPlatformAuditEvents,
  loadAuditFilterOptions,
} from "./platform-read";

const P = "b7000000-0000-4000-8000-000000000015";
const O = "a0000000-0000-4000-8000-000000000020";
const W = "a0000000-0000-4000-8000-000000000021";
const U = "a0000000-0000-4000-8000-000000000032";
const E1 = "c6000000-0000-4000-8000-000000000001";
const E2 = "c6000000-0000-4000-8000-000000000002";

describe("parseAuditFilters", () => {
  it("keeps valid filters and normalizes them", () => {
    expect(
      parseAuditFilters({
        partner: P.toUpperCase(),
        organization: O,
        workspace: W,
        action: " Billing. ",
        result: "denied",
        origin: "worker",
        actor: U,
        from: "2026-10-01",
        to: "2026-10-16",
      }),
    ).toEqual({
      partnerId: P,
      organizationId: O,
      workspaceId: W,
      action: "billing.",
      result: "denied",
      origin: "worker",
      actorUserId: U,
      from: "2026-10-01",
      to: "2026-10-16",
    });
  });

  it("drops anything malformed instead of sending it to the database", () => {
    expect(
      parseAuditFilters({
        partner: "not-a-uuid",
        organization: ["a", "b"],
        workspace: "",
        action: "billing%' or 1=1",
        result: "maybe",
        origin: "browser",
        actor: "x".repeat(36),
        from: "2026-02-30",
        to: "16/10/2026",
      }),
    ).toEqual(EMPTY_AUDIT_FILTERS);
  });

  it("keeps only the start of a period that ends before it starts", () => {
    const filters = parseAuditFilters({ from: "2026-10-16", to: "2026-10-01" });
    expect(filters.from).toBe("2026-10-16");
    expect(filters.to).toBeNull();
  });
});

describe("periodBounds", () => {
  it("reads whole days in the platform time zone, the end exclusive", () => {
    expect(
      periodBounds({
        ...EMPTY_AUDIT_FILTERS,
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual({
      from: "2026-10-01T00:00:00-03:00",
      to: "2026-11-01T00:00:00-03:00",
    });
    expect(periodBounds(EMPTY_AUDIT_FILTERS)).toEqual({ from: null, to: null });
  });
});

describe("audit cursor", () => {
  it("round-trips with microseconds", () => {
    const cursor = { at: "2026-10-16T12:00:00.123456Z", id: E1 };
    expect(parseAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  it("refuses anything else", () => {
    expect(parseAuditCursor(undefined)).toBeNull();
    expect(parseAuditCursor("2026-10-16T12:00:00Z")).toBeNull();
    expect(parseAuditCursor(`yesterday_${E1}`)).toBeNull();
    expect(
      parseAuditCursor(`2026-10-16T12:00:00Z_${"z".repeat(36)}`),
    ).toBeNull();
    expect(parseAuditCursor([`2026-10-16T12:00:00Z_${E1}`])).toBeNull();
  });

  it("travels in the query string with the filters", () => {
    const query = auditSearchParams(
      { ...EMPTY_AUDIT_FILTERS, result: "error", partnerId: P },
      `2026-10-16T12:00:00.000001Z_${E1}`,
    );
    const params = new URLSearchParams(query);
    expect(params.get("partner")).toBe(P);
    expect(params.get("result")).toBe("error");
    expect(params.has("organization")).toBe(false);
    expect(parseAuditCursor(params.get("before")!)?.id).toBe(E1);
    expect(auditSearchParams(EMPTY_AUDIT_FILTERS)).toBe("");
  });
});

type Call = { sql: string; values: unknown[] };

function row(id: string, minute: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    occurred_at: new Date(
      `2026-10-16T12:${String(minute).padStart(2, "0")}:00Z`,
    ),
    cursor_at: `2026-10-16T12:${String(minute).padStart(2, "0")}:00.000042Z`,
    action: "billing.plan.create",
    result: "success",
    origin: "admin",
    actor_user_id: U,
    actor_principal_type: "user",
    represented_user_id: null,
    organization_id: O,
    workspace_id: W,
    partner_id: P,
    resource_type: "plan",
    resource_id: null,
    client_id: null,
    request_id: null,
    metadata: { name: "Pro" },
    is_security: false,
    ...extra,
  };
}

/** A transaction whose raw queries answer by the function they read. */
function fakeTx(events: unknown[]) {
  const calls: Call[] = [];
  const tx = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        calls.push({ sql, values });
        if (sql.includes("platform_audit_events")) return events;
        if (sql.includes("list_admin_organizations"))
          return [{ id: O, name: "Organization B" }];
        if (sql.includes("list_admin_workspaces"))
          return [
            { id: W, name: "Workspace B", organization_name: "Organization B" },
          ];
        if (sql.includes("list_admin_users"))
          return [{ id: U, full_name: "Bia" }];
        return [];
      },
    ),
    partner: {
      findMany: vi.fn(async () => [{ id: P, name: "Agência AUD1" }]),
    },
    partnerMember: {
      findMany: vi.fn(async () => [{ userId: U, email: "bia@aud1.test" }]),
    },
  };
  return { tx: tx as never, calls, raw: tx };
}

describe("listPlatformAuditEvents", () => {
  it("passes every filter and the cursor to the database function", async () => {
    const { tx, calls } = fakeTx([]);
    await listPlatformAuditEvents(tx, "support", {
      filters: parseAuditFilters({
        partner: P,
        organization: O,
        workspace: W,
        action: "partner.",
        result: "error",
        origin: "app",
        actor: U,
        from: "2026-10-01",
        to: "2026-10-02",
      }),
      cursor: { at: "2026-10-16T12:00:00.123456Z", id: E1 },
      limit: 10,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("private.platform_audit_events(");
    expect(calls[0]!.values).toEqual([
      P,
      O,
      W,
      "partner.",
      "error",
      "app",
      U,
      "2026-10-01T00:00:00-03:00",
      "2026-10-03T00:00:00-03:00",
      "2026-10-16T12:00:00.123456Z",
      E1,
      11,
    ]);
  });

  it("sends nulls without filters and asks one row more than the page", async () => {
    const { tx, calls } = fakeTx([]);
    const page = await listPlatformAuditEvents(tx, "owner");
    expect(calls[0]!.values).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      51,
    ]);
    expect(page).toEqual({ events: [], next: null });
  });

  it("returns the next cursor from the last row shown, with microseconds", async () => {
    const { tx } = fakeTx([
      row(E1, 59),
      row(E2, 58),
      row(E2.replace(/2$/, "3"), 57),
    ]);
    const page = await listPlatformAuditEvents(tx, "owner", { limit: 2 });
    expect(page.events.map((e) => e.id)).toEqual([E1, E2]);
    expect(page.next).toBe(`2026-10-16T12:58:00.000042Z_${E2}`);
    expect(parseAuditCursor(page.next!)).toEqual({
      at: "2026-10-16T12:58:00.000042Z",
      id: E2,
    });
  });

  it("has no next cursor on the last page", async () => {
    const { tx } = fakeTx([row(E1, 59)]);
    expect(
      (await listPlatformAuditEvents(tx, "owner", { limit: 2 })).next,
    ).toBeNull();
  });

  it("resolves names through what the platform reads", async () => {
    const { tx } = fakeTx([
      row(E1, 59),
      row(E2, 58, {
        actor_user_id: null,
        actor_principal_type: "service",
        organization_id: null,
        workspace_id: null,
        partner_id: "not-a-uuid",
        metadata: null,
        is_security: true,
      }),
    ]);
    const [first, second] = (await listPlatformAuditEvents(tx, "billing"))
      .events;
    expect(first).toMatchObject({
      actorName: "Bia",
      organizationName: "Organization B",
      workspaceName: "Workspace B",
      partnerName: "Agência AUD1",
      metadata: { name: "Pro" },
      occurredAt: "2026-10-16T12:59:00.000Z",
    });
    expect(second).toMatchObject({
      actorName: null,
      organizationName: null,
      workspaceName: null,
      partnerId: "not-a-uuid",
      partnerName: null,
      metadata: {},
      isSecurity: true,
    });
  });

  it("falls back to the partner member e-mail when the profile has no name", async () => {
    const { tx, raw } = fakeTx([row(E1, 59)]);
    raw.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("platform_audit_events")) return [row(E1, 59)];
      if (sql.includes("list_admin_users")) return [{ id: U, full_name: null }];
      return [];
    });
    const [event] = (await listPlatformAuditEvents(tx, "owner")).events;
    expect(event!.actorName).toBe("bia@aud1.test");
  });

  it("refuses a viewer without a platform role before touching the database", async () => {
    const { tx, calls } = fakeTx([]);
    await expect(listPlatformAuditEvents(tx, null)).rejects.toThrow();
    await expect(loadAuditFilterOptions(tx, null)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("loadAuditFilterOptions", () => {
  it("lists partners, companies and workspaces", async () => {
    const { tx } = fakeTx([]);
    expect(await loadAuditFilterOptions(tx, "billing")).toEqual({
      partners: [{ id: P, name: "Agência AUD1" }],
      organizations: [{ id: O, name: "Organization B" }],
      workspaces: [
        { id: W, name: "Workspace B", organizationName: "Organization B" },
      ],
    });
  });
});
