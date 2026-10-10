import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Log convention (F3d): application code writes logs only through
 * src/lib/telemetry/log.ts, so every line is structured and redacted.
 */
const ROOT = join(process.cwd(), "src");
const ALLOWED = new Set(["lib/telemetry/log.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe("log convention", () => {
  it("has no direct console calls outside the logger", () => {
    const offenders = sourceFiles(ROOT)
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) =>
        /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(
          readFileSync(join(ROOT, path), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
