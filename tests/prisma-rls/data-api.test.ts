import { describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const describeApi = url && anonKey ? describe : describe.skip;

describeApi("Data API remains closed for domain tables", () => {
  it("does not allow anon to read spike_notes", async () => {
    const response = await fetch(`${url}/rest/v1/spike_notes?select=id`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });
});

