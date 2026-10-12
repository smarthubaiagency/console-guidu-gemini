import { describe, expect, it } from "vitest";

import { flattenMessages, keepsMessageArguments } from "@/core/i18n/locales";
import {
  createFakeTranslator,
  FAKE_INVALID_MARKER,
  FAKE_MISSING_MARKER,
  fakeTranslate,
} from "@/core/i18n/machine/fake";
import {
  DOCUMENT_SCHEMA,
  SYSTEM_PROMPT,
  TEXTS_SCHEMA,
  textsUserMessage,
} from "@/core/i18n/machine/prompt";
import {
  machineTranslationConfigured,
  machineTranslationProvider,
} from "@/core/i18n/machine/provider";
import {
  acceptMachineDocument,
  acceptMachineText,
  chunk,
  mapLimited,
  MAX_KEYS_PER_RUN,
  TEXTS_PER_CALL,
} from "@/core/i18n/machine/validate";
import { MESSAGE_FILES } from "@/i18n/messages";

const fr = { code: "fr", name: "Français" };
const pt = { code: "pt-BR", name: "Português (Brasil)" };

describe("I6: fake translator", () => {
  it("prefixes words and keeps ICU arguments, types and option keys", () => {
    expect(fakeTranslate("Olá, {name}!", "fr")).toBe("[fr]Olá, {name}!");
    expect(
      fakeTranslate(
        "{count, plural, one {# registro} other {# registros}}",
        "fr",
      ),
    ).toBe("{count, plural, one {# [fr]registro} other {# [fr]registros}}");
    expect(
      fakeTranslate(
        "{finished, select, yes { · terminou em {finishedAt}} other {}}",
        "fr",
      ),
    ).toBe(
      "{finished, select, yes { · [fr]terminou [fr]em {finishedAt}} other {}}",
    );
  });

  it("every shipped source text stays valid after the fake translation", () => {
    const source = flattenMessages(MESSAGE_FILES["pt-BR"]);
    const broken = Object.entries(source).filter(
      ([, text]) => !keepsMessageArguments(text, fakeTranslate(text, "fr")),
    );
    expect(broken).toEqual([]);
  });

  it("honours the test markers", async () => {
    const out = await createFakeTranslator().translateTexts(pt, fr, [
      { key: "a", text: "Oi {name}" },
      { key: "b", text: `Quebra {name} ${FAKE_INVALID_MARKER}` },
      { key: "c", text: `Some ${FAKE_MISSING_MARKER}` },
    ]);
    expect(out.a).toBe("[fr]Oi {name}");
    expect(acceptMachineText("Quebra {name}", out.b)).toBeNull();
    expect("c" in out).toBe(false);
  });

  it("translates documents line by line", async () => {
    const out = await createFakeTranslator().translateDocument(pt, fr, {
      title: "Termos",
      body: "1. Uso\n\nTexto",
    });
    expect(out).toEqual({
      title: "[fr] Termos",
      body: "[fr] 1. Uso\n\n[fr] Texto",
    });
  });
});

describe("I6: validation of machine output", () => {
  it("applies the rules of a manual edit", () => {
    expect(acceptMachineText("Olá {name}", "  Bonjour {name} ")).toBe(
      "Bonjour {name}",
    );
    expect(acceptMachineText("Olá {name}", "Bonjour {nom}")).toBeNull();
    expect(acceptMachineText("Olá {name}", "Bonjour {name")).toBeNull();
    expect(acceptMachineText("Olá", "Bonjour {x}")).toBeNull();
    expect(acceptMachineText("Olá", "   ")).toBeNull();
    expect(acceptMachineText("Olá", "x".repeat(5001))).toBeNull();
    expect(acceptMachineText("Olá", 42)).toBeNull();
    expect(
      acceptMachineText(
        "{count, plural, one {# texto} other {# textos}}",
        "{count, plural, one {# texte} other {# textes}}",
      ),
    ).not.toBeNull();
  });

  it("checks legal titles and bodies", () => {
    expect(acceptMachineDocument({ title: " T ", body: " B " })).toEqual({
      title: "T",
      body: "B",
    });
    expect(acceptMachineDocument({ title: "x".repeat(121), body: "B" })).toBe(
      null,
    );
    expect(acceptMachineDocument({ title: "T", body: "" })).toBeNull();
    expect(acceptMachineDocument({ title: "T" })).toBeNull();
  });
});

describe("I6: chunking and limits", () => {
  it("splits in chunks of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 150)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
    expect(TEXTS_PER_CALL).toBe(150);
    expect(MAX_KEYS_PER_RUN).toBe(5000);
    const all = Object.keys(flattenMessages(MESSAGE_FILES["pt-BR"]));
    expect(chunk(all, TEXTS_PER_CALL).length).toBe(
      Math.ceil(all.length / TEXTS_PER_CALL),
    );
  });

  it("runs with a concurrency limit and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimited([5, 1, 3, 2, 4], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });

  it("stops starting new calls after a failure", async () => {
    const started: number[] = [];
    await expect(
      mapLimited([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });
});

describe("I6: provider selection", () => {
  it("fake, anthropic or none, from the environment", () => {
    expect(machineTranslationProvider({ TRANSLATION_PROVIDER: "fake" })).toBe(
      "fake",
    );
    expect(
      machineTranslationProvider({ TRANSLATION_ANTHROPIC_API_KEY: "sk-test" }),
    ).toBe("anthropic");
    expect(
      machineTranslationProvider({ TRANSLATION_ANTHROPIC_API_KEY: "  " }),
    ).toBeNull();
    expect(machineTranslationConfigured({})).toBe(false);
  });
});

describe("I6: prompt", () => {
  it("is stable and keeps the product rules", () => {
    expect(SYSTEM_PROMPT).toContain("GUIDU, UCP, MCP, API, BYOK");
    expect(SYSTEM_PROMPT).toContain("ICU MessageFormat");
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const message = textsUserMessage(pt, fr, [{ key: "a.b", text: "Oi" }]);
    expect(message).toContain("Target language: fr (Français).");
    expect(message).toContain('{"key":"a.b","text":"Oi"}');
    expect(TEXTS_SCHEMA.required).toEqual(["translations"]);
    expect(DOCUMENT_SCHEMA.required).toEqual(["title", "body"]);
  });
});

describe("I6: provider errors", () => {
  it("fails for good on auth and bad requests, retries on 429/5xx", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { providerError } = await import("@/core/i18n/machine/anthropic");
    const headers = new Headers();
    const auth = providerError(
      new Anthropic.AuthenticationError(
        401,
        undefined,
        "sk-secret bad",
        headers,
      ),
    );
    expect(auth.code).toBe("invalid_input");
    expect(auth.safeMessage).not.toContain("sk-secret");
    expect(
      providerError(new Anthropic.BadRequestError(400, undefined, "x", headers))
        .code,
    ).toBe("invalid_input");
    expect(
      providerError(new Anthropic.RateLimitError(429, undefined, "x", headers))
        .code,
    ).toBe("rate_limited");
    expect(
      providerError(
        new Anthropic.InternalServerError(529, undefined, "x", headers),
      ).code,
    ).toBe("unavailable");
    expect(providerError(new Error("sk-secret")).safeMessage).not.toContain(
      "sk-secret",
    );
  });
});
