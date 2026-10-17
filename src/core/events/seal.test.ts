import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  chainKeyOf,
  checkSeal,
  computeSeal,
  currentSealKey,
  EventsKeyMissingError,
  type SealMaterial,
  sealedText,
  sealKeys,
} from "./seal";

const KEY = "k".repeat(40);

const material: SealMaterial = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "ai.agent.key_backup",
  partnerId: "00000000-0000-4000-8000-000000000000",
  organizationId: "a0000000-0000-4000-8000-000000000010",
  workspaceId: "a0000000-0000-4000-8000-000000000011",
  subjectType: "ai_agent",
  subjectId: "22222222-2222-4222-8222-222222222222",
  createdBy: null,
  occurredAt: new Date("2026-10-16T12:00:00.123Z"),
  data: { workspaceName: "Loja", backupUntil: "2026-10-17T12:00:00.000Z" },
  prevHash: null,
};

describe("event seal (H1)", () => {
  it("writes canonical JSON with the keys sorted at every level", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }),
    ).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ b: undefined, a: "x" })).toBe('{"a":"x"}');
    // The order of the input never changes the text.
    expect(
      sealedText({
        ...material,
        data: { backupUntil: "x", workspaceName: "y" },
      }),
    ).toBe(
      sealedText({
        ...material,
        data: { workspaceName: "y", backupUntil: "x" },
      }),
    );
  });

  it("is the HMAC-SHA256 of the canonical content with the key", () => {
    const seal = computeSeal(material, KEY);
    expect(seal).toMatch(/^[0-9a-f]{64}$/);
    expect(seal).toBe(
      createHmac("sha256", KEY).update(sealedText(material)).digest("hex"),
    );
    // Another key, another seal: the data cannot be found by trying.
    expect(computeSeal(material, "x".repeat(40))).not.toBe(seal);
    // Dates in the data seal as JSON text.
    expect(
      computeSeal(
        { ...material, data: { at: new Date("2026-10-17T12:00:00Z") } },
        KEY,
      ),
    ).toBe(
      computeSeal(
        { ...material, data: { at: "2026-10-17T12:00:00.000Z" } },
        KEY,
      ),
    );
  });

  it("detects any change of data, ids, moment, author or previous seal", () => {
    const keys = new Map([["k1", KEY]]);
    const seal = computeSeal(material, KEY);
    expect(checkSeal(material, seal, "k1", keys)).toBe("ok");
    const changed: SealMaterial[] = [
      {
        ...material,
        data: { ...(material.data as object), workspaceName: "Outra" },
      },
      { ...material, workspaceId: "a0000000-0000-4000-8000-000000000021" },
      { ...material, occurredAt: new Date("2026-10-16T12:00:00.124Z") },
      { ...material, createdBy: "a0000000-0000-4000-8000-000000000031" },
      { ...material, prevHash: "0".repeat(64) },
      { ...material, type: "ai.agent.key_paused" },
    ];
    for (const item of changed) {
      expect(checkSeal(item, seal, "k1", keys)).toBe("mismatch");
    }
    expect(checkSeal(material, seal, "k0", keys)).toBe("unknown_key");
  });

  it("refuses to seal without the key and keeps the previous keys to verify", () => {
    expect(() => currentSealKey({})).toThrow(EventsKeyMissingError);
    expect(() =>
      currentSealKey({ EVENTS_HMAC_KEY: "curta", EVENTS_HMAC_KEY_ID: "k1" }),
    ).toThrow(/32 caracteres/);
    expect(() => currentSealKey({ EVENTS_HMAC_KEY: KEY })).toThrow(
      /EVENTS_HMAC_KEY_ID/,
    );
    expect(
      currentSealKey({ EVENTS_HMAC_KEY: KEY, EVENTS_HMAC_KEY_ID: "k2" }),
    ).toEqual({ version: "k2", secret: KEY });
    const keys = sealKeys({
      EVENTS_HMAC_KEY: KEY,
      EVENTS_HMAC_KEY_ID: "k2",
      EVENTS_HMAC_KEYS_PREVIOUS: `k1:${"o".repeat(40)},bad,k0:curta`,
    });
    expect([...keys.keys()].sort()).toEqual(["k1", "k2"]);
    const old = computeSeal(material, "o".repeat(40));
    expect(checkSeal(material, old, "k1", keys)).toBe("ok");
  });

  it("chains by workspace, else partner, else the platform", () => {
    expect(chainKeyOf({ workspaceId: "w", partnerId: "p" })).toBe("ws:w");
    expect(chainKeyOf({ workspaceId: null, partnerId: "p" })).toBe("partner:p");
    expect(chainKeyOf({ workspaceId: null, partnerId: null })).toBe("platform");
  });
});

describe("event seal with a cause (H4)", () => {
  it("keeps the canonical text and the seals made before H4", () => {
    // The exact text an event without a cause had in H1: the field is
    // absent, not null, so every older seal still verifies.
    const before = createHmac("sha256", KEY)
      .update(
        canonicalJson({
          id: material.id,
          type: material.type,
          partner_id: material.partnerId,
          organization_id: material.organizationId,
          workspace_id: material.workspaceId,
          subject_type: material.subjectType,
          subject_id: material.subjectId,
          created_by: material.createdBy,
          occurred_at: material.occurredAt.toISOString(),
          data: material.data,
          prev_hash: material.prevHash,
        }),
      )
      .digest("hex");
    expect(computeSeal(material, KEY)).toBe(before);
    expect(computeSeal({ ...material, causedBy: null }, KEY)).toBe(before);
    const keys = new Map([["k1", KEY]]);
    expect(checkSeal({ ...material, causedBy: null }, before, "k1", keys)).toBe(
      "ok",
    );
  });

  it("seals the cause when there is one", () => {
    const caused = {
      ...material,
      causedBy: "33333333-3333-4333-8333-333333333333",
    };
    expect(sealedText(caused)).toContain(
      '"caused_by":"33333333-3333-4333-8333-333333333333"',
    );
    const seal = computeSeal(caused, KEY);
    expect(seal).not.toBe(computeSeal(material, KEY));
    const keys = new Map([["k1", KEY]]);
    expect(checkSeal(caused, seal, "k1", keys)).toBe("ok");
    // Removing the cause breaks the seal.
    expect(checkSeal(material, seal, "k1", keys)).toBe("mismatch");
  });
});
