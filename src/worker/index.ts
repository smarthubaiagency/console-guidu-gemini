/**
 * Worker process entry point (ADR 0002, F3a): `pnpm worker`.
 *
 * Connects as `app_worker` through WORKER_DATABASE_URL (direct connection or
 * session pooler; polling also works through the transaction pooler). Runs
 * with the `react-server` condition so server-only modules load as they do
 * in the web runtime. Stops gracefully on SIGTERM/SIGINT.
 *
 * F3d: logs are structured JSON lines with source "worker"; with
 * WORKER_HEALTH_PORT set, /health/live and /health/ready answer on it.
 */
import type { Server } from "node:http";

import { createLogger, setLogSource } from "@/lib/telemetry/log";

import { startHealthServer } from "./health";
import { createJobWorker } from "./runtime";

setLogSource("worker");
const log = createLogger("worker");

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    log.error("config.missing", {
      message: "WORKER_DATABASE_URL is required (app_worker connection).",
    });
    process.exit(1);
  }

  const worker = createJobWorker({
    databaseUrl,
    concurrency: positiveInt(process.env.WORKER_CONCURRENCY, 4),
    ...(process.env.WORKER_INSTANCE_NAME
      ? { instanceName: process.env.WORKER_INSTANCE_NAME }
      : {}),
  });

  let healthServer: Server | null = null;
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker.signal", { signal });
    healthServer?.close();
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  const healthPort = positiveInt(process.env.WORKER_HEALTH_PORT, 0);
  if (healthPort > 0) {
    healthServer = await startHealthServer(healthPort, worker.health);
    log.info("worker.health_listening", { port: healthPort });
  }
  await worker.start();
}

main().catch((error: unknown) => {
  log.error("worker.crashed", { error });
  process.exit(1);
});
