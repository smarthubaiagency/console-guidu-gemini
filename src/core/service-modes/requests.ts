import crypto from "node:crypto";

import { AppError, type AppErrorCode } from "@/shared/errors";

/**
 * Requests to move a company to the managed mode (GB1c, ADR 0020). Pure:
 * the token of the secure link, the situation of a request and the errors
 * the database functions raise. The service (`service.ts`) and the worker
 * (`notices.ts`) share it.
 *
 * The link is single use and valid for 7 days from the request; the raw
 * token only exists in the e-mail, the database keeps its SHA-256.
 */

export const SERVICE_MODE_REQUEST_TTL_DAYS = 7;

export const SERVICE_MODE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
] as const;
export type ServiceModeRequestStatus =
  (typeof SERVICE_MODE_REQUEST_STATUSES)[number];

export const SERVICE_MODE_DECISIONS = ["approve", "deny"] as const;
export type ServiceModeDecision = (typeof SERVICE_MODE_DECISIONS)[number];

/** Who asked: the partner, or GUIDU for its direct customers. */
export type ServiceModeRequester = "partner" | "platform";

const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export function hashServiceModeToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** A fresh 256-bit token and its hash. */
export function generateServiceModeToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashServiceModeToken(rawToken) };
}

/** The hash of a token taken from a URL, or null for anything else. */
export function tokenHashOf(
  rawToken: string | null | undefined,
): string | null {
  const token = rawToken?.trim().toLowerCase() ?? "";
  return TOKEN_FORMAT.test(token) ? hashServiceModeToken(token) : null;
}

export function requestExpiresAt(createdAt: Date): Date {
  return new Date(
    createdAt.getTime() + SERVICE_MODE_REQUEST_TTL_DAYS * 24 * 3600 * 1000,
  );
}

export function isServiceModeRequestStatus(
  value: string,
): value is ServiceModeRequestStatus {
  return (SERVICE_MODE_REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * The situation shown for a request: a pending request past its date reads
 * as expired even before anyone touches it (the database marks it when the
 * link is opened, decided or a new request is made).
 */
export function requestSituation(
  status: string,
  expiresAt: Date,
  now: Date = new Date(),
): ServiceModeRequestStatus {
  if (!isServiceModeRequestStatus(status)) return "expired";
  if (status === "pending" && expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return status;
}

/**
 * Transitions a request may take: only a pending one moves, once, to a
 * decision, to expired or to cancelled.
 */
export function canTransition(
  from: ServiceModeRequestStatus,
  to: ServiceModeRequestStatus,
): boolean {
  return from === "pending" && to !== "pending";
}

/** The outcome of `private.service_mode_request_decide`. */
export const DECISION_OUTCOMES = [
  "approved",
  "denied",
  "expired",
  "already_decided",
  "not_found",
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export function decisionOutcome(
  value: string | null | undefined,
): DecisionOutcome {
  return (DECISION_OUTCOMES as readonly string[]).includes(value ?? "")
    ? (value as DecisionOutcome)
    : "not_found";
}

const ERRORS: Readonly<
  Record<string, { code: AppErrorCode; message: string; key: string }>
> = {
  forbidden: {
    code: "forbidden",
    message: "Você não tem permissão para pedir a troca de modo.",
    key: "serviceMode.errors.forbidden",
  },
  not_found: {
    code: "not_found",
    message: "Empresa ou pedido não encontrado.",
    key: "serviceMode.errors.notFound",
  },
  already_managed: {
    code: "conflict",
    message: "A empresa já está no modo gerenciado.",
    key: "serviceMode.errors.alreadyManaged",
  },
  pending_exists: {
    code: "conflict",
    message: "Já existe um pedido pendente para esta empresa.",
    key: "serviceMode.errors.pendingExists",
  },
  no_owner: {
    code: "conflict",
    message: "A empresa ainda não tem um owner para aprovar o pedido.",
    key: "serviceMode.errors.noOwner",
  },
  no_workspace: {
    code: "conflict",
    message: "A empresa não tem um workspace ativo.",
    key: "serviceMode.errors.noWorkspace",
  },
  invalid: {
    code: "invalid_input",
    message: "Dados inválidos.",
    key: "serviceMode.errors.invalid",
  },
};

/**
 * The AppError of a database error raised as `service_mode:<code>`, or
 * null for any other error.
 */
export function serviceModeError(error: unknown): AppError | null {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? "")}`
      : String(error);
  const match = /service_mode:([a-z_]+)/.exec(text);
  const known = match ? ERRORS[match[1]!] : undefined;
  if (!known) return null;
  return new AppError({
    code: known.code,
    safeMessage: known.message,
    messageKey: known.key,
    cause: error,
  });
}

export function serviceModeFailure(key: keyof typeof ERRORS): AppError {
  const known = ERRORS[key]!;
  return new AppError({
    code: known.code,
    safeMessage: known.message,
    messageKey: known.key,
  });
}

// ---------------------------------------------------------------------------
// Links (the host where the request was made)
// ---------------------------------------------------------------------------

export function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** Where the owner follows the mode of the company. */
export function settingsUrlOf(origin: string, workspaceSlug: string): string {
  return `${trimOrigin(origin)}/app/${workspaceSlug}/settings/service-mode`;
}

/** Where the side that asked follows its companies. */
export function consoleUrlOf(
  origin: string,
  via: ServiceModeRequester,
): string {
  return `${trimOrigin(origin)}/${via === "platform" ? "platform" : "admin"}/customers`;
}

/** The page of the secure link. */
export function linkUrlOf(origin: string, rawToken: string): string {
  return `${trimOrigin(origin)}/service-mode/${rawToken}`;
}
