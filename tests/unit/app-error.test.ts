import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AppError,
  toSafeError,
  redact,
  redactData,
  apiErrorResponse,
} from "@/shared/errors";
import { AccessDeniedError } from "@/core/auth/errors";
import { WorkspaceNotFoundError } from "@/core/auth/context";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  InsufficientRoleError,
  SeatLimitExceededError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationRevokedError,
  InvitationAlreadyAcceptedError,
  InvitationRecipientMismatchError,
  InvitationEmailUnconfirmedError,
  LastOwnerCannotBeRemovedError,
} from "@/core/organizations/errors";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { CredentialNotFoundError } from "@/core/credentials/vault";
import { ProviderError } from "@/core/agents/providers/executor";

describe("Secure Application Errors & Redaction (C10, Spec §15, §16, §24 AC07)", () => {
  describe("Secret and PII Redaction (redact)", () => {
    it("redacts OpenAI / generic sk- API keys", () => {
      const input = "Failed with key sk-proj-1234567890abcdef1234567890 and more";
      expect(redact(input)).toBe("Failed with key sk-[REDACTED] and more");
    });

    it("redacts Anthropic sk-ant- keys", () => {
      const input = "Using credential sk-ant-api03-abcdef1234567890 in execution";
      expect(redact(input)).toBe("Using credential sk-ant-[REDACTED] in execution");
    });

    it("redacts Google AIza keys", () => {
      const input = "Key AIzaSyD1234567890wxyz_abcdef was rejected";
      expect(redact(input)).toBe("Key AIza[REDACTED] was rejected");
    });

    it("redacts GUIDU API keys (gdu_live_)", () => {
      const input = "Provided token gdu_live_0123456789abcdef1234567890 expired";
      expect(redact(input)).toBe("Provided token gdu_live_[REDACTED] expired");
    });

    it("redacts JWT tokens (eyJ...)", () => {
      const token =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const input = `Bearer token ${token} failed`;
      expect(redact(input)).toBe("Bearer token eyJ[REDACTED] failed");
    });

    it("redacts passwords from database connection URLs", () => {
      const input =
        "Failed to connect to postgresql://app_runtime:super_secret_p%40ss@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
      expect(redact(input)).toBe(
        "Failed to connect to postgresql://app_runtime:[REDACTED]@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      );
    });

    it("partially masks email addresses to protect PII", () => {
      const input = "Invitation sent to marcelo.silva@company.org with token";
      expect(redact(input)).toBe("Invitation sent to m***@company.org with token");
    });

    it("redacts nested objects and arrays in redactData", () => {
      const data = {
        secret: "sk-ant-api03-secret123",
        user: { email: "alice@domain.com" },
        items: ["normal", "AIzaSyD_secretKey123"],
      };
      const result = redactData(data) as typeof data;
      expect(result.secret).toBe("sk-ant-[REDACTED]");
      expect(result.user.email).toBe("a***@domain.com");
      expect(result.items[1]).toBe("AIza[REDACTED]");
    });
  });

  describe("Domain Error Mapping (toSafeError)", () => {
    it("preserves AppError instances directly", () => {
      const appErr = new AppError({
        code: "invalid_input",
        safeMessage: "Dado inválido.",
        requestId: "req-custom",
      });
      const safe = toSafeError(appErr, "req-ignored", { log: false });
      expect(safe.code).toBe("invalid_input");
      expect(safe.safeMessage).toBe("Dado inválido.");
      expect(safe.requestId).toBe("req-custom");
    });

    it("maps AccessDeniedError to forbidden or unauthenticated", () => {
      const errForbidden = new AccessDeniedError("identity_blocked", 403);
      const safeForbidden = toSafeError(errForbidden, "req-1", { log: false });
      expect(safeForbidden.code).toBe("forbidden");
      expect(safeForbidden.safeMessage).toBe("Identidade bloqueada.");
      expect(safeForbidden.requestId).toBe("req-1");

      const errUnauth = new AccessDeniedError("unauthenticated", 401);
      const safeUnauth = toSafeError(errUnauth, "req-2", { log: false });
      expect(safeUnauth.code).toBe("unauthenticated");
      expect(safeUnauth.safeMessage).toBe("Autenticação necessária.");
    });

    it("maps PermissionDeniedError to forbidden", () => {
      const err = new PermissionDeniedError();
      const safe = toSafeError(err, "req-3", { log: false });
      expect(safe.code).toBe("forbidden");
      expect(safe.safeMessage).toBe("Você não tem permissão para esta ação.");
    });

    it("maps InsufficientRoleError to forbidden", () => {
      const err = new InsufficientRoleError("workspace.edit", "admin");
      const safe = toSafeError(err, "req-4", { log: false });
      expect(safe.code).toBe("forbidden");
      expect(safe.safeMessage).toBe("Papel insuficiente para executar esta operação.");
    });

    it("maps WorkspaceNotFoundError to not_found", () => {
      const err = new WorkspaceNotFoundError("my-ws");
      const safe = toSafeError(err, "req-5", { log: false });
      expect(safe.code).toBe("not_found");
      expect(safe.safeMessage).toBe("Workspace não encontrado.");
    });

    it("maps SeatLimitExceededError to conflict", () => {
      const err = new SeatLimitExceededError("org-1", 5, 5);
      const safe = toSafeError(err, "req-6", { log: false });
      expect(safe.code).toBe("conflict");
      expect(safe.safeMessage).toBe("O limite de vagas desta organização foi atingido.");
    });

    it("maps invitation errors to safe Portuguese messages", () => {
      expect(toSafeError(new InvitationNotFoundError(), undefined, { log: false }).safeMessage).toBe("Convite não encontrado ou inválido.");
      expect(toSafeError(new InvitationNotFoundError(), undefined, { log: false }).code).toBe("not_found");

      expect(toSafeError(new InvitationExpiredError(), undefined, { log: false }).safeMessage).toBe("Este convite expirou.");
      expect(toSafeError(new InvitationExpiredError(), undefined, { log: false }).code).toBe("conflict");

      expect(toSafeError(new InvitationRevokedError(), undefined, { log: false }).safeMessage).toBe("Este convite foi revogado por um administrador.");
      expect(toSafeError(new InvitationAlreadyAcceptedError(), undefined, { log: false }).safeMessage).toBe("Este convite já foi aceito.");
      expect(toSafeError(new InvitationRecipientMismatchError(), undefined, { log: false }).safeMessage).toBe(
        "Este convite foi enviado para outro e-mail.",
      );
      expect(toSafeError(new InvitationEmailUnconfirmedError(), undefined, { log: false }).safeMessage).toBe(
        "O seu e-mail precisa estar confirmado para aceitar o convite.",
      );
    });

    it("maps LastOwnerCannotBeRemovedError to conflict", () => {
      const err = new LastOwnerCannotBeRemovedError("org-1");
      const safe = toSafeError(err, "req-7", { log: false });
      expect(safe.code).toBe("conflict");
      expect(safe.safeMessage).toBe("Não é permitido alterar ou remover o último proprietário.");
    });

    it("maps ModuleUnavailableError to unavailable", () => {
      const err = new ModuleUnavailableError("ai-agents");
      const safe = toSafeError(err, "req-8", { log: false });
      expect(safe.code).toBe("unavailable");
      expect(safe.safeMessage).toBe(
        "O módulo 'ai-agents' está temporariamente indisponível nesta etapa da plataforma.",
      );
    });

    it("maps CredentialNotFoundError to not_found", () => {
      const err = new CredentialNotFoundError("openai", "ws-1");
      const safe = toSafeError(err, "req-9", { log: false });
      expect(safe.code).toBe("not_found");
      expect(safe.safeMessage).toBe("Credencial não encontrada.");
    });

    it("maps ProviderError to provider_error", () => {
      const err = new ProviderError("anthropic", 500);
      const safe = toSafeError(err, "req-10", { log: false });
      expect(safe.code).toBe("provider_error");
      expect(safe.safeMessage).toBe("Falha na comunicação com o provedor de IA.");
    });

    it("maps unknown errors to internal without leaking internal messages or secrets", () => {
      const internalErr = new Error("Database deadlock at postgresql://user:secret@host/db with key sk-1234567890abcdef");
      const safe = toSafeError(internalErr, "req-11", { log: false });
      expect(safe.code).toBe("internal");
      expect(safe.safeMessage).toBe("Não foi possível concluir a operação.");
      expect(safe.requestId).toBe("req-11");
    });
  });

  describe("Server Error Logging without Secret Leakage", () => {
    it("redacts secrets and prints structured JSON when logging errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const leakError = new Error(
        "Failed request with API key sk-ant-api03-ultra-secret and email user@example.com",
      );
      const safe = toSafeError(leakError, "req-audit-1", { log: true });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const loggedJson = String(consoleErrorSpy.mock.calls[0]?.[0]);
      const parsed = JSON.parse(loggedJson);

      expect(parsed.requestId).toBe("req-audit-1");
      expect(parsed.code).toBe("internal");
      expect(parsed.message).not.toContain("sk-ant-api03-ultra-secret");
      expect(parsed.message).toContain("sk-ant-[REDACTED]");
      expect(parsed.message).toContain("u***@example.com");

      expect(safe.safeMessage).toBe("Não foi possível concluir a operação.");
      expect(safe.code).toBe("internal");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("REST API Error Envelope (apiErrorResponse)", () => {
    it("formats 403 Forbidden with standard envelope", async () => {
      const err = new PermissionDeniedError();
      const response = apiErrorResponse(err);
      expect(response.status).toBe(403);

      const json = await response.json();
      expect(json.error.code).toBe("forbidden");
      expect(json.error.message).toBe("Você não tem permissão para esta ação.");
      expect(typeof json.error.requestId).toBe("string");
    });

    it("formats 401 Unauthenticated with standard envelope", async () => {
      const err = new AccessDeniedError("unauthenticated", 401);
      const response = apiErrorResponse(err);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error.code).toBe("unauthenticated");
      expect(json.error.message).toBe("Autenticação necessária.");
    });

    it("formats 404 Not Found", async () => {
      const err = new WorkspaceNotFoundError("ws-99");
      const response = apiErrorResponse(err);
      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.error.code).toBe("not_found");
    });

    it("formats 409 Conflict", async () => {
      const err = new SeatLimitExceededError("org-1", 10, 10);
      const response = apiErrorResponse(err);
      expect(response.status).toBe(409);

      const json = await response.json();
      expect(json.error.code).toBe("conflict");
    });

    it("formats 502 Bad Gateway for provider errors", async () => {
      const err = new ProviderError("gemini", 503);
      const response = apiErrorResponse(err);
      expect(response.status).toBe(502);

      const json = await response.json();
      expect(json.error.code).toBe("provider_error");
    });

    it("formats 503 Service Unavailable for unavailable modules", async () => {
      const err = new ModuleUnavailableError("ai-agents");
      const response = apiErrorResponse(err);
      expect(response.status).toBe(503);

      const json = await response.json();
      expect(json.error.code).toBe("unavailable");
    });

    it("formats 500 Internal Server Error for unhandled exceptions", async () => {
      const err = new Error("Catastrophic disk error with key sk-secret123");
      const response = apiErrorResponse(err);
      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json.error.code).toBe("internal");
      expect(json.error.message).toBe("Não foi possível concluir a operação.");
      expect(JSON.stringify(json)).not.toContain("sk-secret123");
    });
  });
});
