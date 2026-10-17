import "server-only";

import { proposalExecuteSubscriber } from "@/core/proposals/subscriber";

import type { EventSubscriber } from "./subscriber";

/**
 * Subscribers of the Event Hub (H4), by explicit import (like the proposal
 * operations of F4d): adding one is a code change with its tests. Each
 * event type a subscriber receives must have the `subscribers` destination
 * in the catalog (checked by `subscribers.test.ts`).
 */
const SUBSCRIBERS: readonly EventSubscriber[] = [
  // F4d in the hub: the approval of a proposal hands its execution over.
  proposalExecuteSubscriber,
];

const BY_KEY: ReadonlyMap<string, EventSubscriber> = new Map(
  SUBSCRIBERS.map((subscriber) => [subscriber.key, subscriber]),
);

if (BY_KEY.size !== SUBSCRIBERS.length) {
  throw new Error("Duplicated subscriber in the registry");
}

export function listSubscribers(): readonly EventSubscriber[] {
  return SUBSCRIBERS;
}

export function getSubscriber(key: string): EventSubscriber | null {
  return BY_KEY.get(key) ?? null;
}

/** The subscribers of an event type, in the order of the registry. */
export function subscribersOf(type: string): readonly EventSubscriber[] {
  return SUBSCRIBERS.filter((subscriber) =>
    (subscriber.eventTypes as readonly string[]).includes(type),
  );
}
