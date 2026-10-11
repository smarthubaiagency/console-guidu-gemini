/**
 * ============================================================================
 * File: src/shared/errors/app-error.ts
 * Module: Secure Application Error Classification & Mapping
 *
 * Maintenance Rationale:
 * - Implements Spec Section 15 & AC07:
 *   - Error outputs return typed code, safe localized message, and requestId.
 *   - Internal exceptions, provider responses, stack traces, and credentials
 *     are never leaked to clients.
 *   - Structured server logs record correlation metadata with secret redaction.
 * ============================================================================
 */

import crypto from "node:crypto";
import { appLog } from "@/lib/telemetry/log";

import { redact } from "./redact";

export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "rate_limited"
  | "unavailable"
  | "provider_error"
  | "internal";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly safeMessage: string;
  readonly requestId: string;
  readonly cause?: unknown;
  /**
   * Full message key (I2), such as `errors.permissionDenied` or
   * `team.errors.lastOwner`, translated where the error is shown;
   * `safeMessage` stays the Portuguese text for logs and fallback.
   */
  readonly messageKey: string | undefined;
  readonly messageValues: Record<string, string | number> | undefined;

  constructor(params: {
    code: AppErrorCode;
    safeMessage: string;
    requestId?: string;
    cause?: unknown;
    messageKey?: string;
    messageValues?: Record<string, string | number>;
  }) {
    super(params.safeMessage);
    this.name = "AppError";
    this.code = params.code;
    this.safeMessage = params.safeMessage;
    this.requestId = params.requestId ?? crypto.randomUUID();
    this.cause = params.cause;
    this.messageKey = params.messageKey;
    this.messageValues = params.messageValues;
  }
}

export type SafeErrorResult = {
  code: AppErrorCode;
  safeMessage: string;
  requestId: string;
  /** Full message key, when the message has a translation. */
  messageKey?: string;
  messageValues?: Record<string, string | number>;
};

/**
 * Maps known domain exceptions or arbitrary errors to a safe, sanitized error
 * contract containing code, Portuguese safeMessage, and requestId.
 */
