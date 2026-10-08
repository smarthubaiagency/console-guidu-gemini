import "server-only";
import { NextResponse } from "next/server";

import { isAccessDeniedError } from "./errors";

const SAFE_MESSAGE = {
  unauthenticated: "Autenticação necessária.",
  identity_blocked: "Identidade bloqueada.",
  mfa_required: "Verificação em duas etapas necessária.",
} as const;

/**
 * Turns a guard failure into the REST error contract of section 15: a code, a
 * message that reveals nothing about other accounts, and a correlation id.
 *
 * Returns `null` when the error is not an access denial, so the caller
 * rethrows instead of hiding a real fault behind a 403.
 */
export function accessDeniedResponse(error: unknown): NextResponse | null {
  if (!isAccessDeniedError(error)) return null;

  return NextResponse.json(
    {
      error: { code: error.reason, message: SAFE_MESSAGE[error.reason] },
      requestId: crypto.randomUUID(),
    },
    { status: error.status },
  );
}
