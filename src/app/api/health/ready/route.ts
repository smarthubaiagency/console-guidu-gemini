import { NextResponse } from "next/server";

import { checkReadiness, HEALTH_HEADERS } from "@/core/operations/health";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Readiness (F3d): 200 while the database answers, 503 otherwise. The body
 * names the failing check only, never the error.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkReadiness(prisma);
  if (!result.ready) {
    appLog.warn("health.not_ready", { checks: result.checks });
  }
  return NextResponse.json(
    { status: result.ready ? "ok" : "unavailable", checks: result.checks },
    { status: result.ready ? 200 : 503, headers: HEALTH_HEADERS },
  );
}
