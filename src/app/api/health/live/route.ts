import { NextResponse } from "next/server";

import { HEALTH_HEADERS } from "@/core/operations/health";

/** Liveness (F3d): the process answers. No database, no details. */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: HEALTH_HEADERS });
}
