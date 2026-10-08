import { describe } from "vitest";

const databaseRequired = process.env.REQUIRE_DATABASE_TESTS === "true";
type Suite = (name: string, factory: () => void) => unknown;

export function requiredDatabaseSuite(
  label: string,
  variables: string[],
): Suite {
  const missing = variables.filter((variable) => !process.env[variable]);

  if (databaseRequired && missing.length > 0) {
    throw new Error(
      `database test configuration missing: ${missing.join(", ")}`,
    );
  }

  if (missing.length === 0) return (name, factory) => describe(name, factory);
  return (name, factory) =>
    describe.skip(
      `${name} [skip: database credentials not configured for ${label}: ${missing.join(", ")}]`,
      factory,
    );
}

export function hostedOnlySuite(_label: string, variable: string): Suite {
  if (process.env[variable]) return (name, factory) => describe(name, factory);

  return (name, factory) =>
    describe.skip(
      `${name} [skip: hosted-only: Supavisor local does not register custom roles]`,
      factory,
    );
}
