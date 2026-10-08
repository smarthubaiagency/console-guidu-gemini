import { expect, it } from "vitest";
import { requiredDatabaseSuite } from "./database-suite.js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const describeApi = requiredDatabaseSuite(
  "Data API remains closed for domain tables",
  ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
);

describeApi("Data API remains closed for domain tables", () => {
  it("does not allow anon to read spike_notes", async () => {
    const response = await fetch(`${url}/rest/v1/spike_notes?select=id`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });
});
