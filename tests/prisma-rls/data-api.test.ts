import { expect, it } from "vitest";
import { describeDatabase } from "./describe-database.js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const requiredVars = { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey };

describeDatabase("Data API remains closed for domain tables", requiredVars, () => {
  it("does not allow anon to read spike_notes", async () => {
    const response = await fetch(`${url}/rest/v1/spike_notes?select=id`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });
});