export function toSafeError(
  err: unknown,
  requestId?: string,
  options?: { log?: boolean },
): SafeErrorResult {
  const reqId =
    (err instanceof AppError ? err.requestId : undefined) ??
    requestId ??
    crypto.randomUUID();
  let code: AppErrorCode = "internal";
  let safeMessage = "Não foi possível concluir a operação.";
  let messageKey: string | undefined = "errors.generic";
  let messageValues: Record<string, string | number> | undefined;

  if (err instanceof AppError) {
    code = err.code;
    safeMessage = err.safeMessage;
    messageKey = err.messageKey;
    messageValues = err.messageValues;
  } else if (isSpecificError(err, "AccessDeniedError")) {
    const reason = (err as { reason?: string }).reason;
    if (reason === "unauthenticated") {
      code = "unauthenticated";
      safeMessage = "Autenticação necessária.";
      messageKey = "errors.unauthenticated";
    } else if (reason === "identity_blocked") {
      code = "forbidden";
      safeMessage = "Identidade bloqueada.";
      messageKey = "errors.identityBlocked";
    } else if (reason === "mfa_required") {
      code = "forbidden";
      safeMessage = "Verificação em duas etapas necessária.";
      messageKey = "errors.mfaRequired";
    } else {
      code = "forbidden";
      safeMessage = "Acesso negado.";
      messageKey = "errors.accessDenied";
    }
  } else if (
    isSpecificError(err, "PermissionDeniedError") ||
    isSpecificError(err, "PlatformAdminAccessDeniedError")
  ) {
    code = "forbidden";
    safeMessage = "Você não tem permissão para esta ação.";
    messageKey = "errors.permissionDenied";
  } else if (isSpecificError(err, "InsufficientRoleError")) {
    code = "forbidden";
    safeMessage = "Papel insuficiente para executar esta operação.";
    messageKey = "errors.insufficientRole";
  } else if (isSpecificError(err, "InvitationRecipientMismatchError")) {
    code = "forbidden";
    safeMessage = "Este convite foi enviado para outro e-mail.";
    messageKey = "errors.invitationRecipientMismatch";
  } else if (isSpecificError(err, "InvitationEmailUnconfirmedError")) {
    code = "forbidden";
    safeMessage =
      "O seu e-mail precisa estar confirmado para aceitar o convite.";
    messageKey = "errors.invitationEmailUnconfirmed";
  } else if (
    isSpecificError(err, "WorkspaceNotFoundError") ||
    isSpecificError(err, "NotAMemberError")
  ) {
    code = "not_found";
    safeMessage = "Workspace não encontrado.";
    messageKey = "errors.workspaceNotFound";
  } else if (isSpecificError(err, "CredentialNotFoundError")) {
    code = "not_found";
    safeMessage = "Credencial não encontrada.";
    messageKey = "errors.credentialNotFound";
  } else if (isSpecificError(err, "ApiKeyNotFoundError")) {
    code = "not_found";
    safeMessage = "Chave de API não encontrada.";
    messageKey = "errors.apiKeyNotFound";
  } else if (isSpecificError(err, "MemberNotFoundError")) {
    code = "not_found";
    safeMessage = "Membro não encontrado.";
    messageKey = "errors.memberNotFound";
  } else if (isSpecificError(err, "InvitationNotFoundError")) {
    code = "not_found";
    safeMessage = "Convite não encontrado ou inválido.";
    messageKey = "errors.invitationNotFound";
  } else if (isSpecificError(err, "SeatLimitExceededError")) {
    code = "conflict";
    safeMessage = "O limite de vagas desta organização foi atingido.";
    messageKey = "errors.seatLimitExceeded";
  } else if (isSpecificError(err, "LastOwnerCannotBeRemovedError")) {
    code = "conflict";
    safeMessage = "Não é permitido alterar ou remover o último proprietário.";
    messageKey = "errors.lastOwner";
  } else if (isSpecificError(err, "InvitationExpiredError")) {
    code = "conflict";
    safeMessage = "Este convite expirou.";
    messageKey = "errors.invitationExpired";
  } else if (isSpecificError(err, "InvitationRevokedError")) {
    code = "conflict";
    safeMessage = "Este convite foi revogado por um administrador.";
    messageKey = "errors.invitationRevoked";
  } else if (isSpecificError(err, "InvitationAlreadyAcceptedError")) {
    code = "conflict";
    safeMessage = "Este convite já foi aceito.";
    messageKey = "errors.invitationAccepted";
  } else if (isSpecificError(err, "ModuleUnavailableError")) {
    code = "unavailable";
    safeMessage =
      err instanceof Error && err.message
        ? err.message
        : "Módulo temporariamente indisponível.";
    messageKey =
      err instanceof Error && err.message
        ? undefined
        : "errors.moduleUnavailable";
  } else if (isSpecificError(err, "ProviderError")) {
    code = "provider_error";
    safeMessage = "Falha na comunicação com o provedor de IA.";
    messageKey = "errors.providerError";
  } else if (isSpecificError(err, "AgentExecutionError")) {
    code = "provider_error";
    safeMessage = "Falha na comunicação com o provedor de IA.";
    messageKey = "errors.providerError";
  } else if (isSpecificError(err, "ZodError")) {
    code = "invalid_input";
    safeMessage = "Dados de entrada inválidos.";
    messageKey = "errors.invalidInput";
  }

  // Structured logging to server console with security redaction
  if (options?.log !== false) {
    const errorName = err instanceof Error ? err.name : typeof err;
    const rawMessage = err instanceof Error ? err.message : String(err);
    appLog.error("app.error", {
      requestId: reqId,
      code,
      errorName,
      message: redact(rawMessage),
    });
  }

  return {
    code,
    safeMessage,
    requestId: reqId,
    ...(messageKey ? { messageKey } : {}),
    ...(messageValues ? { messageValues } : {}),
  };
}

function isSpecificError(err: unknown, errorName: string): boolean {
  if (!err || typeof err !== "object") return false;
  return (
    (err as { name?: string }).name === errorName ||
    (err as { constructor?: { name?: string } }).constructor?.name === errorName
  );
}
