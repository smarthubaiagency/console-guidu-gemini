import "dotenv/config";
import { expect, it } from "vitest";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * D1 / ADR 0001: the Supabase Data API stays closed for every domain table.
 * This is an HTTP-level proof against the real core tables — PostgREST is not
 * the same surface as the SQL tests, because it connects as `anon` /
 * `authenticated` on its own.
 *
 * Replaces the spike-era tests/prisma-rls/data-api.test.ts, which only covered
 * the (now removed) spike_notes table.
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const requiredVars = { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey };

const domainTables = [
  "profiles",
  "organizations",
  "organization_members",
  "workspaces",
  "workspace_members",
  "platform_admin_members",
  "invitations",
  "credentials",
  "api_keys",
] as const;

describeDatabase("Data API remains closed for core domain tables", requiredVars, () => {
  it.each(domainTables)("denies anon reads of %s over HTTP", async (table) => {
    const response = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });

  it("does not expose the private helper schema through RPC", async () => {
    const response = await fetch(`${url}/rest/v1/rpc/resolve_workspace_slug`, {
      method: "POST",
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_slug: "workspace-a" }),
    });
    expect(response.ok).toBe(false);
  });
});
