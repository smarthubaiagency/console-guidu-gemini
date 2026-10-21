import { z } from "zod";

/**
 * Delegation between the factory GUIDS (GF2, docs/architecture/plano-tr3-gf2.md;
 * agentes na Matrix §2.2, §4.2 and §7.1): the orchestrator answers the simple
 * and hands the rest to the attendant or the seller, in one level. The
 * specialist answers with the orchestrator's name; the conversation stays
 * with it until it returns it, the conversation is resolved or the contact is
 * silent for 24 h.
 *
 * Everything here is pure: the contract of the tools, which specialists a
 * turn may offer and when a delegation ends. The turn (`turn/guid.ts`) and
 * the tools (`tools/catalog.ts`) apply it on every call.
 */

/** The roles an orchestrator may hand a conversation to. */
export const DELEGATE_TARGETS = ["attendant", "seller"] as const;
export type DelegateTarget = (typeof DELEGATE_TARGETS)[number];

/** Version of the contract of `delegate` and `return_to_reception`. */
export const DELEGATION_CONTRACT_VERSION = 1;

/**
 * `delegate`, validated on the server at every call, whatever the model
 * sent: the version, one of the two destinations, the reason and the summary
 * for the specialist (who the contact is, what they want, what was said).
 */
export const DelegateContract = z.strictObject({
  version: z.literal(DELEGATION_CONTRACT_VERSION),
  to: z.enum(DELEGATE_TARGETS),
  reason: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(1500),
});
export type DelegateContract = z.infer<typeof DelegateContract>;

/** `return_to_reception`: the specialist gives the conversation back. */
export const ReturnContract = z.strictObject({
  version: z.literal(DELEGATION_CONTRACT_VERSION),
  reason: z.string().trim().min(1).max(500),
});
export type ReturnContract = z.infer<typeof ReturnContract>;

/** How long a specialist keeps the conversation without a message of the contact. */
export const DELEGATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Delegations of one message of the contact (the budget, §7.1). */
export const MAX_DELEGATIONS_PER_TURN = 1;

/** Invalid calls of `delegate` in a turn before it goes to the team. */
export const MAX_INVALID_DELEGATIONS = 2;

/** Least time left in the turn for the specialist to still be worth running. */
export const MIN_SPECIALIST_MS = 5_000;

/** The state of an agent, as the choice of specialists reads it. */
export type SpecialistRow = Readonly<{
  id: string;
  factoryRole: string | null;
  status: string;
  keyState: string;
  name: string | null;
}>;

export type Specialist = Readonly<{
  id: string;
  name: string;
}>;

export type Specialists = Partial<Record<DelegateTarget, Specialist>>;

/**
 * A GUIDS that answers contacts now: turned on (that needs a key and a
 * passed test, A4b) and with a key that has not failed. A paused one, a
 * draft or one whose key failed is not offered.
 */
export function isOn(row: Pick<SpecialistRow, "status" | "keyState">): boolean {
  return row.status === "active" && row.keyState !== "failed";
}

/**
 * The specialists the orchestrator may be offered: the factory attendant and
 * seller that are on. Only those: the tool does not list the others, and
 * with none the orchestrator goes on as before.
 */
export function pickSpecialists(rows: readonly SpecialistRow[]): Specialists {
  const out: { -readonly [K in DelegateTarget]?: Specialist } = {};
  for (const role of DELEGATE_TARGETS) {
    const row = rows.find((r) => r.factoryRole === role && isOn(r));
    if (row) out[role] = { id: row.id, name: row.name ?? role };
  }
  return out;
}

/** Whether a role of the factory may hold the `delegate` tool. */
export function mayDelegate(factoryRole: string | null): boolean {
  return factoryRole === "orchestrator";
}

/** Whether a role of the factory may hold the `return_to_reception` tool. */
export function mayReturn(factoryRole: string | null): boolean {
  return factoryRole === "attendant" || factoryRole === "seller";
}

/** The delegation of a conversation is still in force at `now`. */
export function delegationActive(
  conversation: Readonly<{
    delegatedAgentId: string | null;
    delegatedUntil: Date | null;
  }>,
  now: Date,
): boolean {
  return (
    conversation.delegatedAgentId !== null &&
    conversation.delegatedUntil !== null &&
    conversation.delegatedUntil.getTime() > now.getTime()
  );
}

/** When the delegation ends if the contact says nothing more. */
export function delegationUntil(now: Date): Date {
  return new Date(now.getTime() + DELEGATION_TTL_MS);
}

/** What is left of the turn's time, never below zero. */
export function remainingMs(
  startedAt: number,
  totalMs: number,
  now: number,
): number {
  return Math.max(0, startedAt + totalMs - now);
}
