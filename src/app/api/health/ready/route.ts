import { NextResponse } from "next/server";

import { checkReadiness, HEALTH_HEADERS } from "@/core/operations/health";
import { prisma } from "@/lib/prisma/client";
import { checkRedis } from "@/lib/redis/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Readiness (F3d): 200 while the database answers, 503 otherwise. The body
 * names the failing check only, never the error. Redis (F4a) is reported
 * but does not decide readiness: rate limits fall back to the database.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [result, redis] = await Promise.all([
    checkReadiness(prisma),
    checkRedis(),
  ]);
  const checks = { ...result.checks, redis };
  if (!result.ready || redis === "fail") {
    appLog.warn("health.not_ready", { checks });
  }
  return NextResponse.json(
    { status: result.ready ? "ok" : "unavailable", checks },
    { status: result.ready ? 200 : 503, headers: HEALTH_HEADERS },
  );
}
