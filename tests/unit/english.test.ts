import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  englishErrorMessage,
  englishQuotaLabel,
  genericEnglishMessage,
} from "@/core/i18n/english";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { AppError, toSafeError } from "@/shared/errors";

const quiet = { log: false } as const;

describe("English of the API and the MCP (I5)", () => {
  it("translates the message key with its values", () => {
    const safe = toSafeError(
      new AppError({
        code: "forbidden",
        safeMessage: "Esta chave não tem o escopo crm:write.",
        messageKey: "apiErrors.missingScope",
        messageValues: { scope: "crm:write" },
      }),
      undefined,
      quiet,
    );
    expect(englishErrorMessage(safe)).toBe(
      "This key does not have the crm:write scope.",
    );
  });

  it("falls back to an English sentence of the code, never Portuguese", () => {
    const safe = toSafeError(
      new AppError({ code: "conflict", safeMessage: "Conflito qualquer." }),
      undefined,
      quiet,
    );
    expect(englishErrorMessage(safe)).toBe(genericEnglishMessage("conflict"));
    expect(
      englishErrorMessage({
        code: "not_found",
        safeMessage: "x",
        requestId: "r",
        messageKey: "apiErrors.doesNotExist",
      }),
    ).toBe("Resource not found.");
  });

  it("names a quota from the module catalog", () => {
    expect(englishQuotaLabel("crm.contacts")).toBe("contacts per workspace");
    expect(englishQuotaLabel("core.unknown")).toBe("core.unknown");
    expect(
      englishErrorMessage({
        code: "conflict",
        safeMessage:
          "Limite do plano atingido: contatos por workspace (5 de 5).",
        requestId: "r",
        messageKey: "apiErrors.quotaExceeded",
        messageValues: {
          quota: "contatos por workspace",
          quotaKey: "crm.contacts",
          used: 5,
          limit: 5,
        },
      }),
    ).toBe("Plan limit reached: contacts per workspace (5 of 5).");
  });

  it("gives module unavailability a key by its reason", () => {
    const maintenance = new ModuleUnavailableError("crm", "Em manutenção.");
    maintenance.reason = "maintenance";
    expect(
      englishErrorMessage(toSafeError(maintenance, undefined, quiet)),
    ).toBe("This module is under maintenance. Try again later.");
    const custom = new ModuleUnavailableError("crm", "Texto próprio.");
    const safe = toSafeError(custom, undefined, quiet);
    expect(safe.safeMessage).toBe("Texto próprio.");
    expect(englishErrorMessage(safe)).toBe("Service temporarily unavailable.");
  });
});
