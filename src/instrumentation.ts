/**
 * Runs once when the web server starts (Next.js instrumentation). Checks the
 * environment before the first request (F6a); `next build` is skipped, since
 * it runs without the production secrets.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertEnv } = await import("@/core/config/env");
  assertEnv("web");
}
