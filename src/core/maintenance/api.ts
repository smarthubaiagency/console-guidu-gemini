import { NextResponse } from "next/server";

import { englishText } from "@/core/i18n/english";

import { apiRefusal, type MaintenanceStatus, retryAfterSeconds } from "./state";

/**
 * Answer of the public API and the workspace MCP during a maintenance
 * window (CF5c): 503 with `Retry-After` (seconds until the end, or 10
 * minutes without one). Full maintenance refuses every call; read-only
 * refuses the writes. The platform API and MCP never ask this.
 */

const FALLBACK = {
  maintenance: "GUIDU is under maintenance. Try again later.",
  read_only:
    "GUIDU is read-only during maintenance. Reads work; writes are refused.",
} as const;

export function maintenanceApiResponse(
  status: MaintenanceStatus,
  method: string,
  requestId: string,
  now: Date = new Date(),
): NextResponse | null {
  const refusal = apiRefusal(status, method);
  if (!refusal) return null;
  const key =
    refusal === "maintenance"
      ? "maintenance.api.closed"
      : "maintenance.api.readOnly";
  return NextResponse.json(
    {
      error: {
        code: refusal,
        message: englishText(key) ?? FALLBACK[refusal],
        requestId,
      },
    },
    {
      status: 503,
      headers: {
        "retry-after": String(retryAfterSeconds(status, now)),
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}
