import { describe, it } from "vitest";

function formatMissing(keys: string[]): string {
  return keys.join(", ");
}

export function describeDatabase(
  name: string,
  requiredVars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const missing = Object.entries(requiredVars)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (process.env.DATABASE_REQUIRED === "1") {
    if (missing.length > 0) {
      describe(name, () => {
        it(`fails: DATABASE_REQUIRED=1 but missing ${formatMissing(missing)}`, () => {
          throw new Error(
            `DATABASE_REQUIRED=1 but required env var(s) missing: ${formatMissing(missing)}`,
          );
        });
      });
    } else {
      describe(name, fn);
    }
    return;
  }

  if (missing.length === 0) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skip: missing ${formatMissing(missing)})`, fn);
  }
}