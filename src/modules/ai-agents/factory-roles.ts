/**
 * The roles of the four factory GUIDS (GF1), in the order they are created
 * when the plan limit does not fit them all: the front door first, ops
 * last. Shared by the server and the tests.
 */

export const FACTORY_ROLES = [
  "orchestrator",
  "attendant",
  "seller",
  "ops",
] as const;

export type FactoryRole = (typeof FACTORY_ROLES)[number];

export function isFactoryRole(value: unknown): value is FactoryRole {
  return (
    typeof value === "string" &&
    (FACTORY_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Which missing roles fit under the limit, in the order of
 * `FACTORY_ROLES` (the front door first, ops last).
 */
export function rolesToCreate(
  missing: readonly FactoryRole[],
  count: number,
  limit: number | null,
): FactoryRole[] {
  const ordered = FACTORY_ROLES.filter((role) => missing.includes(role));
  if (limit === null) return ordered;
  return ordered.slice(0, Math.max(0, limit - count));
}
