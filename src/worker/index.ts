/**
 * Worker process entry point (ADR 0002, F3a): `pnpm worker`.
 *
 * Connects as `app_worker` through WORKER_DATABASE_URL (direct connection or
 * session pooler; polling also works through the transaction pooler). Runs
 * with the `react-server` condition so server-only modules load as they do
 * in the web runtime. Stops gracefully on SIGTERM/SIGINT.
 */
import { createJobWorker } from "./runtime";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      JSON.stringify({
        level: "error",
        source: "worker",
        event: "config.missing",
        message: "WORKER_DATABASE_URL is required (app_worker connection).",
      }),
    );
    process.exit(1);
  }

  const worker = createJobWorker({
    databaseUrl,
    concurrency: positiveInt(process.env.WORKER_CONCURRENCY, 4),
    instanceName: process.env.WORKER_INSTANCE_NAME ?? "worker",
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(
      JSON.stringify({
        level: "info",
        source: "worker",
        event: "signal",
        signal,
      }),
    );
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  await worker.start();
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      source: "worker",
      event: "worker.crashed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
