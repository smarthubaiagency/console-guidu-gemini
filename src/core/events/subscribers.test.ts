import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EVENT_CATALOG, eventDefinition, MAX_EVENT_DEPTH } from "./catalog";
import { defineSubscriber } from "./subscriber";
import { getSubscriber, listSubscribers, subscribersOf } from "./subscribers";

describe("Event Hub subscribers (H4)", () => {
  it("lists each subscriber once, on types that hand work over", () => {
    const subscribers = listSubscribers();
    expect(subscribers.map((s) => s.key)).toEqual(["proposals.execute"]);
    for (const subscriber of subscribers) {
      expect(getSubscriber(subscriber.key)).toBe(subscriber);
      for (const type of subscriber.eventTypes) {
        expect(
          eventDefinition(type)?.destinations,
          `${subscriber.key} ← ${type}`,
        ).toContain("subscribers");
      }
    }
  });

  it("gives every type with the subscribers destination a subscriber", () => {
    for (const definition of EVENT_CATALOG) {
      if (!definition.destinations.includes("subscribers")) continue;
      expect(subscribersOf(definition.type).length, definition.type).toBe(1);
    }
    expect(subscribersOf("proposals.requested")).toEqual([]);
  });

  it("refuses a malformed subscriber and keeps the chain limit at 5", () => {
    const base = {
      moduleKey: "core",
      eventTypes: ["proposals.approved"] as const,
      description: "Teste",
      handle: async () => undefined,
    };
    expect(() => defineSubscriber({ ...base, key: "Sem Ponto" })).toThrow();
    expect(() =>
      defineSubscriber({ ...base, key: "teste.vazio", eventTypes: [] }),
    ).toThrow();
    expect(defineSubscriber({ ...base, key: "teste.ok" }).key).toBe("teste.ok");
    expect(MAX_EVENT_DEPTH).toBe(5);
  });
});
