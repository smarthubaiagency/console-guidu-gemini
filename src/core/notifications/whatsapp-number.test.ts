import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeE164 } from "./whatsapp-number";

describe("Meu WhatsApp: E.164 (H2)", () => {
  it("normalizes Brazilian and international numbers", () => {
    expect(normalizeE164("(11) 91234-5678")).toBe("+5511912345678");
    expect(normalizeE164("011 91234-5678")).toBe("+5511912345678");
    expect(normalizeE164("+55 11 91234-5678")).toBe("+5511912345678");
    expect(normalizeE164("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizeE164("00 351 912 345 678")).toBe("+351912345678");
  });

  it("refuses what cannot be a phone", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164("+0 11 1234")).toBeNull();
    expect(normalizeE164("abc 11 91234 5678")).toBeNull();
  });
});
