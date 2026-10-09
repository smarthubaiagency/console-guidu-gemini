/**
 * ============================================================================
 * File: src/shared/errors/api-response.ts
 * Module: Unified REST Error Response Formatter (Spec §15)
 *
 * Maintenance Rationale:
 * - Emits standardized `{ error: { code, message, requestId } }` response envelope.
 * - Maps AppErrorCode to appropriate HTTP status codes (401, 403, 404, 409, 422, 429, 502, 503, 500).
 * - Never includes stack traces or raw sensitive data.
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { type AppErrorCode, toSafeError } from "./app-error";

export function httpStatusFromCode(code: AppErrorCode): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "invalid_input":
      return 422;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "provider_error":
      return 502;
    case "internal":
    default:
      return 500;
  }
}

export function apiErrorResponse(err: unknown, requestId?: string): NextResponse {
  const isAccessDenied =
    Boolean(err) &&
    typeof err === "object" &&
    (err as { name?: string }).name === "AccessDeniedError";

  const safe = toSafeError(err, requestId);
  const reason = isAccessDenied
    ? (err as { reason?: string }).reason
    : undefined;
  const status = isAccessDenied
    ? (err as { status?: number }).status ??
      (reason === "unauthenticated" ? 401 : 403)
    : httpStatusFromCode(safe.code);

  const errorPayload: { code: string; message: string; requestId: string } = {
    code: isAccessDenied
      ? (err as { reason?: string }).reason ?? safe.code
      : safe.code,
    message: safe.safeMessage,
    requestId: safe.requestId,
  };

  return NextResponse.json(
    {
      error: errorPayload,
    },
    { status },
  );
}
